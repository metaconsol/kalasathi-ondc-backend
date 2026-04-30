import { sqlExec, sqlQuery, type SqlTx, withSqlTransaction } from '~/lib/sql';
import { ApiError } from '~/lib/response';
import { serializeBigInt } from '~/lib/utils';

import type { CartOwner } from '~/service/cart/cart.types';

type CartStatus = 'active' | 'abandoned' | 'converted';

type CartRow = {
  id: bigint;
  user_id: bigint | null;
  session_id: string | null;
  status: CartStatus;
  currency: string | null;
};

type CartItemRow = {
  id: bigint;
  cart_id: bigint;
  store_id: bigint;
  product_id: bigint;
  variant_id: bigint;
  qty: number;
  price_snapshot: any;
  mrp_snapshot: any | null;
  tax_snapshot: any | null;
  discount_snapshot: any | null;
};

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
  tx: SqlTx | undefined,
  storeId: bigint,
  productId: bigint,
): Promise<ProductRow | null> {
  const rows = await sqlQuery<ProductRow>(
    'SELECT id, store_id, product_name, default_price, stock FROM products WHERE id = ? AND store_id = ? AND publish_status = ? LIMIT 1',
    [productId, storeId, 'publish'],
    tx,
  );
  return rows[0] ?? null;
}

async function fetchVariantRow(
  tx: SqlTx | undefined,
  productId: bigint,
  variantId: bigint,
): Promise<VariantRow | null> {
  const rows = await sqlQuery<VariantRow>(
    'SELECT id, product_id, price, variant_name, sku FROM product_variants WHERE id = ? AND product_id = ? AND is_active = 1 LIMIT 1',
    [variantId, productId],
    tx,
  );
  return rows[0] ?? null;
}

async function loadAndValidateCatalog(
  tx: SqlTx | undefined,
  params: { storeId: bigint; productId: bigint; variantId: bigint },
): Promise<{ product: ProductRow; variant: VariantRow | null; unitPrice: string }> {
  const stores = await sqlQuery<{ id: bigint }>(
    'SELECT id FROM stores WHERE id = ? AND is_active = 1 AND deleted_at IS NULL LIMIT 1',
    [params.storeId],
    tx,
  );
  const store = stores[0] ?? null;
  if (!store) {
    throw ApiError.NOT_FOUND('Store not found or inactive');
  }

  const product = await fetchProductRow(tx, params.storeId, params.productId);
  if (!product) {
    throw ApiError.NOT_FOUND('Product not found for this store');
  }

  let variant: VariantRow | null = null;
  if (params.variantId !== 0n) {
    variant = await fetchVariantRow(tx, params.productId, params.variantId);
    if (!variant) {
      throw ApiError.BAD_REQUEST('Invalid product variant');
    }
  }

  const unitPrice =
    variant?.price != null
      ? toDecimalString(variant.price)
      : toDecimalString(product.default_price);
  return { product, variant, unitPrice };
}

function availableStock(product: ProductRow, variant: VariantRow | null): number {
  return Number(product.stock);
}

async function findCartByOwner(owner: CartOwner, tx?: SqlTx): Promise<CartRow | null> {
  if ('userId' in owner && owner.userId != null) {
    const rows = await sqlQuery<CartRow>(
      'SELECT * FROM `carts` WHERE `user_id` = ? LIMIT 1',
      [BigInt(owner.userId)],
      tx,
    );
    return rows[0] ?? null;
  }
  if ('sessionId' in owner && owner.sessionId) {
    const rows = await sqlQuery<CartRow>(
      'SELECT * FROM `carts` WHERE `session_id` = ? LIMIT 1',
      [owner.sessionId],
      tx,
    );
    return rows[0] ?? null;
  }
  return null;
}

async function findOrCreateCart(owner: CartOwner): Promise<CartRow> {
  const existing = await findCartByOwner(owner);
  if (existing) return existing;
  if ('userId' in owner && owner.userId != null) {
    const res = await sqlExec(
      'INSERT INTO `carts` (`user_id`, `status`, `currency`) VALUES (?, ?, ?)',
      [BigInt(owner.userId), 'active', 'INR'],
    );
    const rows = await sqlQuery<CartRow>('SELECT * FROM `carts` WHERE `id` = ? LIMIT 1', [
      BigInt(res.insertId as any),
    ]);
    return rows[0]!;
  }
  if ('sessionId' in owner && owner.sessionId) {
    const res = await sqlExec(
      'INSERT INTO `carts` (`session_id`, `status`, `currency`) VALUES (?, ?, ?)',
      [owner.sessionId, 'active', 'INR'],
    );
    const rows = await sqlQuery<CartRow>('SELECT * FROM `carts` WHERE `id` = ? LIMIT 1', [
      BigInt(res.insertId as any),
    ]);
    return rows[0]!;
  }
  throw ApiError.BAD_REQUEST('Invalid cart owner');
}

const CART_ITEM_OWNER_HINT =
  'Use the same Authorization Bearer or X-Cart-Session as when you added the item. PATCH /cart/items/:id expects the line id from GET /cart (items[].id), not product_id.';

async function assertCartItemOwned(
  itemId: bigint,
  owner: CartOwner,
): Promise<CartItemRow & { cart: CartRow }> {
  const rows = await sqlQuery<any>(
    'SELECT ci.*, c.`user_id`, c.`session_id` FROM `cart_items` ci JOIN `carts` c ON c.`id` = ci.`cart_id` WHERE ci.`id` = ? LIMIT 1',
    [itemId],
  );
  const item = rows[0] ?? null;
  if (!item) {
    throw ApiError.NOT_FOUND('Cart item not found');
  }

  const userOwner = 'userId' in owner && owner.userId != null ? BigInt(owner.userId) : null;
  const sessionOwner = 'sessionId' in owner && owner.sessionId ? owner.sessionId : null;

  if (userOwner != null && item.user_id != null && BigInt(item.user_id) === userOwner) {
    return {
      ...(item as any),
      cart: {
        id: item.cart_id,
        user_id: item.user_id,
        session_id: item.session_id,
        status: 'active',
        currency: 'INR',
      },
    };
  }
  if (sessionOwner != null && item.session_id === sessionOwner) {
    return {
      ...(item as any),
      cart: {
        id: item.cart_id,
        user_id: item.user_id,
        session_id: item.session_id,
        status: 'active',
        currency: 'INR',
      },
    };
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

function inPlaceholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(',');
}

async function loadVariantMapForItems(
  items: Array<{ variant_id: bigint }>,
): Promise<Map<bigint, { id: bigint; name: string | null; sku: string | null }>> {
  const variantById = new Map<bigint, { id: bigint; name: string | null; sku: string | null }>();
  const variantIds = [...new Set(items.map((i) => i.variant_id).filter((id) => id !== 0n))];
  if (!variantIds.length) return variantById;
  const rows = await sqlQuery<VariantRow>(
    `SELECT id, product_id, price, variant_name, sku FROM product_variants WHERE id IN (${inPlaceholders(
      variantIds.length,
    )})`,
    variantIds,
  );
  for (const v of rows) {
    variantById.set(v.id, { id: v.id, name: v.variant_name, sku: v.sku });
  }
  return variantById;
}

async function loadProductMapForItems(
  items: Array<{ product_id: bigint }>,
): Promise<
  Map<bigint, { id: bigint; product_name: string; store_id: bigint; image_url: string | null }>
> {
  const productById = new Map<
    bigint,
    { id: bigint; product_name: string; store_id: bigint; image_url: string | null }
  >();
  const productIds = [...new Set(items.map((i) => i.product_id))];
  if (!productIds.length) return productById;

  const rows = await sqlQuery<ProductRow>(
    `SELECT id, store_id, product_name, default_price, stock FROM products WHERE id IN (${inPlaceholders(
      productIds.length,
    )})`,
    productIds,
  );

  const imageRows = await sqlQuery<ProductImageRow>(
    `SELECT product_id, image_url FROM product_images WHERE product_id IN (${inPlaceholders(
      productIds.length,
    )}) ORDER BY product_id ASC, sort_order ASC, id ASC`,
    productIds,
  );

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
  item: CartItemRow & { store_name: string | null; store_slug: string | null },
  variantById: Map<bigint, { id: bigint; name: string | null; sku: string | null }>,
  productById: Map<
    bigint,
    { id: bigint; product_name: string; store_id: bigint; image_url: string | null }
  >,
) {
  const lineSubtotal = Number(item.price_snapshot) * item.qty;
  const v = item.variant_id !== 0n ? variantById.get(item.variant_id) : undefined;
  const p = productById.get(item.product_id);
  return {
    id: item.id.toString(),
    cart_id: item.cart_id.toString(),
    store_id: item.store_id.toString(),
    product_id: item.product_id.toString(),
    variant_id: item.variant_id.toString(),
    qty: item.qty,
    price_snapshot: toDecimalString(item.price_snapshot),
    mrp_snapshot: item.mrp_snapshot != null ? toDecimalString(item.mrp_snapshot) : null,
    tax_snapshot: item.tax_snapshot != null ? toDecimalString(item.tax_snapshot) : null,
    discount_snapshot:
      item.discount_snapshot != null ? toDecimalString(item.discount_snapshot) : null,
    line_subtotal: lineSubtotal,
    product: p
      ? {
          id: p.id.toString(),
          title: p.product_name,
          store_id: p.store_id.toString(),
          image_url: p.image_url,
        }
      : {
          id: item.product_id.toString(),
          title: null as string | null,
          store_id: item.store_id.toString(),
          image_url: null as string | null,
        },
    variant: v
      ? {
          id: v.id.toString(),
          name: v.name,
          sku: v.sku,
        }
      : null,
    store: {
      id: item.store_id.toString(),
      store_name: item.store_name,
      store_slug: item.store_slug,
    },
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

  const { product, variant, unitPrice } = await loadAndValidateCatalog(undefined, {
    storeId,
    productId,
    variantId: variantKey,
  });

  const stock = availableStock(product, variant);
  if (stock < body.qty) {
    throw ApiError.BAD_REQUEST('Insufficient stock for requested quantity');
  }

  const cart = await findOrCreateCart(owner);

  const existing = await sqlQuery<any>(
    'SELECT `id`, `product_id` as productId, `variant_id` as variantId, `qty` FROM `cart_items` WHERE `cart_id` = ?',
    [cart.id],
  );
  const line = existing.find((row: any) =>
    sameLine(
      { productId: BigInt(row.productId), variantId: BigInt(row.variantId) },
      { productId, variantId: variantKey },
    ),
  );

  const snapshotData = {
    price_snapshot: unitPrice,
    mrp_snapshot: null,
    tax_snapshot: null,
    discount_snapshot: null,
  };

  if (line) {
    const newQty = line.qty + body.qty;
    if (stock < newQty) {
      throw ApiError.BAD_REQUEST('Insufficient stock for requested quantity');
    }
    await sqlExec(
      'UPDATE `cart_items` SET `qty` = ?, `price_snapshot` = ?, `mrp_snapshot` = ?, `tax_snapshot` = ?, `discount_snapshot` = ?, `store_id` = ?, `product_id` = ?, `variant_id` = ? WHERE `id` = ?',
      [
        newQty,
        snapshotData.price_snapshot,
        snapshotData.mrp_snapshot,
        snapshotData.tax_snapshot,
        snapshotData.discount_snapshot,
        storeId,
        productId,
        variantKey,
        BigInt(line.id),
      ],
    );
    const updatedRows = await sqlQuery<any>(
      'SELECT ci.*, s.`store_name`, s.`store_slug` FROM `cart_items` ci JOIN `stores` s ON s.`id` = ci.`store_id` WHERE ci.`id` = ? LIMIT 1',
      [BigInt(line.id)],
    );
    const updated = updatedRows[0] as any;
    const variantById = await loadVariantMapForItems([updated]);
    const productById = await loadProductMapForItems([updated]);
    return serializeBigInt(mapCartItemRow(updated, variantById, productById));
  }

  const res = await sqlExec(
    'INSERT INTO `cart_items` (`cart_id`, `store_id`, `product_id`, `variant_id`, `qty`, `price_snapshot`, `mrp_snapshot`, `tax_snapshot`, `discount_snapshot`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      cart.id,
      storeId,
      productId,
      variantKey,
      body.qty,
      snapshotData.price_snapshot,
      snapshotData.mrp_snapshot,
      snapshotData.tax_snapshot,
      snapshotData.discount_snapshot,
    ],
  );
  const createdRows = await sqlQuery<any>(
    'SELECT ci.*, s.`store_name`, s.`store_slug` FROM `cart_items` ci JOIN `stores` s ON s.`id` = ci.`store_id` WHERE ci.`id` = ? LIMIT 1',
    [BigInt(res.insertId as any)],
  );
  const created = createdRows[0] as any;
  const variantById = await loadVariantMapForItems([created]);
  const productById = await loadProductMapForItems([created]);
  return serializeBigInt(mapCartItemRow(created, variantById, productById));
}

async function loadCartWithItems(owner: CartOwner) {
  const cart = await findCartByOwner(owner);
  if (!cart) {
    return { cart: null, items: [] as any[], variantById: new Map(), productById: new Map() };
  }
  const items = await sqlQuery<any>(
    'SELECT ci.*, s.`store_name`, s.`store_slug` FROM `cart_items` ci JOIN `stores` s ON s.`id` = ci.`store_id` WHERE ci.`cart_id` = ? ORDER BY ci.`id` ASC',
    [cart.id],
  );
  const variantById = await loadVariantMapForItems(items);
  const productById = await loadProductMapForItems(items);
  return { cart, items, variantById, productById };
}

function computeTotals(
  items: { qty: number; priceSnapshot?: unknown; price_snapshot?: unknown }[],
) {
  let subtotal = 0;
  let totalItems = 0;
  for (const row of items) {
    const price = row.price_snapshot ?? row.priceSnapshot ?? 0;
    subtotal += Number(price) * row.qty;
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
    await sqlExec('DELETE FROM `cart_items` WHERE `id` = ?', [itemId]);
    return serializeBigInt({ removed: true, id: itemId.toString() });
  }

  const { product, variant } = await loadAndValidateCatalog(undefined, {
    storeId: BigInt(row.store_id),
    productId: BigInt(row.product_id),
    variantId: BigInt(row.variant_id),
  });

  const stock = availableStock(product, variant);
  if (stock < qty) {
    throw ApiError.BAD_REQUEST('Insufficient stock for requested quantity');
  }

  const unitPrice =
    variant?.price != null
      ? toDecimalString(variant.price)
      : toDecimalString(product.default_price);

  await sqlExec('UPDATE `cart_items` SET `qty` = ?, `price_snapshot` = ? WHERE `id` = ?', [
    qty,
    unitPrice,
    itemId,
  ]);
  const updatedRows = await sqlQuery<any>(
    'SELECT ci.*, s.`store_name`, s.`store_slug` FROM `cart_items` ci JOIN `stores` s ON s.`id` = ci.`store_id` WHERE ci.`id` = ? LIMIT 1',
    [itemId],
  );
  const updated = updatedRows[0] as any;
  const variantById = await loadVariantMapForItems([updated]);
  const productById = await loadProductMapForItems([updated]);
  return serializeBigInt(mapCartItemRow(updated, variantById, productById));
}

export async function removeCartItem(owner: CartOwner, itemId: bigint) {
  await assertCartItemOwned(itemId, owner);
  await sqlExec('DELETE FROM `cart_items` WHERE `id` = ?', [itemId]);
}

export async function clearCart(owner: CartOwner) {
  const cart = await findCartByOwner(owner);
  if (!cart) return;
  await sqlExec('DELETE FROM `carts` WHERE `id` = ?', [cart.id]);
}

export async function mergeGuestIntoUser(userId: number, guestSessionId: string) {
  const trimmed = guestSessionId.trim();
  if (!trimmed) {
    throw ApiError.BAD_REQUEST('session_id is required');
  }

  const guestCartRows = await sqlQuery<CartRow>(
    'SELECT * FROM `carts` WHERE `session_id` = ? LIMIT 1',
    [trimmed],
  );
  const guestCart = guestCartRows[0] ?? null;

  if (!guestCart) {
    throw ApiError.NOT_FOUND(
      'No guest cart for this session_id. Add items using only X-Cart-Session (same string) and no Bearer token — if you send a valid Bearer on add-item, lines go to the user cart and there is nothing to merge by session.',
    );
  }

  const guestItems = await sqlQuery<CartItemRow>(
    'SELECT * FROM `cart_items` WHERE `cart_id` = ? ORDER BY `id` ASC',
    [guestCart.id],
  );
  if (!guestItems.length) {
    await sqlExec('DELETE FROM `carts` WHERE `id` = ?', [guestCart.id]);
    return serializeBigInt({ merged_items: 0, message: 'Guest cart was empty' });
  }

  await withSqlTransaction(async (tx) => {
    const userCartRows = await sqlQuery<CartRow>(
      'SELECT * FROM `carts` WHERE `user_id` = ? LIMIT 1',
      [BigInt(userId)],
      tx,
    );
    let userCart = userCartRows[0] ?? null;
    if (!userCart) {
      const res = await sqlExec(
        'INSERT INTO `carts` (`user_id`, `status`, `currency`) VALUES (?, ?, ?)',
        [BigInt(userId), 'active', 'INR'],
        tx,
      );
      const rows = await sqlQuery<CartRow>(
        'SELECT * FROM `carts` WHERE `id` = ? LIMIT 1',
        [BigInt(res.insertId as any)],
        tx,
      );
      userCart = rows[0]!;
    }

    for (const guestLine of guestItems) {
      const catalog = await loadAndValidateCatalog(tx, {
        storeId: guestLine.store_id,
        productId: guestLine.product_id,
        variantId: guestLine.variant_id,
      });
      const stock = availableStock(catalog.product, catalog.variant);

      const matchRows = await sqlQuery<any>(
        'SELECT * FROM `cart_items` WHERE `cart_id` = ? AND `product_id` = ? AND `variant_id` = ? LIMIT 1',
        [userCart.id, guestLine.product_id, guestLine.variant_id],
        tx,
      );
      const match = matchRows[0] ?? null;

      if (match) {
        const newQty = match.qty + guestLine.qty;
        if (stock < newQty) {
          throw ApiError.BAD_REQUEST(
            `Insufficient stock when merging line for product ${guestLine.product_id.toString()}`,
          );
        }
        await sqlExec(
          'UPDATE `cart_items` SET `qty` = ?, `price_snapshot` = ?, `store_id` = ?, `product_id` = ?, `variant_id` = ? WHERE `id` = ?',
          [
            newQty,
            catalog.unitPrice,
            guestLine.store_id,
            guestLine.product_id,
            guestLine.variant_id,
            match.id,
          ],
          tx,
        );
      } else {
        if (stock < guestLine.qty) {
          throw ApiError.BAD_REQUEST(
            `Insufficient stock when merging line for product ${guestLine.product_id.toString()}`,
          );
        }
        await sqlExec(
          'INSERT INTO `cart_items` (`cart_id`, `store_id`, `product_id`, `variant_id`, `qty`, `price_snapshot`, `mrp_snapshot`, `tax_snapshot`, `discount_snapshot`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            userCart.id,
            guestLine.store_id,
            guestLine.product_id,
            guestLine.variant_id,
            guestLine.qty,
            catalog.unitPrice,
            null,
            null,
            null,
            null,
          ],
          tx,
        );
      }
    }

    await sqlExec('DELETE FROM `carts` WHERE `id` = ?', [guestCart.id], tx);
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
