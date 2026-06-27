import type { Request, Response } from 'express';
import { ratingModel } from '~/ondc/models/rating.model';
import { ondcLogger } from '~/ondc/utils/logger.util';

export async function getRatings(req: Request, res: Response): Promise<void> {
  try {
    const limit = parseInt(String(req.query['limit'])) || 50;
    const offset = parseInt(String(req.query['offset'])) || 0;
    const order_id = req.query['order_id'] ? String(req.query['order_id']) : undefined;
    const rating_category = req.query['rating_category']
      ? String(req.query['rating_category'])
      : undefined;

    const filters: any = { limit, offset };
    if (order_id) filters.order_id = order_id;
    if (rating_category) filters.rating_category = rating_category;

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

    const { data, total } = await ratingModel.listRatings({
      order_id: orderId,
      limit: 100,
      offset: 0,
    });

    res.json({ success: true, data, total });
  } catch (err) {
    ondcLogger.error('getOrderRatings error', err);
    res.status(500).json({ success: false, error: 'Failed to fetch order ratings' });
  }
}
