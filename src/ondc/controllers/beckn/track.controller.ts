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

  // context.* fields are already validated globally in ondcValidator.middleware.ts
  // We only need to validate the endpoint-specific mandatory fields here
  if (!message?.order_id) {
    res.status(200).json(
      buildAck(ctx || ({} as BecknContext), {
        type: 'CONTEXT-ERROR', // or JSON-SCHEMA-ERROR
        code: '20000',
        path: 'message.order_id',
        message: 'Missing required field: message.order_id',
      }),
    );
    return;
  }

  const txnId = ctx.transaction_id;
  const bapUri = String(ctx.bap_uri ?? '');
  const orderId = String(message.order_id);

  try {
    // Inbound request is logged centrally by ondcRequestLogger middleware.
    const dbOrder =
      (await orderModel.findByOndcOrderId(orderId)) ??
      (await orderModel.findByTransactionId(txnId));

    const fulfillments = dbOrder ? await orderModel.getFulfillments(dbOrder.ondc_order_id) : [];
    const primaryFulfillment = fulfillments[0];
    const trackingUrl = primaryFulfillment?.tracking_url ?? null;

    if (!trackingUrl) {
      // If tracking is disabled/not available, persist the failed track attempt
      // and return a synchronous NACK so the dashboard can reflect that state.
      try {
        await overallTxnsModel.upsert(txnId, ctx.bpp_id ?? null);
        await overallTxnsModel.patch(txnId, { on_track: 0, track_link: null });
      } catch (err) {
        ondcLogger.error('track db marker update failed', { txnId, err });
      }

      res.status(200).json(
        buildAck(ctx, {
          // 40003 (tracking not enabled) is a BPP core error, not a context error.
          type: 'CORE-ERROR',
          code: '40003',
          message: 'Tracking is not available for this order',
        }),
      );
      return;
    }

    // Tracking is available, send sync ACK
    res.status(200).json(buildAck(ctx));

    // Process the async /on_track callback
    setImmediate(async () => {
      try {
        const tracking = {
          id: `TRK-${orderId}`,
          url: trackingUrl,
          status: 'active',
        };
        // buildOnTrack (like the other payload builders) is typed `object`;
        // cast so context/message access + callback typing resolve, matching
        // select.controller's buildOnSelect(...) as any pattern.
        const payload = buildOnTrack(ctx, tracking) as any;

        await overallTxnsModel.patch(txnId, {
          on_track: 1,
          track_link: trackingUrl,
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
          ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
          payload_json: JSON.stringify(payload),
          error_message: cbErr ?? null,
        });

        observabilityService.push('on_track', payload);
      } catch (err) {
        ondcLogger.error('track async error', { txnId, err });
      }
    });
  } catch (err) {
    ondcLogger.error('track sync error', { txnId, err });
    res
      .status(500)
      .json(buildAck(ctx, { type: 'CORE-ERROR', code: '50000', message: 'Internal error' }));
  }
}
