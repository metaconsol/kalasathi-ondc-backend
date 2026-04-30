import type { Cart, CartItem } from '~/generated/prisma/client';
import { Prisma } from '~/generated/prisma/client';
import { CartStatus } from '~/generated/prisma/enums';

import { db } from '~/lib/db';
import { ApiError } from '~/lib/response';
import { serializeBigInt } from '~/lib/utils';

import type { CartOwner } from '~/service/cart/cart.types';

const storeIsActive = { isActive: true } as const;

/** Rows from your existing `products` / `product_variants` tables (not Prisma models). */
type ProductRow = {
  id: bigint;
  store_id: bigint;
  product_name: string;
  default_price: unknown;
  stock: number;
};

type ProductImageRow = {
  product_id: bigint;
  image_url: string;
};

type VariantRow = {
  id: bigint;
  product_id: bigint;
  price: unknown | null;
  variant_name: string | null;
  sku: string | null;
};

function toPrismaDecimal(v: unknown): Prisma.Decimal {
  const s =
    typeof v === 'object' && v !== null && 'toString' in v
      ? (v as { toString: () => string }).toString()
      : String(v);
  return new Prisma.Decimal(s);
}

function toDecimalString(value: unknown): string {
  if (value == null) return '0';
  if (typeof value === 'object' && value !== null && 'toString' in value) {
    return (value as { toString: () => string }).toString();
  }
  return String(value);
}

function toBigIntStrict(id: string | number | bigint, label: string): bigint {
  if (typeof id === 'bigint') return id;
  const n = typeof id === 'number' ? id : Number(String(id).trim());
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw ApiError.BAD_REQUEST(`Invalid ${label}`);
  }
  return BigInt(Math.trunc(n));
}

function bodyVariantToDbKey(variant_id: number | null | undefined): bigint {
  if (variant_id === undefined || variant_id === null || variant_id === 0) {
    return 0n;
  }
  return toBigIntStrict(variant_id, 'variant_id');
}

async function fetchProductRow(
  client: typeof db | Prisma.TransactionClient,
  storeId: bigint,
  productId: bigint,
): Promise<ProductRow | null> {
  const rows = await client.$queryRaw<ProductRow[]>(Prisma.sql`
    SELECT id, store_id, product_name, default_price, stock
    FROM products
    WHERE id = ${productId}
      AND store_id = ${storeId}
      AND publish_status = 'publish'
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function fetchVariantRow(
  client: typeof db | Prisma.TransactionClient,
  productId: bigint,
  variantId: bigint,
): Promise<VariantRow | null> {
  const rows = await client.$queryRaw<VariantRow[]>(Prisma.sql`
    SELECT id, product_id, price, variant_name, sku
    FROM product_variants
    WHERE id = ${variantId}
      AND product_id = ${productId}
      AND is_active = 1
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function loadAndValidateCatalog(
  client: typeof db | Prisma.TransactionClient,
  params: { storeId: bigint; productId: bigint; variantId: bigint },
): Promise<{ product: ProductRow; variant: VariantRow | null; unitPrice: Prisma.Decimal }> {
  const store = await client.store.findFirst({
    where: { id: params.storeId, ...storeIsActive },
  });
  if (!store) {
    throw ApiError.NOT_FOUND('Store not found or inactive');
  }

  const product = await fetchProductRow(client, params.storeId, params.productId);
  if (!product) {
    throw ApiError.NOT_FOUND('Product not found for this store');
  }

  let variant: VariantRow | null = null;
  if (params.variantId !== 0n) {
    variant = await fetchVariantRow(client, params.productId, params.variantId);
    if (!variant) {
      throw ApiError.BAD_REQUEST('Invalid product variant');
    }
  }

  const unitPrice =
    variant?.price != null
      ? toPrismaDecimal(variant.price)
      : toPrismaDecimal(product.default_price);
  return { product, variant, unitPrice };
}

function availableStock(product: ProductRow, variant: VariantRow | null): number {
  // Since VariantRow no longer has stock_qty in the new schema, we fallback to product level stock
  // or a high number if variants are managed purely by inventory table (not joined here).
  return Number(product.stock);
}

async function findCartByOwner(owner: CartOwner): Promise<Cart | null> {
  if ('userId' in owner && owner.userId != null) {
    return db.cart.findUnique({ where: { userId: BigInt(owner.userId) } });
  }
  if ('sessionId' in owner && owner.sessionId) {
    return db.cart.findUnique({ where: { sessionId: owner.sessionId } });
  }
  return null;
}

async function findOrCreateCart(owner: CartOwner): Promise<Cart> {
  const existing = await findCartByOwner(owner);
  if (existing) return existing;
  if ('userId' in owner && owner.userId != null) {
    return db.cart.create({
      data: {
        userId: BigInt(owner.userId),
        status: CartStatus.active,
        currency: 'INR',
      },
    });
  }
  if ('sessionId' in owner && owner.sessionId) {
    return db.cart.create({
      data: {
        sessionId: owner.sessionId,
        status: CartStatus.active,
        currency: 'INR',
      },
    });
  }
  throw ApiError.BAD_REQUEST('Invalid cart owner');
}

const CART_ITEM_OWNER_HINT =
  'Use the same Authorization Bearer or X-Cart-Session as when you added the item. PATCH /cart/items/:id expects the line id from GET /cart (items[].id), not product_id.';

async function assertCartItemOwned(itemId: bigint, owner: CartOwner): Promise<CartItem> {
  const item = await db.cartItem.findUnique({
    where: { id: itemId },
    include: { cart: true },
  });
  if (!item) {
    throw ApiError.NOT_FOUND('Cart item not found');
  }

  const userOwner = 'userId' in owner && owner.userId != null ? BigInt(owner.userId) : null;
  const sessionOwner = 'sessionId' in owner && owner.sessionId ? owner.sessionId : null;

  if (userOwner != null && item.cart.userId != null && item.cart.userId === userOwner) {
    return item;
  }
  if (sessionOwner != null && item.cart.sessionId === sessionOwner) {
    return item;
  }

  throw ApiError.FORBIDDEN(`This line item is not in your cart. ${CART_ITEM_OWNER_HINT}`);
}

function assertQtyPositive(qty: number) {
  if (!Number.isInteger(qty) || qty < 1) {
    throw ApiError.BAD_REQUEST('Quantity must be a positive integer');
  }
}

function sameLine(
  a: { productId: bigint; variantId: bigint },
  b: { productId: bigint; variantId: bigint },
): boolean {
  return a.productId === b.productId && a.variantId === b.variantId;
}

const cartItemInclude = {
  store: { select: { id: true, storeName: true, storeSlug: true } },
} as const;

async function loadVariantMapForItems(
  items: CartItem[],
): Promise<Map<bigint, { id: bigint; name: string | null; sku: string | null }>> {
  const variantById = new Map<bigint, { id: bigint; name: string | null; sku: string | null }>();
  const variantIds = [...new Set(items.map((i) => i.variantId).filter((id) => id !== 0n))];
  if (!variantIds.length) return variantById;
  const rows = await db.$queryRaw<VariantRow[]>(Prisma.sql`
    SELECT id, product_id, price, variant_name, sku
    FROM product_variants
    WHERE id IN (${Prisma.join(variantIds)})
  `);
  for (const v of rows) {
    variantById.set(v.id, { id: v.id, name: v.name, sku: v.sku });
  }
  return variantById;
}

async function loadProductMapForItems(
  items: CartItem[],
): Promise<
  Map<bigint, { id: bigint; product_name: string; store_id: bigint; image_url: string | null }>
> {
  const productById = new Map<
    bigint,
    { id: bigint; product_name: string; store_id: bigint; image_url: string | null }
  >();
  const productIds = [...new Set(items.map((i) => i.productId))];
  if (!productIds.length) return productById;
  const rows = await db.$queryRaw<ProductRow[]>(Prisma.sql`
    SELECT id, store_id, product_name, default_price, stock
    FROM products
    WHERE id IN (${Prisma.join(productIds)})
  `);
  const imageRows = await db.$queryRaw<ProductImageRow[]>(Prisma.sql`
    SELECT product_id, image_url
    FROM product_images
    WHERE product_id IN (${Prisma.join(productIds)})
    ORDER BY product_id ASC, sort_order ASC, id ASC
  `);
  const imageByProductId = new Map<bigint, string>();
  for (const imageRow of imageRows) {
    if (!imageByProductId.has(imageRow.product_id)) {
      imageByProductId.set(imageRow.product_id, imageRow.image_url);
    }
  }
  for (const p of rows) {
    productById.set(p.id, {
      id: p.id,
      product_name: p.product_name,
      store_id: p.store_id,
      image_url: imageByProductId.get(p.id) ?? null,
    });
  }
  return productById;
}

function mapCartItemRow(
  item: CartItem & { store: any },
  variantById: Map<bigint, { id: bigint; name: string | null; sku: string | null }>,
  productById: Map<
    bigint,
    { id: bigint; product_name: string; store_id: bigint; image_url: string | null }
  >,
) {
  const lineSubtotal = Number(item.priceSnapshot) * item.qty;
  const v = item.variantId !== 0n ? variantById.get(item.variantId) : undefined;
  const p = productById.get(item.productId);
  return {
    id: item.id.toString(),
    cart_id: item.cartId.toString(),
    store_id: item.storeId.toString(),
    product_id: item.productId.toString(),
    variant_id: item.variantId.toString(),
    qty: item.qty,
    price_snapshot: toDecimalString(item.priceSnapshot),
    mrp_snapshot: item.mrpSnapshot != null ? toDecimalString(item.mrpSnapshot) : null,
    tax_snapshot: item.taxSnapshot != null ? toDecimalString(item.taxSnapshot) : null,
    discount_snapshot:
      item.discountSnapshot != null ? toDecimalString(item.discountSnapshot) : null,
    line_subtotal: lineSubtotal,
    product: p
      ? {
          id: p.id.toString(),
          title: p.product_name,
          store_id: p.store_id.toString(),
          image_url: p.image_url,
        }
      : {
          id: item.productId.toString(),
          title: null as string | null,
          store_id: item.storeId.toString(),
          image_url: null as string | null,
        },
    variant: v
      ? {
          id: v.id.toString(),
          name: v.name,
          sku: v.sku,
        }
      : null,
    store: item.store
      ? {
          id: item.store.id.toString(),
          store_name: item.store.storeName,
          store_slug: item.store.storeSlug,
        }
      : null,
  };
}

export async function addCartItem(
  owner: CartOwner,
  body: { store_id: number; product_id: number; variant_id?: number | null; qty: number },
) {
  assertQtyPositive(body.qty);
  const storeId = toBigIntStrict(body.store_id, 'store_id');
  const productId = toBigIntStrict(body.product_id, 'product_id');
  const variantKey = bodyVariantToDbKey(body.variant_id);

  const { product, variant, unitPrice } = await loadAndValidateCatalog(db, {
    storeId,
    productId,
    variantId: variantKey,
  });

  const stock = availableStock(product, variant);
  if (stock < body.qty) {
    throw ApiError.BAD_REQUEST('Insufficient stock for requested quantity');
  }

  const cart = await findOrCreateCart(owner);

  const existing = await db.cartItem.findMany({
    where: { cartId: cart.id },
    select: { id: true, productId: true, variantId: true, qty: true },
  });
  const line = existing.find((row) => sameLine(row, { productId, variantId: variantKey }));

  const snapshotData = {
    priceSnapshot: unitPrice,
    mrpSnapshot: null,
    taxSnapshot: null,
    discountSnapshot: null,
  };

  if (line) {
    const newQty = line.qty + body.qty;
    if (stock < newQty) {
      throw ApiError.BAD_REQUEST('Insufficient stock for requested quantity');
    }
    const updated = await db.cartItem.update({
      where: { id: line.id },
      data: {
        qty: newQty,
        ...snapshotData,
        storeId,
        productId,
        variantId: variantKey,
      },
      include: cartItemInclude,
    });
    const variantById = await loadVariantMapForItems([updated as CartItem]);
    const productById = await loadProductMapForItems([updated as CartItem]);
    return serializeBigInt(mapCartItemRow(updated as any, variantById, productById));
  }

  const created = await db.cartItem.create({
    data: {
      cartId: cart.id,
      storeId,
      productId,
      variantId: variantKey,
      qty: body.qty,
      ...snapshotData,
    },
    include: cartItemInclude,
  });
  const variantById = await loadVariantMapForItems([created as CartItem]);
  const productById = await loadProductMapForItems([created as CartItem]);
  return serializeBigInt(mapCartItemRow(created as any, variantById, productById));
}

async function loadCartWithItems(owner: CartOwner) {
  const cart = await findCartByOwner(owner);
  if (!cart) {
    return { cart: null, items: [] as any[], variantById: new Map(), productById: new Map() };
  }
  const items = await db.cartItem.findMany({
    where: { cartId: cart.id },
    include: cartItemInclude,
    orderBy: { id: 'asc' },
  });
  const variantById = await loadVariantMapForItems(items as CartItem[]);
  const productById = await loadProductMapForItems(items as CartItem[]);
  return { cart, items, variantById, productById };
}

function computeTotals(items: { qty: number; priceSnapshot: unknown }[]) {
  let subtotal = 0;
  let totalItems = 0;
  for (const row of items) {
    subtotal += Number(row.priceSnapshot) * row.qty;
    totalItems += row.qty;
  }
  return { subtotal, total_items: totalItems };
}

export async function getCart(owner: CartOwner) {
  const { cart, items, variantById, productById } = await loadCartWithItems(owner);
  const { subtotal, total_items } = computeTotals(items);
  return serializeBigInt({
    id: cart?.id?.toString() ?? null,
    items: items.map((row) => mapCartItemRow(row as any, variantById, productById)),
    subtotal,
    total_items,
  });
}

export async function getCartSummary(owner: CartOwner) {
  const { items } = await loadCartWithItems(owner);
  const { subtotal } = computeTotals(items);
  const discount = 0;
  const shipping = 0;
  const total = subtotal - discount + shipping;
  return serializeBigInt({
    subtotal,
    discount,
    shipping,
    total,
    total_items: items.reduce((s, r) => s + r.qty, 0),
  });
}

export async function updateCartItemQty(owner: CartOwner, itemId: bigint, qty: number) {
  if (!Number.isInteger(qty) || qty < 0) {
    throw ApiError.BAD_REQUEST('Quantity must be a non-negative integer');
  }
  const row = await assertCartItemOwned(itemId, owner);

  if (qty === 0) {
    await db.cartItem.delete({ where: { id: itemId } });
    return serializeBigInt({ removed: true, id: itemId.toString() });
  }

  const { product, variant } = await loadAndValidateCatalog(db, {
    storeId: row.storeId,
    productId: row.productId,
    variantId: row.variantId,
  });

  const stock = availableStock(product, variant);
  if (stock < qty) {
    throw ApiError.BAD_REQUEST('Insufficient stock for requested quantity');
  }

  const unitPrice =
    variant?.price != null
      ? toPrismaDecimal(variant.price)
      : toPrismaDecimal(product.default_price);

  const updated = await db.cartItem.update({
    where: { id: itemId },
    data: {
      qty,
      priceSnapshot: unitPrice,
    },
    include: cartItemInclude,
  });
  const variantById = await loadVariantMapForItems([updated as CartItem]);
  const productById = await loadProductMapForItems([updated as CartItem]);
  return serializeBigInt(mapCartItemRow(updated as any, variantById, productById));
}

export async function removeCartItem(owner: CartOwner, itemId: bigint) {
  await assertCartItemOwned(itemId, owner);
  await db.cartItem.delete({ where: { id: itemId } });
}

export async function clearCart(owner: CartOwner) {
  const cart = await findCartByOwner(owner);
  if (!cart) return;
  await db.cart.delete({ where: { id: cart.id } });
}

export async function mergeGuestIntoUser(userId: number, guestSessionId: string) {
  const trimmed = guestSessionId.trim();
  if (!trimmed) {
    throw ApiError.BAD_REQUEST('session_id is required');
  }

  const guestCart = await db.cart.findUnique({
    where: { sessionId: trimmed },
    include: {
      items: true,
    },
  });

  if (!guestCart) {
    throw ApiError.NOT_FOUND(
      'No guest cart for this session_id. Add items using only X-Cart-Session (same string) and no Bearer token — if you send a valid Bearer on add-item, lines go to the user cart and there is nothing to merge by session.',
    );
  }

  if (!guestCart.items.length) {
    await db.cart.delete({ where: { id: guestCart.id } });
    return serializeBigInt({ merged_items: 0, message: 'Guest cart was empty' });
  }

  let userCart = await db.cart.findUnique({ where: { userId: BigInt(userId) } });
  if (!userCart) {
    userCart = await db.cart.create({
      data: {
        userId: BigInt(userId),
        status: CartStatus.active,
        currency: 'INR',
      },
    });
  }

  await db.$transaction(async (tx) => {
    for (const guestLine of guestCart.items) {
      const catalog = await loadAndValidateCatalog(tx, {
        storeId: guestLine.storeId,
        productId: guestLine.productId,
        variantId: guestLine.variantId,
      });
      const stock = availableStock(catalog.product, catalog.variant);

      const match = await tx.cartItem.findFirst({
        where: {
          cartId: userCart!.id,
          productId: guestLine.productId,
          variantId: guestLine.variantId,
        },
      });

      if (match) {
        const newQty = match.qty + guestLine.qty;
        if (stock < newQty) {
          throw ApiError.BAD_REQUEST(
            `Insufficient stock when merging line for product ${guestLine.productId.toString()}`,
          );
        }
        await tx.cartItem.update({
          where: { id: match.id },
          data: {
            qty: newQty,
            priceSnapshot: catalog.unitPrice,
            storeId: guestLine.storeId,
            productId: guestLine.productId,
            variantId: guestLine.variantId,
          },
        });
      } else {
        if (stock < guestLine.qty) {
          throw ApiError.BAD_REQUEST(
            `Insufficient stock when merging line for product ${guestLine.productId.toString()}`,
          );
        }
        await tx.cartItem.create({
          data: {
            cartId: userCart!.id,
            storeId: guestLine.storeId,
            productId: guestLine.productId,
            variantId: guestLine.variantId,
            qty: guestLine.qty,
            priceSnapshot: catalog.unitPrice,
            mrpSnapshot: null,
            taxSnapshot: null,
            discountSnapshot: null,
          },
        });
      }
    }

    await tx.cart.delete({ where: { id: guestCart.id } });
  });

  const mergedOwner: CartOwner = { userId };
  const summary = await getCart(mergedOwner);
  return serializeBigInt({
    merged: true,
    ...summary,
  });
}

/**
 * Validates the user cart for checkout (auth-only). Extend with payment/order creation.
 */
export async function validateCartForCheckout(userId: number) {
  const owner: CartOwner = { userId };
  const summary = await getCartSummary(owner);
  if (summary.total_items === 0) {
    throw ApiError.BAD_REQUEST('Cart is empty');
  }
  return summary;
}
