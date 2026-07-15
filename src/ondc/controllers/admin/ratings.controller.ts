import type { Request, Response } from 'express';
import { ratingModel } from '~/ondc/models/rating.model';
import { ondcLogger } from '~/ondc/utils/logger.util';
import { orderModel } from '~/ondc/models/order.model';
import { assertOrderVisible } from '~/ondc/controllers/admin/orders.controller';
import { AppError } from '~/lib/response';

export async function getRatings(req: Request, res: Response): Promise<void> {
  try {
    const limit = parseInt(String(req.query['limit'])) || 50;
    const offset = parseInt(String(req.query['offset'])) || 0;
    const order_id = req.query['order_id'] ? String(req.query['order_id']) : undefined;
    const rating_category = req.query['rating_category']
      ? String(req.query['rating_category'])
      : undefined;

    // Sellers may only see ratings tied to their own orders — this had no
    // scoping at all before, leaking every seller's ratings to every seller.
    const isSeller = req.user?.role === 'SELLER';
    const sellerId = isSeller ? req.user?.id : undefined;

    const filters: any = { limit, offset };
    if (order_id) filters.order_id = order_id;
    if (rating_category) filters.rating_category = rating_category;
    if (sellerId !== undefined) filters.sellerId = sellerId;

    const { data, total } = await ratingModel.listRatings(filters);

    res.json({ success: true, data, total });
  } catch (err) {
    ondcLogger.error('getRatings error', err);
    res.status(500).json({ success: false, error: 'Failed to fetch ratings' });
  }
}

export async function getOrderRatings(req: Request, res: Response): Promise<void> {
  try {
    const orderId = req.params['orderId'] ? String(req.params['orderId']) : undefined;
    if (!orderId) {
      res.status(400).json({ success: false, error: 'orderId is required' });
      return;
    }

    const order = await orderModel.findByOndcOrderId(orderId);
    if (!order) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }
    assertOrderVisible(req, order);

    const { data, total } = await ratingModel.listRatings({
      order_id: orderId,
      limit: 100,
      offset: 0,
    });

    res.json({ success: true, data, total });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    ondcLogger.error('getOrderRatings error', err);
    res.status(500).json({ success: false, error: 'Failed to fetch order ratings' });
  }
}
