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
import { ondcExec, ondcQuery } from '~/lib/ondcSql';

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

  // ── Strict forward ordering for the delivery chain ────────────────────
  // The ONDC order state machine only moves forward — a seller must not be
  // able to fire a state before its predecessor is reached, nor re-fire an
  // earlier one. Each forward action requires the order to be at EXACTLY
  // the listed status (the status its own success then advances past).
  // Cancel / return / RTO actions are branch flows and stay unrestricted.
  const STATUS_RANK: Record<string, number> = {
    CREATED: 0,
    CONFIRMED: 1,
    PACKED: 2,
    AGENT_ASSIGNED: 3,
    ORDER_PICKED_UP: 4,
    OUT_FOR_DELIVERY: 5,
    DELIVERED: 6,
  };
  const RANK_LABEL = [
    'Created',
    'Confirmed',
    'Packed',
    'Agent Assigned',
    'Order Picked Up',
    'Out For Delivery',
    'Delivered',
  ];
  const FORWARD_REQUIRES: Record<string, number> = {
    confirmed: 0,
    accepted: 1,
    packed: 1,
    agent_assigned: 2,
    picked_up: 3,
    out_for_delivery: 4,
    delivered: 5,
  };
  // Acceptance (first unsolicited on_status) doesn't change the DB status —
  // it's recorded as a status-history row and required before Packed.
  const ACCEPTED_NOTE = 'Order accepted by seller — first on_status (Pending) sent';
  const hasSellerAccepted = async (): Promise<boolean> => {
    const rows = await ondcQuery<{ id: number }>(
      `SELECT id FROM ondc_order_status_history
       WHERE ondc_order_id = ? AND note = ? LIMIT 1`,
      [orderId, ACCEPTED_NOTE],
    );
    return rows.length > 0;
  };

  const requiredRank = FORWARD_REQUIRES[String(action)];
  if (requiredRank !== undefined) {
    const currentRank = STATUS_RANK[dbOrder.status] ?? -1;
    if (currentRank > requiredRank) {
      throw new AppError(
        `Order is already ${RANK_LABEL[currentRank] ?? dbOrder.status} — cannot go back to '${String(action)}'`,
        400,
      );
    }
    if (action === 'accepted' && (await hasSellerAccepted())) {
      throw new AppError('Order is already accepted — the first on_status was already sent', 400);
    }
  }

  // TEMP — DISABLED FOR TESTING, REVERT AFTER: normally a courier shipment
  // must be booked before the order can move past "packed" (see the
  // commented block below). Turned off while Delhivery's "duplicate order
  // id" issue blocks repeat test bookings — restore this once testing is
  // done.
  //
  // const REQUIRES_BOOKED_SHIPMENT = new Set([
  //   'agent_assigned',
  //   'picked_up',
  //   'out_for_delivery',
  //   'delivered',
  // ]);
  // if (REQUIRES_BOOKED_SHIPMENT.has(String(action)) && !dbOrder.tracking_number) {
  //   throw new AppError(
  //     'Book a Delhivery shipment for this order before updating this status. Once booked, tracking updates are applied automatically as the courier reports progress.',
  //     400,
  //   );
  // }

  switch (action) {
    case 'confirmed':
      // CREATED→CONFIRMED normally happens automatically in handleConfirm
      // when the BAP ACKs on_confirm; this action is the manual fallback.
      // It can race that automatic transition — the conditional UPDATE
      // (only flips CREATED→CONFIRMED if still CREATED) keeps it atomic.
      // NOTE: no on_status here — the first unsolicited on_status is the
      // seller's explicit 'accepted' action below.
      {
        const casResult = await ondcExec(
          `UPDATE ondc_orders SET status = 'CONFIRMED', status_updated_at = NOW(), updated_at = NOW()
           WHERE ondc_order_id = ? AND status = 'CREATED'`,
          [orderId],
        );
        if (casResult.affectedRows > 0) {
          await orderModel.addStatusHistory({
            ondc_order_id: orderId,
            from_status: 'CREATED',
            to_status: 'CONFIRMED',
            fulfillment_state: 'Pending',
            triggered_by: 'seller',
            note: 'Order confirmed by seller',
            payload_json: null,
          });
        }
      }
      break;
    case 'accepted':
      // Seller accepts the order: sends the FIRST unsolicited on_status
      // (order.state Accepted, fulfillment Pending). Ordering + duplicate
      // guards above ensure this fires exactly once, after CONFIRMED and
      // before Packed. The DB status stays CONFIRMED (which already maps
      // to ONDC order.state 'Accepted'); acceptance is recorded as a
      // status-history row keyed by ACCEPTED_NOTE.
      await orderModel.addStatusHistory({
        ondc_order_id: orderId,
        from_status: 'CONFIRMED',
        to_status: 'CONFIRMED',
        fulfillment_state: 'Pending',
        triggered_by: 'seller',
        note: ACCEPTED_NOTE,
        payload_json: null,
      });
      await flow1AService.pushOnStatus(orderId, 'Pending');
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
    case 'return_rejected':
      await fulfillmentService.rejectReturn(
        orderId,
        fulfillment_id,
        (req.body['reason'] as string) || 'Return rejected',
      );
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
