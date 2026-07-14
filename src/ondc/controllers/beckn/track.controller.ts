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
      // Per spec: rider not yet assigned OR tracking not enabled
      // (gps_enabled/url_enabled both "no") → NACK 40005 (not 40003).
      try {
        await overallTxnsModel.upsert(txnId, ctx.bpp_id ?? null);
        await overallTxnsModel.patch(txnId, { on_track: 0, track_link: null });
      } catch (err) {
        ondcLogger.error('track db marker update failed', { txnId, err });
      }

      res.status(200).json(
        buildAck(ctx, {
          type: 'CORE-ERROR',
          code: '40005',
          message: 'Tracking is not available — no rider assigned yet or tracking not enabled',
        }),
      );
      return;
    }
    // Guard above ensures both are non-null past this point.
    const trackedFulfillment = primaryFulfillment!;

    // Tracking is available, send sync ACK
    res.status(200).json(buildAck(ctx));

    // Process the async /on_track callback
    setImmediate(async () => {
      try {
        // Per spec: "active" once a rider is assigned & tracking enabled,
        // "inactive" (with an empty location) once the order is delivered/
        // terminal. Pending (no rider yet) can't reach here — the no-AWB
        // guard above already NACKs 40005 before a fulfillment exists.
        const TERMINAL_STATES = new Set([
          'Order-delivered',
          'Cancelled',
          'RTO-Delivered',
          'RTO-Disposed',
          'Return_Delivered',
          'Return_Rejected',
          'Liquidated',
        ]);
        const isActive = !TERMINAL_STATES.has(trackedFulfillment.state);

        // We track via Delhivery, which gives checkpoint/URL tracking, not
        // live GPS telemetry — so this builds the spec's URL-tracking variant
        // honestly rather than fabricating coordinates: url_enabled path,
        // config.attr="tracking.url" + type="deferred" (both mandated by the
        // spec's own enum note for that attr), no location/path block. If a
        // future courier integration provides real-time lat/lng, extend this
        // with location.gps + tags.path and switch config to
        // attr="tracking.location.gps"/type="live_poll".
        const tracking: Record<string, unknown> = {
          id: trackedFulfillment.fulfillment_id,
          url: trackingUrl,
          status: isActive ? 'active' : 'inactive',
          tags: [
            {
              code: 'order',
              list: [{ code: 'id', value: dbOrder?.ondc_order_id ?? orderId }],
            },
            {
              code: 'config',
              list: [
                { code: 'attr', value: 'tracking.url' },
                { code: 'type', value: 'deferred' },
              ],
            },
          ],
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
