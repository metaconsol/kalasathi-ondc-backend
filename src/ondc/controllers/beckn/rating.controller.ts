/**
 * POST /api/v1/ondc/rating  (ONDC v1.2.5)
 *
 * Receives a rating from BAP for an order, item, fulfillment, or provider.
 * Flow:
 * 1. ACK immediately
 * 2. Async: persist rating, send /on_rating to BAP
 *
 * Rating categories (per spec): Item | Order | Fulfillment | Provider
 */

import type { Request, Response } from 'express';
import { buildAck, buildOnRating } from '~/ondc/utils/payload.builder';
import { becknService } from '~/ondc/services/beckn.service';
import { observabilityService } from '~/ondc/services/observability.service';
import { transactionModel } from '~/ondc/models/transaction.model';
import { txnLogModel } from '~/ondc/models/log.model';
import { overallTxnsModel } from '~/ondc/models/overall_txns.model';
import { ondcLogger } from '~/ondc/utils/logger.util';
import { ratingModel } from '~/ondc/models/rating.model';
import type { BecknContext } from '~/ondc/types/beckn.types';

interface RatingMessage {
  order_id?: string;
  ratings?: Array<{
    rating_category?: string; // Item | Order | Fulfillment | Provider
    id?: string; // order_id or item_id being rated
    value?: string | number; // 1-5
  }>;
}

export async function handleRating(req: Request, res: Response): Promise<void> {
  const { context: ctx, message } = req.body as {
    context: BecknContext;
    message: RatingMessage;
  };

  res.status(200).json(buildAck(ctx));

  setImmediate(async () => {
    const txnId = ctx.transaction_id;
    const bapUri = String(ctx.bap_uri ?? '');
    const orderId = message?.order_id ?? '';
    const ratingsArray = Array.isArray(message?.ratings) ? message.ratings : [];

    try {
      // Inbound request is logged centrally by ondcRequestLogger middleware.
      await transactionModel.upsert({
        transaction_id: txnId,
        bap_id: ctx.bap_id,
        bpp_id: ctx.bpp_id ?? null,
        domain: ctx.domain,
        city: ctx.city,
        country: ctx.country ?? null,
        core_version: ctx.core_version ?? null,
        status: 'COMPLETED',
      });
      await overallTxnsModel.upsert(txnId);

      // Persist the ratings
      for (const rating of ratingsArray) {
        const ratingValue = rating.value !== undefined ? parseFloat(String(rating.value)) : null;
        const isValid =
          ratingValue !== null && !isNaN(ratingValue) && ratingValue >= 1 && ratingValue <= 5;

        await ratingModel.upsertRating({
          transaction_id: txnId,
          order_id: orderId,
          rating_category: rating.rating_category ?? 'Order',
          rated_id: rating.id ?? txnId,
          rating_value: isValid ? ratingValue : null,
          bap_id: String(ctx.bap_id ?? ''),
          domain: String(ctx.domain ?? ''),
        });
      }

      const payload = buildOnRating(ctx) as any;
      const { statusCode, error: cbErr } = await becknService.sendCallback(
        becknService.buildCallbackUrl(bapUri, 'on_rating'),
        'on_rating',
        payload,
        txnId,
      );

      await txnLogModel.insert({
        transaction_id: txnId,
        message_id: payload.context.message_id,
        action: 'on_rating',
        direction: 'outbound',
        bap_id: ctx.bap_id,
        bpp_id: payload.context.bpp_id ?? null,
        domain: ctx.domain,
        http_status: statusCode ?? null,
        ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
        payload_json: JSON.stringify(payload),
        error_message: cbErr ?? null,
      });

      observabilityService.push('on_rating', payload);
    } catch (err) {
      ondcLogger.error('rating async error', { txnId, err });
    }
  });
}
