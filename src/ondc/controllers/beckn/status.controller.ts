/**
 * POST /api/v1/ondc/status
 * Returns the current order state. Buyer can poll at any time.
 */

import type { Request, Response } from 'express';
import { buildAck, buildOnStatus } from '~/ondc/utils/payload.builder';
import { becknService } from '~/ondc/services/beckn.service';
import { observabilityService } from '~/ondc/services/observability.service';
import { orderModel } from '~/ondc/models/order.model';
import { buildOnStatusOrder } from '~/ondc/adapters/order.adapter';
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

      const shouldSendSolicitedOnStatus = await overallTxnsModel.claimSolicitedOnStatus(
        txnId,
        dbOrder.status,
      );
      if (!shouldSendSolicitedOnStatus) {
        ondcLogger.info('status: duplicate buyer status poll ACKed without on_status callback', {
          orderId: dbOrder.ondc_order_id,
          txnId,
          status: dbOrder.status,
        });
        return;
      }

      const liveFulfillments = await orderModel.getFulfillments(dbOrder.ondc_order_id);

      // Full ONDC order: quote/items/billing/payment inherited from on_confirm,
      // fulfillment state/agent/tracking overlaid from live DB, order.state mapped.
      const onStatusOrder = await buildOnStatusOrder(dbOrder, liveFulfillments);

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
