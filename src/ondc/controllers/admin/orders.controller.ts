/**
 * Admin Orders Controller — list, view, and manage ONDC orders.
 */

import type { Request, Response } from 'express';
import { ApiResponse } from '~/lib/response';
import { orderModel } from '~/ondc/models/order.model';
import { fulfillmentService } from '~/ondc/services/fulfillment.service';
import { flow1AService } from '~/ondc/flows/flow1A.service';
import { flow3AService } from '~/ondc/flows/flow3A.service';
import { AppError } from '~/lib/response';
import type { OndcOrderStatus } from '~/ondc/types/order.types';

/**
 * Sellers may only see/modify their own orders (admins see all). Responds 404
 * rather than 403 so order ids of other sellers can't be probed.
 * (Also used by logistics.controller for the Delhivery endpoints.)
 */
export function assertOrderVisible(req: Request, order: { seller_id?: number | null }): void {
  if (req.user?.role === 'SELLER' && Number(order.seller_id) !== Number(req.user.id)) {
    throw new AppError('Order not found', 404);
  }
}

/** GET /api/v1/ondc/admin/orders */
export async function listOrders(req: Request, res: Response): Promise<void> {
  const { status, provider_id, page = '1', limit = '20' } = req.query as Record<string, string>;
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const offset = (pageNum - 1) * limitNum;

  const isSeller = req.user?.role === 'SELLER';
  const sellerId = isSeller ? req.user?.id : undefined;

  const [orders, total] = await Promise.all([
    orderModel.list({
      ...(status ? { status: status as OndcOrderStatus } : {}),
      ...(provider_id ? { providerId: provider_id } : {}),
      ...(sellerId !== undefined ? { sellerId } : {}),
      limit: limitNum,
      offset,
    }),
    orderModel.countAll({
      ...(status ? { status: status as OndcOrderStatus } : {}),
      ...(provider_id ? { providerId: provider_id } : {}),
      ...(sellerId !== undefined ? { sellerId } : {}),
    }),
  ]);

  ApiResponse.success(res, 'ONDC orders', orders, {
    page: pageNum,
    limit: limitNum,
    total,
    totalPages: Math.ceil(total / limitNum),
  });
}

/** GET /api/v1/ondc/admin/orders/:orderId */
export async function getOrder(req: Request, res: Response): Promise<void> {
  const order = await orderModel.findByOndcOrderId(req.params['orderId'] as string);
  if (!order) throw new AppError('Order not found', 404);
  assertOrderVisible(req, order);
  const [history, items, rawFulfillments] = await Promise.all([
    orderModel.getStatusHistory(order.ondc_order_id),
    orderModel.getItems(order.ondc_order_id),
    orderModel.getFulfillments(order.ondc_order_id),
  ]);

  const fulfillments = rawFulfillments.map((fulfillment) => ({
    ...fulfillment,
    tracking_available: !!fulfillment.tracking_url,
    tracking_message: fulfillment.tracking_url ? null : 'Tracking is not available for this order',
  }));

  ApiResponse.success(res, 'Order details', {
    order: { ...order, history, items, fulfillments },
  });
}

/** POST /api/v1/ondc/admin/orders/:orderId/fulfillment */
export async function updateFulfillment(req: Request, res: Response): Promise<void> {
  const orderId = req.params['orderId'] as string;
  const { action, fulfillment_id, awb, courier, tracking_url, agent_name, agent_phone } =
    req.body as Record<string, string>;

  const dbOrder = await orderModel.findByOndcOrderId(orderId);
  if (!dbOrder) {
    throw new AppError('Order not found', 404);
  }
  assertOrderVisible(req, dbOrder);
  const allowedAfterCancelled = new Set(['rto_delivered', 'rto_disposed']);
  if (dbOrder.status === 'CANCELLED' && !allowedAfterCancelled.has(String(action))) {
    throw new AppError('Cannot update fulfillment for a cancelled order', 400);
  }

  switch (action) {
    case 'confirmed':
      {
        const order = await orderModel.findByOndcOrderId(orderId);
        await orderModel.transitionStatus(
          orderId,
          order?.status ?? null,
          'CONFIRMED',
          'Pending',
          'seller',
          'Order confirmed by seller',
        );
        await flow1AService.pushOnStatus(orderId, 'Pending');
      }
      break;
    case 'packed':
      await fulfillmentService.markPacked(orderId, fulfillment_id);
      break;
    case 'agent_assigned':
      await fulfillmentService.markAgentAssigned(orderId, fulfillment_id, agent_name, agent_phone);
      break;
    case 'picked_up':
      await fulfillmentService.markPickedUp(orderId, fulfillment_id, awb, courier, tracking_url);
      break;
    case 'out_for_delivery':
      await fulfillmentService.markOutForDelivery(orderId, fulfillment_id, agent_name, agent_phone);
      break;
    case 'delivered':
      await fulfillmentService.markDelivered(orderId, fulfillment_id);
      break;
    case 'cancelled':
      {
        const reasonId = (req.body['reason_id'] as string) || '002';
        await flow3AService.cancelByseller(orderId, reasonId);
      }
      break;
    case 'partial_cancel':
      // Merchant-initiated PARTIAL cancel (Flow 3A) — on_update + on_status.
      await flow3AService.partialCancelByseller(
        orderId,
        (req.body['items'] as Array<{ id: string; quantity: number }>) ?? [],
        (req.body['reason_id'] as string) || '002',
      );
      break;
    case 'returned':
      await fulfillmentService.initiateReturn(orderId, fulfillment_id);
      break;
    case 'return_initiated':
      await fulfillmentService.markReturnInitiated(orderId, fulfillment_id);
      break;
    case 'return_approved':
      await fulfillmentService.markReturnApproved(orderId, fulfillment_id);
      break;
    case 'return_picked':
      await fulfillmentService.markReturnPicked(orderId, fulfillment_id);
      break;
    case 'return_delivered':
      await fulfillmentService.markReturnDelivered(orderId, fulfillment_id);
      break;
    case 'rto':
      await fulfillmentService.initiateRto(
        orderId,
        fulfillment_id,
        (req.body['reason_id'] as string) || '013',
      );
      break;
    case 'rto_delivered':
      await fulfillmentService.completeRto(orderId, fulfillment_id, 'RTO-Delivered');
      break;
    case 'rto_disposed':
      await fulfillmentService.completeRto(orderId, fulfillment_id, 'RTO-Disposed');
      break;
    case 'return':
      await fulfillmentService.initiateReturn(orderId, fulfillment_id);
      break;
    default:
      throw new AppError(`Unknown action: ${action}`, 400);
  }

  ApiResponse.success(res, 'Fulfillment updated');
}
