/**
 * POST /api/v1/ondc/search
 *
 * Exact flow (mirrors PHP search.php):
 * 1. Validate domain (RET12 / RET16 only)
 * 2. Upsert bap_terms from intent.tags + payment
 * 3. Upsert ondc_transactions row (phase = SEARCH)
 * 4. Log to ondc_txn_logs (inbound)
 * 5. Patch overall_txns.on_search = 1
 * 6. Reply ACK immediately
 * 7. Async: build on_search catalog + POST signed to bap_uri/on_search
 * 8. Log outbound to ondc_txn_logs
 */

import type { Request, Response } from 'express';
import { buildAck, buildNack, buildOnSearch } from '~/ondc/utils/payload.builder';
import { catalogService } from '~/ondc/services/catalog.service';
import { becknService } from '~/ondc/services/beckn.service';
import { observabilityService } from '~/ondc/services/observability.service';
import { bapTermsModel, extractBapTerms } from '~/ondc/models/bap_terms.model';
import { transactionModel } from '~/ondc/models/transaction.model';
import { txnLogModel } from '~/ondc/models/log.model';
import { overallTxnsModel } from '~/ondc/models/overall_txns.model';
import { SUPPORTED_DOMAINS } from '~/ondc/config/domain.config';
import { ondcLogger } from '~/ondc/utils/logger.util';
import type { BecknContext } from '~/ondc/types/beckn.types';

const ALLOWED_DOMAINS = new Set<string>(SUPPORTED_DOMAINS);

export async function handleSearch(req: Request, res: Response): Promise<void> {
  const body = req.body as { context?: BecknContext; message?: { intent?: Record<string, any> } };
  const ctx = body.context;

  if (!ctx) {
    res.status(400).json({
      message: { ack: { status: 'NACK' } },
      error: { code: 'E100', message: 'Missing context' },
    });
    return;
  }

  // Domain allowlist
  const domain = String(ctx.domain ?? '')
    .toUpperCase()
    .trim();
  if (!ALLOWED_DOMAINS.has(domain)) {
    res.status(200).json(
      buildNack(ctx, {
        type: 'CONTEXT-ERROR',
        code: '20000',
        message: `Unsupported domain: ${ctx.domain}`,
      }),
    );
    return;
  }

  // Immediate ACK
  res.status(200).json(buildAck(ctx));

  // Async processing (after ACK is flushed)
  setImmediate(async () => {
    const txnId = ctx.transaction_id;
    const bapId = String(ctx.bap_id ?? '');
    const bapUri = String(ctx.bap_uri ?? '');
    const intent = body.message?.intent ?? {};

    try {
      // 1. Inbound request is logged centrally by ondcRequestLogger middleware.

      // 2. Upsert bap_terms
      if (bapId) {
        const terms = extractBapTerms(bapId, bapUri, txnId, intent);
        await bapTermsModel.upsert(terms);
      }

      // 3. Upsert transaction + overall_txns
      await transactionModel.upsert({
        transaction_id: txnId,
        bap_id: bapId,
        bpp_id: ctx.bpp_id ?? null,
        domain: ctx.domain,
        city: ctx.city,
        country: ctx.country ?? null,
        core_version: ctx.core_version ?? null,
        status: 'SEARCH',
      });
      await overallTxnsModel.upsert(txnId);
      await overallTxnsModel.patch(txnId, { on_search: 1 });

      // 4. Build catalog live — full catalog per ONDC contract; buyer filters
      //    on their side (mirrors PHP search.php / build_on_search_min).
      const catalog = await catalogService.buildSearchCatalog(ctx.domain);

      // 5. Build on_search payload and send
      const onSearchPayload = buildOnSearch(ctx, catalog) as any;
      const callbackUrl = becknService.buildCallbackUrl(bapUri, 'on_search');

      const { statusCode, error: cbErr } = await becknService.sendCallback(
        callbackUrl,
        'on_search',
        onSearchPayload,
        txnId,
      );

      // 6. Log outbound
      await txnLogModel.insert({
        transaction_id: txnId,
        message_id: onSearchPayload.context.message_id,
        action: 'on_search',
        direction: 'outbound',
        bap_id: bapId,
        bpp_id: onSearchPayload.context.bpp_id ?? null,
        domain: ctx.domain,
        http_status: statusCode ?? null,
        ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
        payload_json: JSON.stringify(onSearchPayload),
        error_message: cbErr ?? null,
      });

      observabilityService.push('on_search', onSearchPayload);
    } catch (err) {
      ondcLogger.error('search async error', { txnId, err });
    }
  });
}
