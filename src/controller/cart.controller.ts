import type { NextFunction, Request, Response } from 'express';

import { getCartOwner } from '~/middleware/cart.middleware';
import { ApiError, ApiResponse } from '~/lib/response';
import * as cartService from '~/service/cart/cart.service';

function parseItemIdParam(raw: string | string[] | undefined): bigint {
  const rawOne = Array.isArray(raw) ? raw[0] : raw;
  const s = String(rawOne ?? '').trim();
  if (!/^\d+$/.test(s)) {
    throw ApiError.BAD_REQUEST('Invalid item id');
  }
  return BigInt(s);
}

function ownerFromRequest(req: Request) {
  return getCartOwner(req)!;
}

export const addItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { store_id, product_id, variant_id, qty } = req.body ?? {};
    if (store_id === undefined || product_id === undefined || qty === undefined) {
      return ApiResponse.badRequest(res, 'store_id, product_id, and qty are required');
    }
    const payload: {
      store_id: number;
      product_id: number;
      qty: number;
      variant_id?: number | null;
    } = {
      store_id: Number(store_id),
      product_id: Number(product_id),
      qty: Number(qty),
    };
    if (variant_id !== undefined) {
      payload.variant_id = variant_id === null ? null : Number(variant_id);
    }
    const data = await cartService.addCartItem(ownerFromRequest(req), payload);
    return ApiResponse.created(res, 'Item added to cart', data);
  } catch (error) {
    next(error);
  }
};

export const getCart = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await cartService.getCart(ownerFromRequest(req));
    return ApiResponse.success(res, 'Cart fetched successfully', data);
  } catch (error) {
    next(error);
  }
};

export const getSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await cartService.getCartSummary(ownerFromRequest(req));
    return ApiResponse.success(res, 'Cart summary fetched successfully', data);
  } catch (error) {
    next(error);
  }
};

export const patchItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { qty } = req.body ?? {};
    if (qty === undefined) {
      return ApiResponse.badRequest(res, 'qty is required');
    }
    const itemId = parseItemIdParam(req.params.itemId);
    const data = await cartService.updateCartItemQty(ownerFromRequest(req), itemId, Number(qty));
    return ApiResponse.success(res, 'Cart item updated', data);
  } catch (error) {
    next(error);
  }
};

export const removeItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const itemId = parseItemIdParam(req.params.itemId);
    await cartService.removeCartItem(ownerFromRequest(req), itemId);
    return ApiResponse.success(res, 'Cart item removed');
  } catch (error) {
    next(error);
  }
};

export const clearCart = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await cartService.clearCart(ownerFromRequest(req));
    return ApiResponse.success(res, 'Cart cleared successfully');
  } catch (error) {
    next(error);
  }
};

export const checkout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.id) {
      return ApiResponse.unauthorized(res, 'Authentication required for checkout');
    }
    const data = await cartService.validateCartForCheckout(req.user.id);
    return ApiResponse.success(res, 'Cart is ready for checkout', data);
  } catch (error) {
    next(error);
  }
};

export const merge = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.id) {
      return ApiResponse.unauthorized(res, 'Authentication required to merge cart');
    }
    const fromBody = (req.body ?? {}).session_id ?? (req.body ?? {}).sessionId;
    const rawHeader = req.headers['x-cart-session'];
    const fromHeader =
      typeof rawHeader === 'string'
        ? rawHeader
        : Array.isArray(rawHeader)
          ? (rawHeader[0] ?? '')
          : '';
    const raw = fromBody !== undefined && fromBody !== null ? String(fromBody) : fromHeader;
    const sid = raw.trim();
    if (!sid) {
      return ApiResponse.badRequest(
        res,
        'session_id is required (JSON body) or send the same value as X-Cart-Session header',
      );
    }
    if (sid.length > 100) {
      return ApiResponse.badRequest(res, 'session_id must be at most 100 characters');
    }
    const data = await cartService.mergeGuestIntoUser(req.user.id, sid);
    return ApiResponse.success(res, 'Cart merged successfully', data);
  } catch (error) {
    next(error);
  }
};
