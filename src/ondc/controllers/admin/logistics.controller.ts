/**
 * Admin Logistics Controller — Delhivery shipping for ONDC orders.
 * Mirrors odop_backend's seller Delhivery endpoints (book / track / cancel /
 * packing slip / pickup / pincode check) but operates on ondc_orders.
 */

import type { Request, Response } from 'express';
import { ApiResponse, AppError } from '~/lib/response';
import { orderModel } from '~/ondc/models/order.model';
import { assertOrderVisible } from '~/ondc/controllers/admin/orders.controller';
import {
  bookShipment as bookDelhiveryShipment,
  cancelShipment as cancelDelhiveryShipment,
  checkPincode as checkDelhiveryPincode,
  createPickup as createDelhiveryPickup,
  getPackingSlip as getDelhiveryPackingSlip,
  trackShipment as trackDelhiveryShipment,
} from '~/ondc/services/delhivery.service';

/** Load the order and enforce seller ownership before any Delhivery action. */
async function loadOwnedOrder(req: Request): Promise<string> {
  const orderId = req.params['orderId'] as string;
  const order = await orderModel.findByOndcOrderId(orderId);
  if (!order) throw new AppError('Order not found', 404);
  assertOrderVisible(req, order);
  return order.ondc_order_id;
}

/** GET /api/v1/ondc/admin/orders/logistics/delhivery/serviceability/:pincode */
export async function checkPincode(req: Request, res: Response): Promise<void> {
  const data = await checkDelhiveryPincode(req.params['pincode'] as string);
  ApiResponse.success(res, 'Delhivery serviceability fetched successfully', data);
}

/** POST /api/v1/ondc/admin/orders/:orderId/delhivery/book — body: { paymentMode? } */
export async function bookShipment(req: Request, res: Response): Promise<void> {
  const orderId = await loadOwnedOrder(req);
  const paymentMode = (req.body as Record<string, string> | undefined)?.['paymentMode'];
  const result = await bookDelhiveryShipment(orderId, paymentMode);
  ApiResponse.success(res, 'Delhivery shipment booked successfully', {
    orderId,
    provider: 'Delhivery',
    waybill: result.waybill,
    uploadWbn: result.uploadWbn,
    pickupLocationName: result.pickupLocationName,
    trackingUrl: result.trackingUrl,
    response: result.response,
  });
}

/** GET /api/v1/ondc/admin/orders/:orderId/delhivery/track */
export async function trackShipment(req: Request, res: Response): Promise<void> {
  const orderId = await loadOwnedOrder(req);
  const result = await trackDelhiveryShipment(orderId);
  ApiResponse.success(res, 'Delhivery tracking fetched successfully', result);
}

/** POST /api/v1/ondc/admin/orders/:orderId/delhivery/cancel */
export async function cancelShipment(req: Request, res: Response): Promise<void> {
  const orderId = await loadOwnedOrder(req);
  const result = await cancelDelhiveryShipment(orderId);
  ApiResponse.success(res, 'Delhivery shipment cancelled successfully', { orderId, ...result });
}

/** GET /api/v1/ondc/admin/orders/:orderId/delhivery/packing-slip — responds with PDF bytes */
export async function packingSlip(req: Request, res: Response): Promise<void> {
  const orderId = await loadOwnedOrder(req);
  const slip = await getDelhiveryPackingSlip(orderId);
  res.setHeader('Content-Type', slip.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${slip.filename}"`);
  res.setHeader('Content-Length', String(slip.buffer.length));
  res.end(slip.buffer);
}

/** POST /api/v1/ondc/admin/orders/:orderId/delhivery/pickup — body: { pickupDate, pickupTime, expectedPackageCount? } */
export async function createPickup(req: Request, res: Response): Promise<void> {
  const orderId = await loadOwnedOrder(req);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const result = await createDelhiveryPickup(orderId, {
    pickupDate: String(body['pickupDate'] ?? body['pickup_date'] ?? ''),
    pickupTime: String(body['pickupTime'] ?? body['pickup_time'] ?? ''),
    expectedPackageCount:
      Number(body['expectedPackageCount'] ?? body['expected_package_count'] ?? 1) || 1,
  });
  ApiResponse.success(res, 'Delhivery pickup request created successfully', result);
}
