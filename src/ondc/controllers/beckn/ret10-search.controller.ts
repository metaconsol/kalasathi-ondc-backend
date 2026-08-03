import type { Request, Response } from 'express';
import { buildAck, buildNack, buildOnSearch } from '~/ondc/utils/payload.builder';
import { ret10CatalogService } from '~/ondc/services/ret10-catalog.service';
import { becknService } from '~/ondc/services/beckn.service';
import { observabilityService } from '~/ondc/services/observability.service';
import { incrementalCatalogService } from '~/ondc/services/incremental-catalog.service';
import { bapTermsModel, extractBapTerms } from '~/ondc/models/bap_terms.model';
import { transactionModel } from '~/ondc/models/transaction.model';
import { txnLogModel } from '~/ondc/models/log.model';
import { overallTxnsModel } from '~/ondc/models/overall_txns.model';
import { ondcLogger } from '~/ondc/utils/logger.util';
import { readFinderFee } from '~/ondc/utils/finder-fee';
import type { BecknContext } from '~/ondc/types/beckn.types';

/**
 * ONDC incremental catalog refresh signal
 */
function extractCatalogIncMode(intent: Record<string, any> | undefined): 'start' | 'stop' | null {
  const tags = Array.isArray(intent?.['tags']) ? intent['tags'] : [];
  for (const tag of tags) {
    const code = String(tag?.code ?? '');
    if (code !== 'catalog_inc' && !code.startsWith('catalog_inc[')) continue;
    const list = Array.isArray(tag?.list) ? tag.list : [];
    const mode = list.find((e: any) => e?.code === 'mode')?.value;
    if (mode === 'start' || mode === 'stop') return mode;
  }
  return null;
}

/**
 * RET10 specific search controller
 */
export async function handleRet10Search(req: Request, res: Response): Promise<void> {
  const body = req.body as { context?: BecknContext; message?: { intent?: Record<string, any> } };
  const ctx = body.context;

  if (!ctx) {
    res.status(400).json({
      message: { ack: { status: 'NACK' } },
      error: { code: 'E100', message: 'Missing context' },
    });
    return;
  }

  // Immediate ACK
  res.status(200).json(buildAck(ctx));

  const incMode = extractCatalogIncMode(body.message?.intent);

  // Async processing (after ACK is flushed)
  setImmediate(async () => {
    const txnId = ctx.transaction_id;
    const bapId = String(ctx.bap_id ?? '');
    const bapUri = String(ctx.bap_uri ?? '');
    const intent = body.message?.intent ?? {};

    try {
      if (bapId) {
        const terms = extractBapTerms(bapId, bapUri, txnId, intent);
        await bapTermsModel.upsert(terms);
      }

      const searchFee = readFinderFee(body.message?.intent?.['payment']);
      await transactionModel.upsert({
        transaction_id: txnId,
        bap_id: bapId,
        bpp_id: ctx.bpp_id ?? null,
        domain: ctx.domain,
        city: ctx.city,
        country: ctx.country ?? null,
        core_version: ctx.core_version ?? null,
        bff_amount: searchFee?.amount ?? null,
        bff_type: searchFee?.type ?? null,
        status: 'SEARCH',
      });
      await overallTxnsModel.upsert(txnId);
      await overallTxnsModel.patch(txnId, { on_search: 1 });

      if (incMode === 'stop') {
        incrementalCatalogService.stopSession(txnId);
        return;
      }

      // Build RET10 catalog specifically
      const catalog = await ret10CatalogService.buildSearchCatalog();

      const onSearchPayload = buildOnSearch(ctx, catalog) as any;
      const callbackUrl = becknService.buildCallbackUrl(bapUri, 'on_search');
      const extraHeaders = incMode === 'start' ? { 'X-ONDC-Search-Response': 'full' } : undefined;

      const { statusCode, error: cbErr } = await becknService.sendCallback(
        callbackUrl,
        'on_search',
        onSearchPayload,
        txnId,
        extraHeaders,
      );

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

      if (incMode === 'start') {
        incrementalCatalogService.startSession(ctx, ctx.domain, catalog);
      }
    } catch (err) {
      ondcLogger.error('ret10 search async error', { txnId, err });
    }
  });
}
