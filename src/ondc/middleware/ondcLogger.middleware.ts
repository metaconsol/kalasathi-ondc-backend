/**
 * Logs every inbound ONDC request to:
 * 1. The ONDC network_debug.log file
 * 2. The ondc_txn_logs DB table (async, non-blocking)
 */

import type { Request, Response, NextFunction } from 'express';
import { logNetworkCall } from '~/ondc/utils/logger.util';
import { txnLogModel } from '~/ondc/models/log.model';
import type { BecknContext } from '~/ondc/types/beckn.types';

export function ondcRequestLogger(req: Request, _res: Response, next: NextFunction): void {
  const body = req.body as { context?: BecknContext };
  const ctx = body.context;

  const transactionId = ctx?.transaction_id ?? 'unknown';
  const action = ctx?.action ?? req.path.split('/').pop() ?? 'unknown';
  const bapId = ctx?.bap_id ?? null;

  logNetworkCall('inbound', action, transactionId, req.body);

  // Fire-and-forget DB log — never blocks the request
  txnLogModel
    .insert({
      transaction_id: transactionId,
      message_id: ctx?.message_id ?? 'unknown',
      action,
      direction: 'inbound',
      bap_id: bapId,
      bpp_id: ctx?.bpp_id ?? null,
      domain: ctx?.domain ?? null,
      http_status: null,
      ack_status: null,
      payload_json: JSON.stringify(req.body),
      error_message: null,
    })
    .catch(() => {
      // Logging must never fail a request
    });

  next();
}
