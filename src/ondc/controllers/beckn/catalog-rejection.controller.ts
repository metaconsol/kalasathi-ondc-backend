/**
 * POST /api/v1/ondc/catalog_rejection
 *
 * Catalog & Store Rejection Framework (BNP → SNP, unsolicited): after
 * search → on_search (flow 7) or an incremental search (flow 9), the buyer
 * app reports catalog ingestion/quality errors. The body carries a top-level
 * `errors` array instead of a `message` object — which is why this route
 * must skip ondcContextValidator (its missing-`message` NACK would reject
 * every valid catalog_rejection):
 *
 *   { context, errors: [{ code: "9xxxx",
 *       type: "ITEM-ERROR" | "PROVIDER-ERROR" | "INTEGRATION-ERROR" | "BPP-ERROR",
 *       path, message }] }
 *
 * No on_catalog_rejection callback exists — the flow ends with our sync ACK.
 * The full inbound payload (including errors) is persisted to ondc_txn_logs
 * by ondcRequestLogger and surfaced in the admin Request Monitor's
 * "Catalog Rejection" tab; the BNP re-checks the catalog with a later plain
 * /search once the seller has fixed it.
 */

import type { Request, Response } from 'express';
import { buildAck } from '~/ondc/utils/payload.builder';
import { ondcLogger } from '~/ondc/utils/logger.util';
import type { BecknContext } from '~/ondc/types/beckn.types';

interface CatalogRejectionError {
  code?: string;
  type?: string;
  path?: string;
  message?: string;
}

export async function handleCatalogRejection(req: Request, res: Response): Promise<void> {
  const body = req.body as { context?: BecknContext; errors?: CatalogRejectionError[] };
  const ctx = body.context;

  if (!ctx) {
    res.status(400).json({
      message: { ack: { status: 'NACK' } },
      error: { code: 'E100', message: 'Missing context' },
    });
    return;
  }

  const errors = Array.isArray(body.errors) ? body.errors : [];
  // warn, not info: a rejection means a live BNP is refusing our catalog —
  // it needs seller/admin attention even if the ACK itself succeeds.
  ondcLogger.warn('Catalog rejection received', {
    transactionId: ctx.transaction_id,
    bapId: ctx.bap_id,
    domain: ctx.domain,
    errorCount: errors.length,
    errors: errors.map((e) => ({ code: e.code, type: e.type, path: e.path })),
  });

  res.status(200).json(buildAck(ctx));
}
