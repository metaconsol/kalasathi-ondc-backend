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
import { ondcExec } from '~/lib/ondcSql';
import type { BecknContext } from '~/ondc/types/beckn.types';

interface RatingMessage {
  rating?: {
    rating_category?: string; // Item | Order | Fulfillment | Provider
    id?: string; // order_id or item_id being rated
    value?: string | number; // 1-5
  };
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
    const rating = message?.rating ?? {};

    try {
      await txnLogModel.insert({
        transaction_id: txnId,
        message_id: ctx.message_id,
        action: 'rating',
        direction: 'inbound',
        bap_id: ctx.bap_id,
        bpp_id: ctx.bpp_id ?? null,
        domain: ctx.domain,
        http_status: null,
        ack_status: 'ACK',
        payload_json: JSON.stringify(req.body),
        error_message: null,
      });

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

      // Persist the rating (best-effort, table may not exist yet)
      try {
        const ratingValue = rating.value !== undefined ? parseFloat(String(rating.value)) : null;
        await ondcExec(
          `INSERT INTO ondc_ratings
             (transaction_id, rating_category, rated_id, rating_value, bap_id, domain, created_at)
           VALUES (?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
             rating_value = VALUES(rating_value),
             updated_at   = NOW()`,
          [
            txnId,
            rating.rating_category ?? 'Order',
            rating.id ?? txnId,
            ratingValue,
            ctx.bap_id,
            ctx.domain,
          ],
        );
      } catch {
        // Table not created yet — log and continue; protocol flow must not break
        ondcLogger.warn('ondc_ratings table missing — rating not persisted', { txnId });
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
