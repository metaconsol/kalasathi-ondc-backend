/**
 * POST /api/v1/ondc/track
 * Returns tracking URL for the order's active fulfillment.
 */

import type { Request, Response } from 'express';
import { buildAck, buildOnTrack } from '~/ondc/utils/payload.builder';
import { becknService } from '~/ondc/services/beckn.service';
import { observabilityService } from '~/ondc/services/observability.service';
import { orderModel } from '~/ondc/models/order.model';
import { txnLogModel } from '~/ondc/models/log.model';
import { overallTxnsModel } from '~/ondc/models/overall_txns.model';
import { ondcLogger } from '~/ondc/utils/logger.util';
import type { BecknContext } from '~/ondc/types/beckn.types';

export async function handleTrack(req: Request, res: Response): Promise<void> {
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

      const fulfillments = dbOrder ? await orderModel.getFulfillments(dbOrder.ondc_order_id) : [];
      const primaryFulfillment = fulfillments[0];
      const trackingUrl = primaryFulfillment?.tracking_url ?? null;

      const tracking = {
        id: `TRK-${orderId}`,
        url: trackingUrl,
        status: trackingUrl ? 'active' : 'inactive',
      };

      await overallTxnsModel.patch(txnId, {
        on_track: 1,
        track_link: trackingUrl ?? null,
      });

      const payload = buildOnTrack(ctx, tracking) as any;
      const { statusCode, error: cbErr } = await becknService.sendCallback(
        becknService.buildCallbackUrl(bapUri, 'on_track'),
        'on_track',
        payload,
        txnId,
      );

      await txnLogModel.insert({
        transaction_id: txnId,
        message_id: payload.context.message_id,
        action: 'on_track',
        direction: 'outbound',
        bap_id: ctx.bap_id,
        bpp_id: payload.context.bpp_id ?? null,
        domain: ctx.domain,
        http_status: statusCode ?? null,
        ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
        payload_json: JSON.stringify(payload),
        error_message: cbErr ?? null,
      });

      observabilityService.push('on_track', payload);
    } catch (err) {
      ondcLogger.error('track async error', { txnId, err });
    }
  });
}
