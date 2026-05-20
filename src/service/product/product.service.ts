import { Prisma, type UnitType } from '~/generated/prisma/client';
import { env } from '~/config/env.config';
import { db } from '~/lib/db';
import { ApiResponse } from '~/lib/response';
import type { Request, Response } from 'express';
import type {
  CreateProductDTO,
  UpdateProductDTO,
  CreateVariantDTO,
  UpdateVariantDTO,
  CreateProductImageDTO,
  UpdateInventoryDTO,
  SetServiceabilityDTO,
  ListProductsParams,
} from './product.types';
import type { z } from 'zod';
import { flatVariantCreateSchema, treeVariantCreateSchema } from './product.schema';
import { mailServiceAsync } from '../mail/mail.service';
import { SellerMailTemplate } from '../mail/seller.mail.template';

type FlatVariantRow = z.infer<typeof flatVariantCreateSchema>;
type TreeVariantRow = z.infer<typeof treeVariantCreateSchema>;

function toUnitCountDecimal(value: unknown): Prisma.Decimal | null {
  if (value == null || value === '') return null;
  return new Prisma.Decimal(String(value));
}

type Tx = Prisma.TransactionClient;

const MAX_ALIAS_SLUG_LEN = 255;
const MAX_ALIAS_NAME_PART = 220;

/** Lowercase, strip diacritics; spaces and any non-alphanumeric run → single `_`, trim/collapse `_`. */
function slugifyProductNameForAlias(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  const out = s.slice(0, MAX_ALIAS_NAME_PART);
  return out.length > 0 ? out : 'product';
}

/** Default `{normalized-name}_{productId}` (unique per id; rare collision appends `_2`, `_3`, …). */
function buildDefaultProductAliasSlug(productName: string, productId: bigint): string {
  const base = slugifyProductNameForAlias(productName);
  const idStr = productId.toString();
  const maxBase = Math.max(1, MAX_ALIAS_SLUG_LEN - 1 - idStr.length);
  return `${base.slice(0, maxBase)}_${idStr}`;
}

async function findUniqueProductAliasSlug(
  tx: Tx,
  baseCandidate: string,
  excludeProductId: bigint,
): Promise<string> {
  for (let n = 0; n < 100; n++) {
    const extra = n === 0 ? '' : `_${n}`;
    const slug = (baseCandidate.slice(0, MAX_ALIAS_SLUG_LEN - extra.length) + extra).slice(
      0,
      MAX_ALIAS_SLUG_LEN,
    );
    const taken = await tx.product.findFirst({
      where: { aliasSlug: slug, id: { not: excludeProductId } },
      select: { id: true },
    });
    if (!taken) return slug;
  }
  throw new Error('ALIAS_COLLISION');
}

function isVariantUpdateItem(item: unknown): item is { id: bigint } & UpdateVariantDTO {
  if (item === null || typeof item !== 'object' || !('id' in item)) return false;
  const raw = (item as { id: unknown }).id;
  if (raw === null || raw === undefined) return false;
  try {
    const id = typeof raw === 'bigint' ? raw : BigInt(String(raw));
    return id > 0n;
  } catch {
    return false;
  }
}

type VariantRowInput = Omit<FlatVariantRow, 'images'>;

function isTreeVariantNode(v: CreateVariantDTO): v is TreeVariantRow {
  const t = v as Record<string, unknown>;
  return (
    typeof t.id === 'string' &&
    String(t.id).length > 0 &&
    t.levelIndex != null &&
    typeof t.name === 'string'
  );
}

function isVariantTreePayload(list: CreateVariantDTO[]): boolean {
  return list.length > 0 && list.every(isTreeVariantNode);
}

function normalizeSkuInput(s: unknown): string {
  if (s == null) return '';
  return String(s).trim();
}

function collectSellableSkusFromCreateList(list: CreateVariantDTO[]): string[] {
  const out: string[] = [];
  for (const v of list) {
    const s = normalizeSkuInput(isTreeVariantNode(v) ? v.sku : v.sku);
    if (s.length > 0) out.push(s);
  }
  return out;
}

function variantDataForCreate(productId: bigint, data: VariantRowInput) {
  return {
    productId,
    parentVariantId: null,
    variantName: data.variantName,
    sku: data.sku,
    price: data.price,
    mrp: data.mrp,
    unitCount: toUnitCountDecimal(data.unitCount),
    unitType: (data.unitType ?? null) as UnitType | null,
    gtinEan: data.gtinEan || null,
    productWeightGm: data.productWeightGm || null,
    productLengthCm: data.productLengthCm || null,
    productWidthCm: data.productWidthCm || null,
    productHeightCm: data.productHeightCm || null,
    shippingPkgWeightGm: data.shippingPkgWeightGm || null,
    shippingPkgLengthCm: data.shippingPkgLengthCm || null,
    shippingPkgWidthCm: data.shippingPkgWidthCm || null,
    shippingPkgHeightCm: data.shippingPkgHeightCm || null,
    minPurchaseLimit: data.minPurchaseLimit || null,
    maxPurchaseLimit: data.maxPurchaseLimit || null,
    standardPackageQty: data.standardPackageQty || null,
  };
}

type VariantImageInput = { imageUrl: string; sortOrder?: number | undefined };
type OndcAttributeInput = {
  attributeKey: string;
  attributeValue?: string | null | undefined;
  colorName?: string | null | undefined;
  sortOrder?: number | undefined;
};

async function replaceVariantImagesInTx(tx: Tx, variantId: bigint, items: VariantImageInput[]) {
  await tx.variantImage.deleteMany({ where: { variantId } });
  if (items.length === 0) return;
  const sorted = [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  await tx.variantImage.createMany({
    data: sorted.map((im, i) => ({
      variantId,
      imageUrl: im.imageUrl,
      sortOrder: im.sortOrder !== undefined && im.sortOrder >= 0 ? im.sortOrder : i,
    })),
  });
}

async function replaceProductOndcAttributesInTx(
  tx: Tx,
  productId: bigint,
  variantId: bigint | null,
  items: OndcAttributeInput[],
) {
  await tx.productOndcAttribute.deleteMany({ where: { productId, variantId } });
  if (items.length === 0) return;
  await tx.productOndcAttribute.createMany({
    data: items.map((a, i) => ({
      productId,
      variantId,
      attributeKey: a.attributeKey.trim(),
      attributeValue:
        a.attributeValue != null && String(a.attributeValue).trim() !== ''
          ? String(a.attributeValue).trim()
          : null,
      colorName:
        a.colorName != null && String(a.colorName).trim() !== ''
          ? String(a.colorName).trim()
          : null,
      sortOrder: a.sortOrder !== undefined && a.sortOrder >= 0 ? a.sortOrder : i,
    })),
  });
}

/** Stable key: same UI `id` may repeat under different parents (e.g. two leaves both named `node-size-l`). */
function treeNodePlacementKey(n: TreeVariantRow): string {
  const pid = n.parentId == null || n.parentId === undefined ? '' : String(n.parentId);
  return `${pid}::${n.id}`;
}

function sortVariantTreeByParent(list: TreeVariantRow[]): TreeVariantRow[] {
  const childrenOf = new Map<string | null, TreeVariantRow[]>();
  for (const n of list) {
    const pid = n.parentId == null || n.parentId === undefined ? null : String(n.parentId);
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid)!.push(n);
  }
  const out: TreeVariantRow[] = [];
  const seenPlacement = new Set<string>();
  const queue: Array<string | null> = [null];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    const kids = [...(childrenOf.get(pid) ?? [])];
    kids.sort((a, b) => a.levelIndex - b.levelIndex || a.id.localeCompare(b.id));
    for (const n of kids) {
      const placeKey = treeNodePlacementKey(n);
      if (seenPlacement.has(placeKey)) continue;
      seenPlacement.add(placeKey);
      out.push(n);
      queue.push(n.id);
    }
  }
  for (const n of list) {
    if (!seenPlacement.has(treeNodePlacementKey(n))) {
      out.push(n);
      seenPlacement.add(treeNodePlacementKey(n));
    }
  }
  return out;
}

async function deleteAllVariantsForProductTx(tx: Tx, productId: bigint) {
  for (;;) {
    const total = await tx.productVariant.count({ where: { productId } });
    if (total === 0) return;
    const leaves = await tx.productVariant.findMany({
      where: { productId, childVariants: { none: {} } },
      select: { id: true },
      take: 500,
    });
    if (leaves.length === 0) {
      await tx.productVariant.deleteMany({ where: { productId } });
      return;
    }
    await tx.productVariant.deleteMany({
      where: { id: { in: leaves.map((l) => l.id) } },
    });
  }
}

async function insertVariantTreeInTx(
  tx: Tx,
  productId: bigint,
  list: CreateVariantDTO[],
  fallbackPrice: number,
  fallbackMrp: number,
) {
  const nodes = list.filter(isTreeVariantNode);
  const sorted = sortVariantTreeByParent(nodes);
  const idMap = new Map<string, bigint>();
  const fp = new Prisma.Decimal(String(fallbackPrice));
  const fm = new Prisma.Decimal(String(fallbackMrp));

  for (const node of sorted) {
    const parentKey =
      node.parentId == null || node.parentId === undefined ? null : String(node.parentId);
    const parentVariantId = parentKey == null ? null : (idMap.get(parentKey) ?? null);
    if (parentKey != null && parentVariantId == null) {
      throw new Error(`VARIANT_PARENT_NOT_FOUND:${parentKey}`);
    }

    const skuTrim = node.sku != null ? String(node.sku).trim() : '';
    const isLeaf = skuTrim.length > 0;

    const variantNameDb = isLeaf ? String(node.variantName ?? '').trim() : String(node.name).trim();

    const row = await tx.productVariant.create({
      data: {
        productId,
        parentVariantId,
        levelIndex: node.levelIndex,
        levelName: node.levelName ?? null,
        attributeValue: node.name,
        colorCode: node.colorCode ?? null,
        variantName: variantNameDb || 'DEFAULT',
        sku: isLeaf ? skuTrim : null,
        price: isLeaf
          ? new Prisma.Decimal(String(node.price))
          : node.price != null
            ? new Prisma.Decimal(String(node.price))
            : fp,
        mrp: isLeaf
          ? new Prisma.Decimal(String(node.mrp))
          : node.mrp != null
            ? new Prisma.Decimal(String(node.mrp))
            : fm,
        unitCount: toUnitCountDecimal(node.unitCount),
        unitType: (node.unitType ?? null) as UnitType | null,
        gtinEan: node.gtinEan || null,
        productWeightGm: node.productWeightGm ?? null,
        productLengthCm: node.productLengthCm ?? null,
        productWidthCm: node.productWidthCm ?? null,
        productHeightCm: node.productHeightCm ?? null,
        shippingPkgWeightGm: node.shippingPkgWeightGm ?? null,
        shippingPkgLengthCm: node.shippingPkgLengthCm ?? null,
        shippingPkgWidthCm: node.shippingPkgWidthCm ?? null,
        shippingPkgHeightCm: node.shippingPkgHeightCm ?? null,
        minPurchaseLimit: node.minPurchaseLimit ?? null,
        maxPurchaseLimit: node.maxPurchaseLimit ?? null,
        standardPackageQty: node.standardPackageQty ?? null,
      },
    });
    idMap.set(node.id, row.id);

    if (node.images?.length) {
      await replaceVariantImagesInTx(tx, row.id, node.images);
    }
    if (node.ondcAttributes !== undefined) {
      await replaceProductOndcAttributesInTx(tx, productId, row.id, node.ondcAttributes);
    }
  }
}

/** Creates a variant row and optional `variant_images` (nested create). */
async function createVariantWithImagesInTx(tx: Tx, productId: bigint, data: CreateVariantDTO) {
  if (isTreeVariantNode(data)) {
    throw new Error('INTERNAL_USE_insertVariantTreeInTx');
  }
  const { images: vImages, ondcAttributes, ...rest } = data as FlatVariantRow;
  const row = await tx.productVariant.create({
    data: {
      ...variantDataForCreate(productId, rest),
      ...(vImages != null && vImages.length > 0
        ? {
            variantImages: {
              create: vImages.map((im, i) => ({
                imageUrl: im.imageUrl,
                sortOrder: im.sortOrder !== undefined && im.sortOrder >= 0 ? im.sortOrder : i,
              })),
            },
          }
        : {}),
    },
  });
  if (ondcAttributes !== undefined) {
    await replaceProductOndcAttributesInTx(tx, productId, row.id, ondcAttributes);
  }
  return row;
}

function buildVariantUpdatePatch(dto: UpdateVariantDTO) {
  const { images: _omitImages, ...rest } = dto as UpdateVariantDTO & {
    images?: CreateVariantDTO['images'];
  };
  const u: any = {};
  if (rest.variantName !== undefined) u.variantName = rest.variantName;
  if (rest.sku !== undefined) u.sku = rest.sku;
  if (rest.price !== undefined) u.price = rest.price;
  if (rest.mrp !== undefined) u.mrp = rest.mrp;
  if (rest.unitCount !== undefined) u.unitCount = rest.unitCount;
  if (rest.unitType !== undefined) u.unitType = rest.unitType as UnitType | null;
  if (rest.gtinEan !== undefined) u.gtinEan = rest.gtinEan;
  if (rest.productWeightGm !== undefined) u.productWeightGm = rest.productWeightGm;
  if (rest.productLengthCm !== undefined) u.productLengthCm = rest.productLengthCm;
  if (rest.productWidthCm !== undefined) u.productWidthCm = rest.productWidthCm;
  if (rest.productHeightCm !== undefined) u.productHeightCm = rest.productHeightCm;
  if (rest.shippingPkgWeightGm !== undefined) u.shippingPkgWeightGm = rest.shippingPkgWeightGm;
  if (rest.shippingPkgLengthCm !== undefined) u.shippingPkgLengthCm = rest.shippingPkgLengthCm;
  if (rest.shippingPkgWidthCm !== undefined) u.shippingPkgWidthCm = rest.shippingPkgWidthCm;
  if (rest.shippingPkgHeightCm !== undefined) u.shippingPkgHeightCm = rest.shippingPkgHeightCm;
  if (rest.minPurchaseLimit !== undefined) u.minPurchaseLimit = rest.minPurchaseLimit;
  if (rest.maxPurchaseLimit !== undefined) u.maxPurchaseLimit = rest.maxPurchaseLimit;
  if (rest.standardPackageQty !== undefined) u.standardPackageQty = rest.standardPackageQty;
  const r = rest as Record<string, unknown>;
  if (r.levelIndex !== undefined) u.levelIndex = r.levelIndex as number;
  if (r.levelName !== undefined) u.levelName = r.levelName as string | null;
  if (r.name !== undefined) u.attributeValue = r.name as string | null;
  if (r.colorCode !== undefined) u.colorCode = r.colorCode as string | null;
  if (r.parentVariantId !== undefined) u.parentVariantId = r.parentVariantId as bigint | null;
  return u;
}

async function replaceProductAttributesInTx(
  tx: Tx,
  productId: bigint,
  items: { attributeKey: string; attributeValue?: string | null | undefined }[],
) {
  await tx.productAttribute.deleteMany({ where: { productId } });
  if (items.length === 0) return;
  await tx.productAttribute.createMany({
    data: items.map((a) => ({
      productId,
      attributeKey: a.attributeKey.trim(),
      attributeValue:
        a.attributeValue != null && String(a.attributeValue).trim() !== ''
          ? String(a.attributeValue).trim()
          : null,
    })),
  });
}

async function insertProductImagesInTx(
  tx: Tx,
  productId: bigint,
  items: Array<{
    imageUrl: string;
    altText?: string | undefined;
    sortOrder?: number | undefined;
  }>,
) {
  if (items.length === 0) return;
  const base = await tx.productImage.findFirst({
    where: { productId },
    orderBy: { sortOrder: 'desc' },
  });
  const start = (base?.sortOrder ?? -1) + 1;
  for (let i = 0; i < items.length; i += 1) {
    const im = items[i]!;
    const sort = im.sortOrder !== undefined && im.sortOrder >= 0 ? im.sortOrder : start + i;
    await tx.productImage.create({
      data: {
        productId,
        imageUrl: im.imageUrl,
        altText: im.altText || null,
        sortOrder: sort,
      },
    });
  }
}

/** Inserts placeholder store / category rows for local testing (no seed DB). */
async function ensureDevCatalogRows(storeId: bigint, categoryId?: bigint | null) {
  if (!env.devBootstrapStore) return;

  const slug = `local-dev-store-${storeId.toString()}`;
  const devSellerUserId = Number(process.env.DEV_BOOTSTRAP_SELLER_USER_ID ?? '1');
  await db.$executeRaw`
    INSERT INTO \`stores\` (\`id\`, \`seller_user_id\`, \`store_name\`, \`store_slug\`, \`is_active\`, \`created_at\`, \`updated_at\`, \`deleted_at\`)
    VALUES (${storeId}, ${devSellerUserId}, 'Local dev store', ${slug}, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), NULL)
    ON DUPLICATE KEY UPDATE \`store_name\` = VALUES(\`store_name\`)
  `;

  if (categoryId != null) {
    const catSlug = `local-dev-cat-${categoryId.toString()}`;
    await db.$executeRaw`
      INSERT INTO \`categories\` (\`id\`, \`name\`, \`slug\`, \`sort_order\`, \`is_active\`)
      VALUES (${categoryId}, 'Local dev category', ${catSlug}, 0, true)
      ON DUPLICATE KEY UPDATE \`name\` = VALUES(\`name\`)
    `;
  }
}

class ProductService {
  private constructor() {}

  public static getInstance(): ProductService {
    return new ProductService();
  }

  /**
   * List products for a specific store (seller)
   */
  public listProducts = async (
    req: Request,
    res: Response,
    storeId: bigint,
    params: ListProductsParams,
  ) => {
    try {
      const page = params.page || 1;
      const limit = params.limit || 20;
      const skip = (page - 1) * limit;

      const whereClause: any = {
        storeId: storeId,
      };

      if (params.search) {
        whereClause.OR = [
          { productName: { contains: params.search } },
          { description: { contains: params.search } },
          { brand: { contains: params.search } },
        ];
      }

      const [products, total] = await Promise.all([
        db.product.findMany({
          where: whereClause,
          skip,
          take: limit,
          include: {
            category: true,
            attributes: true,
            variants: {
              include: {
                variantImages: { orderBy: { sortOrder: 'asc' } },
                ondcAttributes: { orderBy: { sortOrder: 'asc' } },
              },
            },
            ondcAttributes: { orderBy: { sortOrder: 'asc' } },
            images: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        }),
        db.product.count({ where: whereClause }),
      ]);

      const totalPages = Math.ceil(total / limit);

      return ApiResponse.success(res, 'Products fetched successfully', products, {
        page,
        limit,
        total,
        totalPages,
      });
    } catch (error) {
      return ApiResponse.serverError(res, 'Error fetching products', error);
    }
  };

  /**
   * Create a new product
   */
  public createProduct = async (
    req: Request,
    res: Response,
    storeId: bigint,
    data: CreateProductDTO,
  ) => {
    try {
      const { images, variants, attributes, ondcAttributes, ...core } = data;
      const withVariants = variants && variants.length > 0;
      const variantList = withVariants ? variants! : [];
      const anyTreeNode = withVariants && variantList.some(isTreeVariantNode);
      const allTreeNodes = withVariants && isVariantTreePayload(variantList);

      if (anyTreeNode && !allTreeNodes) {
        return ApiResponse.badRequest(
          res,
          'variants must be either all Mrignayanee-style tree nodes or all flat sellable rows (do not mix)',
        );
      }

      if (allTreeNodes) {
        const seenPlacement = new Set<string>();
        for (const n of variantList.filter(isTreeVariantNode)) {
          const k = treeNodePlacementKey(n);
          if (seenPlacement.has(k)) {
            return ApiResponse.badRequest(
              res,
              `Duplicate variant tree node for the same parent and client id (${k}).`,
            );
          }
          seenPlacement.add(k);
        }
      }

      if (withVariants) {
        const skus = collectSellableSkusFromCreateList(variantList);
        const dup = skus.find((sku, i) => skus.indexOf(sku) !== i);
        if (dup) {
          return ApiResponse.badRequest(res, `Duplicate SKU in payload: ${dup}`);
        }
        for (const sku of skus) {
          const taken = await db.productVariant.findUnique({ where: { sku } });
          if (taken) {
            return ApiResponse.conflict(res, `SKU already exists: ${sku}`);
          }
        }
      }

      await ensureDevCatalogRows(storeId, core.categoryId);

      const store = await db.store.findFirst({
        where: { id: storeId, deletedAt: null },
      });

      if (!store) {
        return ApiResponse.notFound(res, 'Store not found');
      }

      const category = await db.category.findUnique({
        where: { id: core.categoryId },
      });

      if (!category) {
        return ApiResponse.badRequest(res, 'Category not found');
      }

      const requestedAlias =
        typeof core.aliasSlug === 'string' && core.aliasSlug.trim() !== ''
          ? core.aliasSlug.trim()
          : null;

      if (requestedAlias) {
        const existingProduct = await db.product.findUnique({
          where: { aliasSlug: requestedAlias },
        });

        if (existingProduct) {
          return ApiResponse.conflict(res, 'Product slug already exists');
        }
      }

      const noOfVariantRows = withVariants ? variantList.length : 1;

      const product = await db.$transaction(async (tx) => {
        const created = await tx.product.create({
          data: {
            storeId: storeId,
            productName: core.productName,
            district: core.district,
            categoryId: core.categoryId,
            defaultPrice: core.defaultPrice,
            mrp: core.mrp,
            description: core.description || null,
            brand: core.brand || null,
            aliasSlug: requestedAlias,
            publishStatus: core.publishStatus ?? 'draft',
            stock: BigInt(core.stock ?? 0),
            forceOutOfStock: core.forceOutOfStock ?? false,
            hsnSacCode: core.hsnSacCode || null,
            gstPercent: core.gstPercent ?? 0,
            gtinEan: core.gtinEan || null,
            unitCount: toUnitCountDecimal(core.unitCount),
            unitType: (core.unitType ?? null) as UnitType | null,
            manufacturingMonth: core.manufacturingMonth || null,
            expiryDate: core.expiryDate ? new Date(core.expiryDate) : null,
            countryOfOrigin: core.countryOfOrigin || null,
            returnDaysWindow: core.returnDaysWindow ?? null,
            sellerPickupReturn: core.sellerPickupReturn ?? false,
            isCodAvailable: core.isCodAvailable !== false,
            isManufacturer: core.isManufacturer ?? false,
            manufacturerName: core.manufacturerName || null,
            manufacturerAddress: core.manufacturerAddress || null,
            minPurchaseLimit: core.minPurchaseLimit ?? 1,
            maxPurchaseLimit: core.maxPurchaseLimit ?? null,
            standardPackageQty: core.standardPackageQty ?? null,
            lowStockQty: core.lowStockQty ?? null,
            orderMode: core.orderMode ?? 'ONLINE',
            visibility: core.visibility ?? 'PUBLIC',
            seoTitle: core.seoTitle || null,
            seoDescription: core.seoDescription || null,
            seoKeywords: core.seoKeywords || null,
            disableForBots: core.disableForBots ?? false,
            availabilityMode: core.availabilityMode ?? 'SELLER_DEFAULT',
            cancellable: core.cancellable ?? 'DEFAULT',
            returnable: core.returnable ?? 'DEFAULT',
            timeToShipValue: core.timeToShipValue ?? null,
            timeToShipUnit: core.timeToShipUnit ?? null,
            instructions: core.instructions || null,
            storageConditions: core.storageConditions || null,
            includedItems: core.includedItems || null,
            sizeChartUrl: core.sizeChartUrl || null,
            giTag: core.giTag ?? false,
            silkMark: core.silkMark ?? false,
            noOfVariants: noOfVariantRows,
            haveOndcAttributes: core.haveOndcAttributes ?? false,
          },
        });

        if (!requestedAlias) {
          const slug = await findUniqueProductAliasSlug(
            tx,
            buildDefaultProductAliasSlug(core.productName, created.id),
            created.id,
          );
          await tx.product.update({ where: { id: created.id }, data: { aliasSlug: slug } });
        }

        if (withVariants) {
          if (allTreeNodes) {
            await insertVariantTreeInTx(tx, created.id, variantList, core.defaultPrice, core.mrp);
          } else {
            for (const v of variantList) {
              await createVariantWithImagesInTx(tx, created.id, v);
            }
          }
        } else {
          const sku = `P${created.id.toString()}-DEFAULT`;
          await tx.productVariant.create({
            data: {
              productId: created.id,
              parentVariantId: null,
              variantName: core.productName,
              sku,
              price: core.defaultPrice,
              mrp: core.mrp,
              unitCount: toUnitCountDecimal(core.unitCount),
              unitType: (core.unitType ?? null) as UnitType | null,
            },
          });
        }

        if (images && images.length > 0) {
          const sorted = [...images].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
          for (let i = 0; i < sorted.length; i += 1) {
            const im = sorted[i]!;
            await tx.productImage.create({
              data: {
                productId: created.id,
                imageUrl: im.imageUrl,
                altText: im.altText || null,
                sortOrder: im.sortOrder !== undefined && im.sortOrder >= 0 ? im.sortOrder : i,
              },
            });
          }
        }

        if (attributes != null) {
          await replaceProductAttributesInTx(tx, created.id, attributes);
        }

        if (ondcAttributes != null) {
          await replaceProductOndcAttributesInTx(tx, created.id, null, ondcAttributes);
        }

        return tx.product.findUniqueOrThrow({
          where: { id: created.id },
          include: {
            category: true,
            attributes: true,
            variants: {
              include: {
                variantImages: { orderBy: { sortOrder: 'asc' } },
                ondcAttributes: { orderBy: { sortOrder: 'asc' } },
              },
            },
            ondcAttributes: { orderBy: { sortOrder: 'asc' } },
            images: true,
          },
        });
      });
      //create product mail
      const sellerUser = await db.user.findUnique({
        where: { id: Number(store.sellerUserId) },
        select: { name: true, email: true },
      });

      if (sellerUser?.email) {
        void mailServiceAsync({
          to: sellerUser.email,
          subject: 'Product Submitted Successfully',
          html: SellerMailTemplate.productSubmitted({
            sellerName: sellerUser.name,
            productName: product.productName,
          }),
          text: `Your product ${product.productName} has been submitted successfully.`,
        });
      }

      const adminMailData: {
        productName: string;
        sellerName?: string;
        storeName?: string;
      } = {
        productName: product.productName,
      };

      if (sellerUser?.name) {
        adminMailData.sellerName = sellerUser.name;
      }

      if (store.storeName) {
        adminMailData.storeName = store.storeName;
      }

      if (process.env.ADMIN_EMAIL) {
        void mailServiceAsync({
          to: process.env.ADMIN_EMAIL,
          subject: `Product Approval Required - ${product.productName}`,
          html: SellerMailTemplate.productApprovalRequest(adminMailData),
          text: `New product approval required: ${product.productName}`,
        });
      }

      return ApiResponse.created(res, 'Product created successfully', product);
    } catch (error: any) {
      if (error.code === 'P2002') {
        return ApiResponse.conflict(res, 'Duplicate field value', error);
      }
      if (String(error?.message ?? '').startsWith('VARIANT_PARENT_NOT_FOUND')) {
        return ApiResponse.badRequest(
          res,
          'Invalid variant tree: a parentId does not match any node id in the payload',
        );
      }
      if (String(error?.message ?? '') === 'INTERNAL_USE_insertVariantTreeInTx') {
        return ApiResponse.badRequest(res, 'Invalid variant payload');
      }
      return ApiResponse.serverError(res, 'Error creating product', error);
    }
  };

  /**
   * Update a product
   */
  public updateProduct = async (
    req: Request,
    res: Response,
    storeId: bigint,
    productId: bigint,
    data: UpdateProductDTO,
  ) => {
    try {
      const {
        images,
        variants,
        removeVariantIds,
        replaceVariantTree,
        attributes,
        ondcAttributes,
        ...fieldData
      } = data;
      const product = await db.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        return ApiResponse.notFound(res, 'Product not found');
      }

      if (product.storeId !== storeId) {
        return ApiResponse.forbidden(res, 'Unauthorized to update this product');
      }

      if (fieldData.aliasSlug !== undefined) {
        const raw = fieldData.aliasSlug;
        const trimmed = typeof raw === 'string' ? raw.trim() : '';
        const cleared = raw === null || trimmed === '';
        if (!cleared && trimmed !== product.aliasSlug) {
          const existingProduct = await db.product.findUnique({
            where: { aliasSlug: trimmed },
          });

          if (existingProduct && existingProduct.id !== productId) {
            return ApiResponse.conflict(res, 'Product slug already exists');
          }
        }
      }

      if (fieldData.categoryId) {
        const category = await db.category.findUnique({
          where: { id: fieldData.categoryId },
        });

        if (!category) {
          return ApiResponse.badRequest(res, 'Category not found');
        }
      }

      const hasVariantsPayload = Boolean(variants && variants.length > 0);
      const anyTreeInPayload =
        hasVariantsPayload &&
        variants!.some(
          (item) => !isVariantUpdateItem(item) && isTreeVariantNode(item as CreateVariantDTO),
        );
      const allNewTree =
        hasVariantsPayload &&
        variants!.every(
          (item) => !isVariantUpdateItem(item) && isTreeVariantNode(item as CreateVariantDTO),
        );
      const allNewFlat =
        hasVariantsPayload &&
        variants!.every(
          (item) => !isVariantUpdateItem(item) && !isTreeVariantNode(item as CreateVariantDTO),
        );

      if (anyTreeInPayload && !replaceVariantTree) {
        return ApiResponse.badRequest(
          res,
          'Sending a Mrignayanee-style variant tree on update requires replaceVariantTree: true (full replace).',
        );
      }

      if (replaceVariantTree) {
        if (!hasVariantsPayload) {
          return ApiResponse.badRequest(
            res,
            'replaceVariantTree requires a non-empty variants array',
          );
        }
        if (removeVariantIds && removeVariantIds.length > 0) {
          return ApiResponse.badRequest(
            res,
            'Do not combine remove_variant_ids with replaceVariantTree',
          );
        }
        if (!allNewTree && !allNewFlat) {
          return ApiResponse.badRequest(
            res,
            'replaceVariantTree requires a full variants list: either all tree nodes or all flat rows (no id patches, no mixing)',
          );
        }
      }

      if (replaceVariantTree && allNewTree && variants) {
        const seenPlacement = new Set<string>();
        for (const raw of variants as CreateVariantDTO[]) {
          if (!isTreeVariantNode(raw)) continue;
          const k = treeNodePlacementKey(raw);
          if (seenPlacement.has(k)) {
            return ApiResponse.badRequest(
              res,
              `Duplicate variant tree node for the same parent and client id (${k}).`,
            );
          }
          seenPlacement.add(k);
        }
      }

      if (removeVariantIds && removeVariantIds.length > 0 && !replaceVariantTree) {
        const vcount = await db.productVariant.count({ where: { productId } });
        const newVariantsCount = variants
          ? variants.filter((v) => !isVariantUpdateItem(v)).length
          : 0;
        if (vcount - removeVariantIds.length + newVariantsCount < 1) {
          return ApiResponse.badRequest(res, 'A product must have at least one variant');
        }
        for (const rid of removeVariantIds) {
          const v = await db.productVariant.findFirst({
            where: { id: rid, productId },
          });
          if (!v) {
            return ApiResponse.badRequest(
              res,
              `Invalid variant_id for this product: ${rid.toString()}`,
            );
          }
        }
      }

      if (variants && variants.length > 0) {
        if (replaceVariantTree) {
          const skus = collectSellableSkusFromCreateList(variants as CreateVariantDTO[]);
          const dup = skus.find((sku, i) => skus.indexOf(sku) !== i);
          if (dup) {
            return ApiResponse.badRequest(res, `Duplicate SKU in payload: ${dup}`);
          }
          for (const sku of skus) {
            const taken = await db.productVariant.findUnique({ where: { sku } });
            if (taken && taken.productId !== productId) {
              return ApiResponse.conflict(res, `SKU already exists: ${sku}`);
            }
          }
        } else {
          for (const item of variants) {
            if (!isVariantUpdateItem(item)) {
              const sku = normalizeSkuInput((item as CreateVariantDTO).sku);
              if (!sku) continue;
              const taken = await db.productVariant.findUnique({ where: { sku } });
              if (taken && taken.productId !== productId) {
                return ApiResponse.conflict(res, `SKU already exists: ${sku}`);
              }
              continue;
            }
            if (item.sku !== undefined) {
              const sku = normalizeSkuInput(item.sku);
              if (!sku) continue;
              const taken = await db.productVariant.findFirst({
                where: { sku },
              });
              if (taken && (taken.id !== item.id || taken.productId !== productId)) {
                return ApiResponse.conflict(res, `SKU already exists: ${sku}`);
              }
            }
          }
        }
      }

      const updateData: any = {};

      if (fieldData.productName !== undefined) updateData.productName = fieldData.productName;
      if (fieldData.district !== undefined) updateData.district = fieldData.district;
      if (fieldData.categoryId !== undefined) updateData.categoryId = fieldData.categoryId;
      if (fieldData.defaultPrice !== undefined) updateData.defaultPrice = fieldData.defaultPrice;
      if (fieldData.mrp !== undefined) updateData.mrp = fieldData.mrp;
      if (fieldData.description !== undefined) updateData.description = fieldData.description;
      if (fieldData.brand !== undefined) updateData.brand = fieldData.brand;
      if (fieldData.publishStatus !== undefined) updateData.publishStatus = fieldData.publishStatus;
      if (fieldData.stock !== undefined) updateData.stock = BigInt(fieldData.stock);
      if (fieldData.forceOutOfStock !== undefined)
        updateData.forceOutOfStock = fieldData.forceOutOfStock;
      if (fieldData.hsnSacCode !== undefined) updateData.hsnSacCode = fieldData.hsnSacCode;
      if (fieldData.gstPercent !== undefined) updateData.gstPercent = fieldData.gstPercent;
      if (fieldData.gtinEan !== undefined) updateData.gtinEan = fieldData.gtinEan;
      if (fieldData.unitCount !== undefined)
        updateData.unitCount = toUnitCountDecimal(fieldData.unitCount);
      if (fieldData.unitType !== undefined)
        updateData.unitType = fieldData.unitType as UnitType | null;
      if (fieldData.manufacturingMonth !== undefined)
        updateData.manufacturingMonth = fieldData.manufacturingMonth;
      if (fieldData.expiryDate !== undefined)
        updateData.expiryDate = fieldData.expiryDate ? new Date(fieldData.expiryDate) : null;
      if (fieldData.countryOfOrigin !== undefined)
        updateData.countryOfOrigin = fieldData.countryOfOrigin;
      if (fieldData.returnDaysWindow !== undefined)
        updateData.returnDaysWindow = fieldData.returnDaysWindow;
      if (fieldData.sellerPickupReturn !== undefined)
        updateData.sellerPickupReturn = fieldData.sellerPickupReturn;
      if (fieldData.isCodAvailable !== undefined)
        updateData.isCodAvailable = fieldData.isCodAvailable;
      if (fieldData.isManufacturer !== undefined)
        updateData.isManufacturer = fieldData.isManufacturer;
      if (fieldData.manufacturerName !== undefined)
        updateData.manufacturerName = fieldData.manufacturerName;
      if (fieldData.manufacturerAddress !== undefined)
        updateData.manufacturerAddress = fieldData.manufacturerAddress;
      if (fieldData.minPurchaseLimit !== undefined)
        updateData.minPurchaseLimit = fieldData.minPurchaseLimit;
      if (fieldData.maxPurchaseLimit !== undefined)
        updateData.maxPurchaseLimit = fieldData.maxPurchaseLimit;
      if (fieldData.standardPackageQty !== undefined)
        updateData.standardPackageQty = fieldData.standardPackageQty;
      if (fieldData.lowStockQty !== undefined) updateData.lowStockQty = fieldData.lowStockQty;
      if (fieldData.orderMode !== undefined) updateData.orderMode = fieldData.orderMode;
      if (fieldData.visibility !== undefined) updateData.visibility = fieldData.visibility;
      if (fieldData.seoTitle !== undefined) updateData.seoTitle = fieldData.seoTitle;
      if (fieldData.seoDescription !== undefined)
        updateData.seoDescription = fieldData.seoDescription;
      if (fieldData.seoKeywords !== undefined) updateData.seoKeywords = fieldData.seoKeywords;
      if (fieldData.disableForBots !== undefined)
        updateData.disableForBots = fieldData.disableForBots;
      if (fieldData.availabilityMode !== undefined)
        updateData.availabilityMode = fieldData.availabilityMode;
      if (fieldData.cancellable !== undefined) updateData.cancellable = fieldData.cancellable;
      if (fieldData.returnable !== undefined) updateData.returnable = fieldData.returnable;
      if (fieldData.timeToShipValue !== undefined)
        updateData.timeToShipValue = fieldData.timeToShipValue;
      if (fieldData.timeToShipUnit !== undefined)
        updateData.timeToShipUnit = fieldData.timeToShipUnit;
      if (fieldData.instructions !== undefined) updateData.instructions = fieldData.instructions;
      if (fieldData.storageConditions !== undefined)
        updateData.storageConditions = fieldData.storageConditions;
      if (fieldData.includedItems !== undefined) updateData.includedItems = fieldData.includedItems;
      if (fieldData.sizeChartUrl !== undefined) updateData.sizeChartUrl = fieldData.sizeChartUrl;
      if (fieldData.giTag !== undefined) updateData.giTag = fieldData.giTag;
      if (fieldData.silkMark !== undefined) updateData.silkMark = fieldData.silkMark;
      if (fieldData.haveOndcAttributes !== undefined)
        updateData.haveOndcAttributes = fieldData.haveOndcAttributes;

      const updatedProduct = await db.$transaction(async (tx) => {
        const nameForSlug =
          fieldData.productName !== undefined ? fieldData.productName : product.productName;
        if (fieldData.aliasSlug !== undefined) {
          const raw = fieldData.aliasSlug;
          const trimmed = typeof raw === 'string' ? raw.trim() : '';
          const cleared = raw === null || trimmed === '';
          if (cleared) {
            updateData.aliasSlug = await findUniqueProductAliasSlug(
              tx,
              buildDefaultProductAliasSlug(nameForSlug, productId),
              productId,
            );
          } else if (trimmed !== product.aliasSlug) {
            updateData.aliasSlug = trimmed;
          }
        } else if (product.aliasSlug == null || String(product.aliasSlug).trim() === '') {
          updateData.aliasSlug = await findUniqueProductAliasSlug(
            tx,
            buildDefaultProductAliasSlug(nameForSlug, productId),
            productId,
          );
        }

        if (Object.keys(updateData).length > 0) {
          await tx.product.update({
            where: { id: productId },
            data: updateData,
          });
        }

        if (replaceVariantTree && hasVariantsPayload && (allNewTree || allNewFlat)) {
          await deleteAllVariantsForProductTx(tx, productId);
          const fp = Number(product.defaultPrice);
          const fm = Number(product.mrp);
          if (allNewTree) {
            await insertVariantTreeInTx(tx, productId, variants as CreateVariantDTO[], fp, fm);
          } else {
            for (const v of variants!) {
              await createVariantWithImagesInTx(tx, productId, v as CreateVariantDTO);
            }
          }
        } else {
          if (removeVariantIds && removeVariantIds.length > 0) {
            for (const rid of removeVariantIds) {
              await tx.productVariant.delete({ where: { id: rid } });
            }
          }

          if (variants && variants.length > 0) {
            for (const item of variants) {
              if (isVariantUpdateItem(item)) {
                const { id, ...rest } = item;
                const vImages = rest.images;
                const vOndcAttributes = rest.ondcAttributes;
                const patch = buildVariantUpdatePatch(rest as UpdateVariantDTO);
                if (Object.keys(patch).length > 0) {
                  await tx.productVariant.update({ where: { id }, data: patch });
                }
                if (vImages !== undefined) {
                  await replaceVariantImagesInTx(tx, id, vImages);
                }
                if (vOndcAttributes !== undefined) {
                  await replaceProductOndcAttributesInTx(tx, productId, id, vOndcAttributes);
                }
              } else {
                await createVariantWithImagesInTx(tx, productId, item as CreateVariantDTO);
              }
            }
          }
        }

        if (images && images.length > 0) {
          await insertProductImagesInTx(tx, productId, images);
        }

        if (attributes !== undefined) {
          await replaceProductAttributesInTx(tx, productId, attributes);
        }

        if (ondcAttributes !== undefined) {
          await replaceProductOndcAttributesInTx(tx, productId, null, ondcAttributes);
        }

        const n = await tx.productVariant.count({ where: { productId } });
        const hasModifiedVariants =
          replaceVariantTree || (removeVariantIds && removeVariantIds.length > 0);
        if (hasModifiedVariants || (variants && variants.length > 0)) {
          if (n < 1) throw new Error('PRODUCT_HAS_NO_VARIANTS');
        }
        await tx.product.update({ where: { id: productId }, data: { noOfVariants: n } });

        return tx.product.findUniqueOrThrow({
          where: { id: productId },
          include: {
            category: true,
            attributes: true,
            variants: {
              include: {
                variantImages: { orderBy: { sortOrder: 'asc' } },
                ondcAttributes: { orderBy: { sortOrder: 'asc' } },
              },
            },
            ondcAttributes: { orderBy: { sortOrder: 'asc' } },
            images: true,
          },
        });
      });
      const stock = Number(updatedProduct.stock ?? 0);
      const lowStockQty = Number(updatedProduct.lowStockQty ?? 0);

      if (lowStockQty > 0 && stock <= lowStockQty) {
        const sellerUser = await db.user.findUnique({
          where: { id: Number(product.storeId) },
          select: { name: true, email: true },
        });

        if (sellerUser?.email) {
          void mailServiceAsync({
            to: sellerUser.email,
            subject: `Low Stock Alert - ${updatedProduct.productName}`,
            html: SellerMailTemplate.lowStockAlert({
              sellerName: sellerUser.name,
              productName: updatedProduct.productName,
              stock,
            }),
            text: `Low stock alert for ${updatedProduct.productName}. Remaining stock: ${stock}`,
          });
        }
      }

      return ApiResponse.success(res, 'Product updated successfully', updatedProduct);
    } catch (error: any) {
      if (String(error?.message) === 'PRODUCT_HAS_NO_VARIANTS') {
        return ApiResponse.badRequest(res, 'A product must have at least one variant');
      }
      if (error.code === 'P2002') {
        return ApiResponse.conflict(res, 'Duplicate field value', error);
      }
      if (String(error?.message ?? '').startsWith('VARIANT_PARENT_NOT_FOUND')) {
        return ApiResponse.badRequest(
          res,
          'Invalid variant tree: a parentId does not match any node id in the payload',
        );
      }
      return ApiResponse.serverError(res, 'Error updating product', error);
    }
  };

  /**
   * Delete a product
   */
  public deleteProduct = async (
    req: Request,
    res: Response,
    storeId: bigint,
    productId: bigint,
  ) => {
    try {
      const product = await db.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        return ApiResponse.notFound(res, 'Product not found');
      }

      if (product.storeId !== storeId) {
        return ApiResponse.forbidden(res, 'Unauthorized to delete this product');
      }

      await db.product.delete({
        where: { id: productId },
      });

      return ApiResponse.success(res, 'Product deleted successfully');
    } catch (error) {
      return ApiResponse.serverError(res, 'Error deleting product', error);
    }
  };

  /**
   * Add a product image
   */
  public addProductImage = async (
    req: Request,
    res: Response,
    storeId: bigint,
    productId: bigint,
    data: CreateProductImageDTO,
  ) => {
    try {
      const product = await db.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        return ApiResponse.notFound(res, 'Product not found');
      }

      if (product.storeId !== storeId) {
        return ApiResponse.forbidden(res, 'Unauthorized to add image to this product');
      }

      // Get the max sort order for this product
      const lastImage = await db.productImage.findFirst({
        where: { productId },
        orderBy: { sortOrder: 'desc' },
      });

      const sortOrder = (lastImage?.sortOrder ?? -1) + 1;

      if (!data.imageUrl) {
        return ApiResponse.badRequest(res, 'image file or imageUrl is required');
      }

      const image = await db.productImage.create({
        data: {
          productId,
          imageUrl: data.imageUrl,
          altText: data.altText || null,
          sortOrder: data.sortOrder ?? sortOrder,
        },
      });

      return ApiResponse.created(res, 'Product image added successfully', image);
    } catch (error) {
      return ApiResponse.serverError(res, 'Error adding product image', error);
    }
  };

  /**
   * Delete a product image
   */
  public deleteProductImage = async (
    req: Request,
    res: Response,
    storeId: bigint,
    productId: bigint,
    imageId: bigint,
  ) => {
    try {
      const product = await db.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        return ApiResponse.notFound(res, 'Product not found');
      }

      if (product.storeId !== storeId) {
        return ApiResponse.forbidden(res, 'Unauthorized to delete image from this product');
      }

      const image = await db.productImage.findUnique({
        where: { id: imageId },
      });

      if (!image || image.productId !== productId) {
        return ApiResponse.notFound(res, 'Image not found');
      }

      await db.productImage.delete({
        where: { id: imageId },
      });

      return ApiResponse.success(res, 'Product image deleted successfully');
    } catch (error) {
      return ApiResponse.serverError(res, 'Error deleting product image', error);
    }
  };

  /**
   * Reorder product images
   */
  public reorderProductImages = async (
    req: Request,
    res: Response,
    storeId: bigint,
    productId: bigint,
    imageIds: bigint[],
  ) => {
    try {
      const product = await db.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        return ApiResponse.notFound(res, 'Product not found');
      }

      if (product.storeId !== storeId) {
        return ApiResponse.forbidden(res, 'Unauthorized to reorder images for this product');
      }

      // Update sort order for each image
      const updatePromises = imageIds.map((imageId, index) =>
        db.productImage.update({
          where: { id: imageId },
          data: { sortOrder: index },
        }),
      );

      await Promise.all(updatePromises);

      return ApiResponse.success(res, 'Product images reordered successfully');
    } catch (error) {
      return ApiResponse.serverError(res, 'Error reordering product images', error);
    }
  };

  /**
   * Add a product variant
   */
  public addVariant = async (
    req: Request,
    res: Response,
    storeId: bigint,
    productId: bigint,
    data: CreateVariantDTO,
  ) => {
    try {
      const product = await db.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        return ApiResponse.notFound(res, 'Product not found');
      }

      if (product.storeId !== storeId) {
        return ApiResponse.forbidden(res, 'Unauthorized to add variant to this product');
      }

      if (isTreeVariantNode(data)) {
        return ApiResponse.badRequest(
          res,
          'Hierarchy variants are saved via product create/update with a full variants tree (or replaceVariantTree on update)',
        );
      }

      // Check for duplicate SKU
      const existingSku = await db.productVariant.findUnique({
        where: { sku: data.sku },
      });

      if (existingSku) {
        return ApiResponse.conflict(res, 'SKU already exists');
      }

      const variant = await db.$transaction(async (tx) => {
        const v = await createVariantWithImagesInTx(tx, productId, data);
        await tx.product.update({
          where: { id: productId },
          data: { noOfVariants: { increment: 1 } },
        });
        return tx.productVariant.findUniqueOrThrow({
          where: { id: v.id },
          include: { variantImages: { orderBy: { sortOrder: 'asc' } } },
        });
      });

      return ApiResponse.created(res, 'Product variant added successfully', variant);
    } catch (error) {
      return ApiResponse.serverError(res, 'Error adding product variant', error);
    }
  };

  /**
   * Update a product variant
   */
  public updateVariant = async (
    req: Request,
    res: Response,
    storeId: bigint,
    productId: bigint,
    variantId: bigint,
    data: UpdateVariantDTO,
  ) => {
    try {
      const product = await db.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        return ApiResponse.notFound(res, 'Product not found');
      }

      if (product.storeId !== storeId) {
        return ApiResponse.forbidden(res, 'Unauthorized to update variant for this product');
      }

      const variant = await db.productVariant.findUnique({
        where: { id: variantId },
      });

      if (!variant || variant.productId !== productId) {
        return ApiResponse.notFound(res, 'Variant not found');
      }

      // Check for duplicate SKU if being updated
      const nextSku = normalizeSkuInput(data.sku);
      const currentSku = normalizeSkuInput(variant.sku);
      if (nextSku && nextSku !== currentSku) {
        const existingSku = await db.productVariant.findUnique({
          where: { sku: nextSku },
        });

        if (existingSku) {
          return ApiResponse.conflict(res, 'SKU already exists');
        }
      }

      const patch = buildVariantUpdatePatch(data);
      const vImages = (data as UpdateVariantDTO & { images?: VariantImageInput[] }).images;

      const updatedVariant = await db.$transaction(async (tx) => {
        if (Object.keys(patch).length > 0) {
          await tx.productVariant.update({
            where: { id: variantId },
            data: patch,
          });
        }
        if (vImages !== undefined) {
          await replaceVariantImagesInTx(tx, variantId, vImages);
        }
        return tx.productVariant.findUniqueOrThrow({
          where: { id: variantId },
          include: { variantImages: { orderBy: { sortOrder: 'asc' } } },
        });
      });

      return ApiResponse.success(res, 'Product variant updated successfully', updatedVariant);
    } catch (error) {
      return ApiResponse.serverError(res, 'Error updating product variant', error);
    }
  };

  /**
   * Delete a product variant
   */
  public deleteVariant = async (
    req: Request,
    res: Response,
    storeId: bigint,
    productId: bigint,
    variantId: bigint,
  ) => {
    try {
      const product = await db.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        return ApiResponse.notFound(res, 'Product not found');
      }

      if (product.storeId !== storeId) {
        return ApiResponse.forbidden(res, 'Unauthorized to delete variant for this product');
      }

      const variant = await db.productVariant.findUnique({
        where: { id: variantId },
      });

      if (!variant || variant.productId !== productId) {
        return ApiResponse.notFound(res, 'Variant not found');
      }

      await db.$transaction(async (tx) => {
        await tx.productVariant.delete({
          where: { id: variantId },
        });
        const remaining = await tx.productVariant.count({ where: { productId } });
        await tx.product.update({
          where: { id: productId },
          data: { noOfVariants: remaining },
        });
      });

      return ApiResponse.success(res, 'Product variant deleted successfully');
    } catch (error) {
      return ApiResponse.serverError(res, 'Error deleting product variant', error);
    }
  };

  /**
   * Update inventory for a variant
   */
  public updateInventory = async (
    req: Request,
    res: Response,
    storeId: bigint,
    productId: bigint,
    data: UpdateInventoryDTO,
  ) => {
    try {
      const product = await db.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        return ApiResponse.notFound(res, 'Product not found');
      }

      if (product.storeId !== storeId) {
        return ApiResponse.forbidden(res, 'Unauthorized to update inventory for this product');
      }

      const variant = await db.productVariant.findUnique({
        where: { id: data.variantId },
      });

      if (!variant || variant.productId !== productId) {
        return ApiResponse.notFound(res, 'Variant not found');
      }

      const storeLocation = await db.storeLocation.findUnique({
        where: { id: data.storeLocationId },
      });

      if (!storeLocation || storeLocation.storeId !== storeId) {
        return ApiResponse.notFound(res, 'Store location not found');
      }

      // Upsert inventory
      const inventory = await db.inventory.upsert({
        where: {
          storeLocationId_variantId: {
            storeLocationId: data.storeLocationId,
            variantId: data.variantId,
          },
        },
        update: {
          qtyOnHand: data.qtyOnHand,
          qtyReserved: data.qtyReserved ?? 0,
        },
        create: {
          storeLocationId: data.storeLocationId,
          variantId: data.variantId,
          qtyOnHand: data.qtyOnHand,
          qtyReserved: data.qtyReserved ?? 0,
        },
      });

      return ApiResponse.success(res, 'Inventory updated successfully', inventory);
    } catch (error) {
      return ApiResponse.serverError(res, 'Error updating inventory', error);
    }
  };

  /**
   * Set serviceability (cities and pincodes)
   */
  public setServiceability = async (
    req: Request,
    res: Response,
    storeId: bigint,
    productId: bigint,
    data: SetServiceabilityDTO,
  ) => {
    try {
      const product = await db.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        return ApiResponse.notFound(res, 'Product not found');
      }

      if (product.storeId !== storeId) {
        return ApiResponse.forbidden(res, 'Unauthorized to set serviceability for this product');
      }

      await db.$transaction(async (tx) => {
        // Delete existing serviceability data if provided
        if (data.cities) {
          await tx.productServiceableCity.deleteMany({
            where: { productId },
          });

          // Add new cities
          if (data.cities.length > 0) {
            await tx.productServiceableCity.createMany({
              data: data.cities.map((city) => ({
                productId,
                city,
              })),
            });
          }
        }

        if (data.pincodes) {
          await tx.productServiceablePincode.deleteMany({
            where: { productId },
          });

          // Add new pincodes
          if (data.pincodes.length > 0) {
            await tx.productServiceablePincode.createMany({
              data: data.pincodes.map((pincode) => ({
                productId,
                pincode,
              })),
            });
          }
        }
      });

      const updatedProduct = await db.product.findUnique({
        where: { id: productId },
        include: {
          attributes: true,
          serviceableCities: true,
          serviceablePincodes: true,
        },
      });

      return ApiResponse.success(res, 'Serviceability updated successfully', updatedProduct);
    } catch (error) {
      return ApiResponse.serverError(res, 'Error updating serviceability', error);
    }
  };

  /**
   * Active categories for seller product form (hierarchy via `parentId`).
   */
  public listCatalogCategories = async (req: Request, res: Response) => {
    try {
      const rows = await db.category.findMany({
        where: { isActive: true },
        select: { id: true, parentId: true, name: true, slug: true, domainCode: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
      return ApiResponse.success(res, 'Categories fetched successfully', rows);
    } catch (error) {
      return ApiResponse.serverError(res, 'Error listing categories', error);
    }
  };

  /**
   * Same shape as Mrignayanee `CMSCategory.getUITree`: nested tree, `level`, `is_selectable`,
   * no `parent_id` / `sort_order` on the wire (Mrignayanee deletes those after build).
   */
  public listCatalogCategoryTree = async (req: Request, res: Response) => {
    try {
      const rows = await db.category.findMany({
        where: { isActive: true },
        select: {
          id: true,
          parentId: true,
          name: true,
          slug: true,
          domainCode: true,
          sortOrder: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });

      type Node = {
        id: bigint;
        name: string;
        slug: string;
        domainCode: string | null;
        parentId: bigint | null;
        sortOrder: number;
        children: Node[];
      };

      const map = new Map<string, Node>();
      for (const r of rows) {
        map.set(String(r.id), {
          id: r.id,
          name: r.name,
          slug: r.slug,
          domainCode: r.domainCode,
          parentId: r.parentId,
          sortOrder: r.sortOrder,
          children: [],
        });
      }

      const tree: Node[] = [];
      map.forEach((cat) => {
        if (cat.parentId === null) {
          tree.push(cat);
        } else {
          const parent = map.get(String(cat.parentId));
          if (parent) parent.children.push(cat);
        }
      });

      type Out = {
        id: string;
        name: string;
        slug: string;
        domainCode: string | null;
        children: Out[];
        level: number;
        is_selectable: boolean;
      };

      const markSelectable = (nodes: Node[], depth: number): Out[] =>
        nodes.map((cat) => {
          const hasChildren = cat.children.length > 0;
          const childrenOut = hasChildren ? markSelectable(cat.children, depth + 1) : [];
          const base: Out = {
            id: String(cat.id),
            name: cat.name,
            slug: cat.slug,
            domainCode: cat.domainCode,
            children: childrenOut,
            level: depth,
            is_selectable: !hasChildren,
          };
          return base;
        });

      const out = markSelectable(tree, 0);
      return ApiResponse.success(res, 'Category tree fetched successfully', out);
    } catch (error) {
      return ApiResponse.serverError(res, 'Error building category tree', error);
    }
  };

  /**
   * Single product for edit (store-scoped)
   */
  public getStoreProduct = async (
    req: Request,
    res: Response,
    storeId: bigint,
    productId: bigint,
  ) => {
    try {
      const product = await db.product.findFirst({
        where: { id: productId, storeId },
        include: {
          category: true,
          attributes: true,
          variants: {
            include: {
              variantImages: { orderBy: { sortOrder: 'asc' } },
              ondcAttributes: { orderBy: { sortOrder: 'asc' } },
            },
          },
          ondcAttributes: { orderBy: { sortOrder: 'asc' } },
          images: { orderBy: { sortOrder: 'asc' } },
        },
      });
      if (!product) {
        return ApiResponse.notFound(res, 'Product not found');
      }
      return ApiResponse.success(res, 'Product fetched successfully', product);
    } catch (error) {
      return ApiResponse.serverError(res, 'Error fetching product', error);
    }
  };
}

export const productService = ProductService.getInstance();
