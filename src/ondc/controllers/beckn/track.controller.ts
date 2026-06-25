/**
 * POST /api/v1/ondc/track
 * Returns tracking URL for the order's active fulfillment.
 */

import type { Request, Response } from 'express';
import { buildAck, buildOnTrack, buildResponseContext } from '~/ondc/utils/payload.builder';
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

      let payload: any;
      let actionName = 'on_track';
      let isNack = false;

      if (!trackingUrl) {
        isNack = true;
        actionName = 'on_track'; // Still sent to /on_track endpoint, but structured with context action on_track + error object
        payload = {
          context: buildResponseContext(ctx, 'on_track'),
          error: {
            type: 'CONTEXT-ERROR',
            code: '30016', // ONDC standard code for tracking details not available
            message: 'Tracking not available',
          },
        };
      } else {
        const tracking = {
          id: `TRK-${orderId}`,
          url: trackingUrl,
          status: 'active',
        };
        payload = buildOnTrack(ctx, tracking);
      }

      await overallTxnsModel.patch(txnId, {
        on_track: 1,
        track_link: trackingUrl ?? null,
      });

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
        ack_status: isNack ? 'NACK' : statusCode && statusCode < 300 ? 'ACK' : 'NACK',
        payload_json: JSON.stringify(payload),
        error_message: isNack ? 'Tracking not available' : (cbErr ?? null),
      });

      observabilityService.push('on_track', payload);
    } catch (err) {
      ondcLogger.error('track async error', { txnId, err });
    }
  });
}
