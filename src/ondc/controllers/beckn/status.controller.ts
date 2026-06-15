/**
 * POST /api/v1/ondc/status
 * Returns the current order state. Buyer can poll at any time.
 */

import type { Request, Response } from 'express';
import { buildAck, buildOnStatus } from '~/ondc/utils/payload.builder';
import { becknService } from '~/ondc/services/beckn.service';
import { observabilityService } from '~/ondc/services/observability.service';
import { orderModel } from '~/ondc/models/order.model';
import { txnLogModel } from '~/ondc/models/log.model';
import { overallTxnsModel } from '~/ondc/models/overall_txns.model';
import { ondcLogger } from '~/ondc/utils/logger.util';
import type { BecknContext } from '~/ondc/types/beckn.types';

export async function handleStatus(req: Request, res: Response): Promise<void> {
  const { context: ctx, message } = req.body as {
    context: BecknContext;
    message: { order_id: string };
  };

  res.status(200).json(buildAck(ctx));

  setImmediate(async () => {
    const txnId = ctx.transaction_id;
    const bapUri = String(ctx.bap_uri ?? '');
    const orderId = String(message?.order_id ?? '');

    try {
      // Inbound request is logged centrally by ondcRequestLogger middleware.
      const dbOrder =
        (await orderModel.findByOndcOrderId(orderId)) ??
        (await orderModel.findByTransactionId(txnId));

      if (!dbOrder) {
        ondcLogger.warn('status: order not found', { orderId, txnId });
        return;
      }

      const items = await orderModel.getItems(dbOrder.ondc_order_id);
      const fulfillments = await orderModel.getFulfillments(dbOrder.ondc_order_id);

      const onStatusOrder = {
        id: dbOrder.ondc_order_id,
        state: dbOrder.status,
        provider: { id: dbOrder.provider_id },
        items: items.map((i) => ({
          id: i.item_id,
          quantity: { count: i.quantity },
          fulfillment_id: i.fulfillment_id ?? 'F1',
        })),
        fulfillments: fulfillments.map((f) => ({
          id: f.fulfillment_id,
          type: f.fulfillment_type,
          state: {
            descriptor: { code: f.state },
            updated_at: (f.updated_at ?? new Date()).toISOString(),
          },
          tracking: !!f.tracking_url,
          ...(f.tracking_url ? { '@ondc/org/tracking': true } : {}),
        })),
        billing: JSON.parse(dbOrder.billing_json ?? '{}'),
        payment: JSON.parse(dbOrder.payment_json ?? '{}'),
        updated_at: (dbOrder.updated_at ?? new Date()).toISOString(),
      };

      await overallTxnsModel.patch(txnId, { on_status: 1, order_status: dbOrder.status });

      const payload = buildOnStatus(ctx, onStatusOrder) as any;
      const { statusCode, error: cbErr } = await becknService.sendCallback(
        becknService.buildCallbackUrl(bapUri, 'on_status'),
        'on_status',
        payload,
        txnId,
      );

      await txnLogModel.insert({
        transaction_id: txnId,
        message_id: payload.context.message_id,
        action: 'on_status',
        direction: 'outbound',
        bap_id: ctx.bap_id,
        bpp_id: payload.context.bpp_id ?? null,
        domain: ctx.domain,
        http_status: statusCode ?? null,
        ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
        payload_json: JSON.stringify(payload),
        error_message: cbErr ?? null,
      });

      observabilityService.push('on_status', payload);
    } catch (err) {
      ondcLogger.error('status async error', { txnId, err });
    }
  });
}
