/**
 * POST /api/v1/ondc/cancel
 * Buyer-initiated cancellation.
 * After ACK: update order to CANCELLED + send on_cancel callback.
 */

import type { Request, Response } from 'express';
import { buildAck, buildOnCancel, nowIso } from '~/ondc/utils/payload.builder';
import { becknService } from '~/ondc/services/beckn.service';
import { observabilityService } from '~/ondc/services/observability.service';
import { orderModel } from '~/ondc/models/order.model';
import { txnLogModel } from '~/ondc/models/log.model';
import { ondcLogger } from '~/ondc/utils/logger.util';
import type { BecknContext } from '~/ondc/types/beckn.types';

export async function handleCancel(req: Request, res: Response): Promise<void> {
  const { context: ctx, message } = req.body as {
    context: BecknContext;
    message: { order_id: string; cancellation_reason_id?: string; descriptor?: object };
  };

  res.status(200).json(buildAck(ctx));

  setImmediate(async () => {
    const txnId = ctx.transaction_id;
    const bapUri = String(ctx.bap_uri ?? '');
    const orderId = String(message?.order_id ?? '');
    const reasonId = message?.cancellation_reason_id ?? '001';

    try {
      await txnLogModel.insert({
        transaction_id: txnId,
        message_id: ctx.message_id,
        action: 'cancel',
        direction: 'inbound',
        bap_id: ctx.bap_id,
        bpp_id: ctx.bpp_id ?? null,
        domain: ctx.domain,
        http_status: null,
        ack_status: 'ACK',
        payload_json: JSON.stringify(req.body),
        error_message: null,
      });

      const dbOrder =
        (await orderModel.findByOndcOrderId(orderId)) ??
        (await orderModel.findByTransactionId(txnId));

      if (!dbOrder) {
        ondcLogger.warn('cancel: order not found', { orderId, txnId });
        return;
      }

      // Update order
      await orderModel.transitionStatus(
        dbOrder.ondc_order_id,
        dbOrder.status,
        'CANCELLED',
        'Cancelled',
        'buyer',
        `Cancellation reason: ${reasonId}`,
        JSON.stringify(req.body),
      );

      const items = await orderModel.getItems(dbOrder.ondc_order_id);
      const fulfillments = await orderModel.getFulfillments(dbOrder.ondc_order_id);

      const cancelledOrder = {
        id: dbOrder.ondc_order_id,
        state: 'CANCELLED',
        provider: { id: dbOrder.provider_id },
        items: items.map((i) => ({ id: i.item_id, quantity: { count: i.quantity } })),
        billing: JSON.parse(dbOrder.billing_json ?? '{}'),
        fulfillments: fulfillments.map((f) => ({
          id: f.fulfillment_id,
          type: f.fulfillment_type,
          state: { descriptor: { code: 'Cancelled' } },
        })),
        payment: JSON.parse(dbOrder.payment_json ?? '{}'),
        cancellation: {
          cancelled_by: 'buyer',
          reasons: { id: reasonId },
          selected_reason: { id: reasonId },
        },
        updated_at: nowIso(),
      };

      const payload = buildOnCancel(ctx, cancelledOrder) as any;
      const { statusCode, error: cbErr } = await becknService.sendCallback(
        becknService.buildCallbackUrl(bapUri, 'on_cancel'),
        'on_cancel',
        payload,
        txnId,
      );

      await txnLogModel.insert({
        transaction_id: txnId,
        message_id: payload.context.message_id,
        action: 'on_cancel',
        direction: 'outbound',
        bap_id: ctx.bap_id,
        bpp_id: payload.context.bpp_id ?? null,
        domain: ctx.domain,
        http_status: statusCode ?? null,
        ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
        payload_json: JSON.stringify(payload),
        error_message: cbErr ?? null,
      });

      observabilityService.push('on_cancel', payload);
    } catch (err) {
      ondcLogger.error('cancel async error', { txnId, err });
    }
  });
}
