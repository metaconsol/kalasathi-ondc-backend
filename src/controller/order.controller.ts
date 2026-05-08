import type { Request, Response, NextFunction } from 'express';
import * as orderService from '~/service/order.service';
import { ApiResponse } from '~/lib/response';
import { sqlExec, sqlQuery } from '~/lib/sql';
import * as fs from 'fs';
import { randomUUID } from 'crypto';

export const createOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    let userId = (req as any).user?.id;
    const orderData = req.body;

    if (!orderData.cart_id || !orderData.billing_address) {
      return ApiResponse.badRequest(res, 'cart_id and billing_address are required');
    }

    // Handle Guest Checkout
    if (!userId) {
      const guestPhone = orderData.billing_address.phone;
      if (!guestPhone) {
        return ApiResponse.badRequest(res, 'Phone number is required for guest checkout');
      }

      // Find or create guest user
      // Fix: Updated table name to `User` and column names to camelCase to match DB schema
      const users = await sqlQuery<any>('SELECT id FROM `User` WHERE `phoneNumber` = ? LIMIT 1', [
        guestPhone,
      ]);
      let user = users[0];

      if (!user) {
        const generatedUsername = `guest_${guestPhone}`;
        const res = await sqlExec(
          `INSERT INTO user
    (username, phoneNumber, name, email, role, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            generatedUsername,
            guestPhone,
            orderData.billing_address.full_name || 'Guest User',
            orderData.billing_address.email || null,
            'USER',
          ],
        );
        user = { id: res.insertId };
      }

      if (!user) {
        const userRes: any = await sqlExec(
          `INSERT INTO user
    (
      phoneNumber,
      username,
      name,
      email,
      role,
      createdAt,
      updatedAt
    )
    VALUES (?, ?, ?, ?, ?, NOW(3), NOW(3))`,
          [
            guestPhone,
            `user_${guestPhone}`, // ✅ username
            orderData.billing_address.full_name || 'Guest User', // ✅ name
            orderData.billing_address.email || null,
            'USER',
          ],
        );

        user = { id: userRes.insertId };
      }

      userId = user.id;
    }

    const result = await orderService.createOrder(userId, orderData);

    return ApiResponse.created(res, 'Order created successfully', serializeBigInt(result));
  } catch (error: any) {
    console.error('Create Order Error:', error);
    fs.writeFileSync(
      'last_error.log',
      JSON.stringify({ message: error.message, stack: error.stack }, null, 2),
    );
    if (error.message && error.message.includes('not found')) {
      return ApiResponse.notFound(res, error.message);
    }
    if (error.message && error.message.includes('belongs to')) {
      return ApiResponse.badRequest(res, error.message);
    }
    next(error);
  }
};

export const listOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return ApiResponse.unauthorized(res, 'User not authenticated');
    }

    const { status, payment_status, page = '1', limit = '20' } = req.query;

    const result = await orderService.listOrders(userId, {
      status: status as string,
      payment_status: payment_status as string,
      page: parseInt(page as string, 10),
      limit: parseInt(limit as string, 10),
    });

    return ApiResponse.success(
      res,
      'Orders fetched successfully',
      serializeBigInt(result.data),
      serializeBigInt(result.pagination),
    );
  } catch (error) {
    next(error);
  }
};

export const getOrderDetails = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return ApiResponse.unauthorized(res, 'User not authenticated');
    }

    const { id } = req.params;

    const order = await orderService.getOrderDetails(userId, id as string);
    if (!order) {
      return ApiResponse.notFound(res, 'Order not found');
    }

    return ApiResponse.success(res, 'Order details fetched successfully', serializeBigInt(order));
  } catch (error) {
    next(error);
  }
};

export const cancelOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return ApiResponse.unauthorized(res, 'User not authenticated');
    }

    const { id } = req.params;
    const { note } = req.body;

    const result = await orderService.cancelOrder(userId, id as string, note);

    return ApiResponse.success(res, 'Order cancelled successfully', serializeBigInt(result));
  } catch (error: any) {
    if (error.message === 'Order not found') {
      return ApiResponse.notFound(res, error.message);
    }
    if (error.message.includes('Cannot cancel')) {
      return ApiResponse.badRequest(res, error.message);
    }
    next(error);
  }
};

export const orderTracking = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return ApiResponse.unauthorized(res, 'User not authenticated');
    }

    const { id } = req.params;

    const tracking = await orderService.orderTracking(userId, id as string);

    return ApiResponse.success(
      res,
      'Tracking details fetched successfully',
      serializeBigInt(tracking),
    );
  } catch (error: any) {
    if (error.message === 'Order not found') {
      return ApiResponse.notFound(res, error.message);
    }
    next(error);
  }
};

export const listReturns = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return ApiResponse.unauthorized(res, 'User not authenticated');
    }

    const { id } = req.params;

    const returns = await orderService.listReturns(userId, id as string);

    return ApiResponse.success(res, 'Returns fetched successfully', serializeBigInt(returns));
  } catch (error: any) {
    if (error.message === 'Order not found') {
      return ApiResponse.notFound(res, error.message);
    }
    next(error);
  }
};

export const requestReturn = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return ApiResponse.unauthorized(res, 'User not authenticated');
    }

    const { id } = req.params;
    const returnData = req.body;

    if (
      !returnData.order_item_id ||
      !returnData.reason ||
      !returnData.refund_amount ||
      !returnData.refund_mode
    ) {
      return ApiResponse.badRequest(res, 'Missing required return fields');
    }

    const result = await orderService.requestReturn(userId, id as string, returnData);

    return ApiResponse.created(res, 'Return requested successfully', serializeBigInt(result));
  } catch (error: any) {
    if (error.message.includes('not found')) {
      return ApiResponse.notFound(res, error.message);
    }
    if (error.message.includes('Can only')) {
      return ApiResponse.badRequest(res, error.message);
    }
    next(error);
  }
};

// Helper function to handle BigInt and Decimal serialization
function serializeBigInt(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInt);
  if (typeof obj === 'object') {
    if (obj instanceof Date) return obj.toISOString();

    // Handle Prisma Decimal.js instances via Duck Typing (checking internal properties)
    if ('d' in obj && 'e' in obj && 's' in obj) {
      if (typeof obj.toNumber === 'function') return obj.toNumber();
      return Number(obj.toString());
    }

    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, serializeBigInt(v)]));
  }
  return obj;
}
