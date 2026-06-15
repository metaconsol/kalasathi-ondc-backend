/**
 * POST /api/v1/ondc/init
 *
 * Adds payment details + cancellation terms to the order and sends /on_init.
 * Uses COMPLETE_CANCELLATION_TERMS (all 5 fulfillment phases) and
 * buildOnInitPayment for settlement_details.
 */

import type { Request, Response } from 'express';
import { buildAck, buildOnInit } from '~/ondc/utils/payload.builder';
import { becknService } from '~/ondc/services/beckn.service';
import { observabilityService } from '~/ondc/services/observability.service';
import { transactionModel } from '~/ondc/models/transaction.model';
import { txnLogModel } from '~/ondc/models/log.model';
import { overallTxnsModel } from '~/ondc/models/overall_txns.model';
import { COMPLETE_CANCELLATION_TERMS, buildOnInitPayment } from '~/ondc/utils/catalog.builders';
import { ondcLogger } from '~/ondc/utils/logger.util';
import type { BecknContext } from '~/ondc/types/beckn.types';

export async function handleInit(req: Request, res: Response): Promise<void> {
  const { context: ctx, message } = req.body as {
    context: BecknContext;
    message: { order: Record<string, any> };
  };

  res.status(200).json(buildAck(ctx));

  setImmediate(async () => {
    const txnId = ctx.transaction_id;
    const bapUri = String(ctx.bap_uri ?? '');
    const order = message?.order ?? {};

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
        status: 'INIT',
      });
      await overallTxnsModel.upsert(txnId);
      await overallTxnsModel.patch(txnId, { on_init: 1 });

      // Compute total from quote
      const total = parseFloat(String(order?.['quote']?.['price']?.['value'] ?? '0')) || 0;

      const initOrder = {
        provider: order['provider'],
        items: order['items'] ?? [],
        billing: order['billing'] ?? {},
        fulfillments: order['fulfillments'] ?? [],
        quote: order['quote'] ?? {},
        payment: buildOnInitPayment(total),
        cancellation_terms: COMPLETE_CANCELLATION_TERMS,
        ...(order['tags'] ? { tags: order['tags'] } : {}),
      };

      const payload = buildOnInit(ctx, initOrder) as any;
      const { statusCode, error: cbErr } = await becknService.sendCallback(
        becknService.buildCallbackUrl(bapUri, 'on_init'),
        'on_init',
        payload,
        txnId,
      );

      await txnLogModel.insert({
        transaction_id: txnId,
        message_id: payload.context.message_id,
        action: 'on_init',
        direction: 'outbound',
        bap_id: ctx.bap_id,
        bpp_id: payload.context.bpp_id ?? null,
        domain: ctx.domain,
        http_status: statusCode ?? null,
        ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
        payload_json: JSON.stringify(payload),
        error_message: cbErr ?? null,
      });

      observabilityService.push('on_init', payload);
    } catch (err) {
      ondcLogger.error('init async error', { txnId, err });
    }
  });
}
