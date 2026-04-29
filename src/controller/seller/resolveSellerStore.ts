import type { Request } from 'express';
import { sqlQuery } from '~/lib/sql';

/** Express 5 may type params as string | string[] */
export function parseRequiredBigintParam(raw: string | string[] | undefined): bigint | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (!s || s === '') return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

export type ResolveSellerStoreResult =
  | { ok: true; storeId: bigint }
  | { ok: false; status: 400 | 403 | 404; message: string };

/**
 * Resolves store id from /seller/stores/:store_id/... or from the product row when using
 * /seller/products/:product_id/... (Postman-style) without store in the URL.
 */
export async function resolveSellerStoreContext(
  req: Request,
  opts: { productId?: bigint },
): Promise<ResolveSellerStoreResult> {
  const fromParams = req.params.store_id;
  const fromQuery = req.query.store_id;
  const explicit =
    fromParams !== undefined && fromParams !== ''
      ? String(fromParams)
      : fromQuery !== undefined && fromQuery !== ''
        ? Array.isArray(fromQuery)
          ? String(fromQuery[0])
          : String(fromQuery)
        : undefined;

  if (opts.productId !== undefined) {
    const rows = await sqlQuery<{ storeId: bigint }>(
      'SELECT `store_id` as storeId FROM `products` WHERE `id` = ? LIMIT 1',
      [opts.productId],
    );
    const product = rows[0] ?? null;
    if (!product) {
      return { ok: false, status: 404, message: 'Product not found' };
    }
    if (explicit !== undefined) {
      const want = BigInt(explicit);
      if (want !== product.storeId) {
        return { ok: false, status: 403, message: 'Store does not match this product' };
      }
      return { ok: true, storeId: want };
    }
    return { ok: true, storeId: product.storeId };
  }

  if (explicit !== undefined) {
    return { ok: true, storeId: BigInt(explicit) };
  }

  return { ok: false, status: 400, message: 'Store ID is required' };
}
