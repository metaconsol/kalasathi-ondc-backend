/**
 * Logs every inbound ONDC Beckn request:
 *   - Request headers (Authorization, Content-Type, User-Agent, host, IP)
 *   - Full request body
 *   - Sync ACK / NACK response (captured by intercepting res.json)
 *   - Elapsed time from middleware entry to response flush
 *
 * Written to logs/ondc/beckn_incoming.log (human-readable text blocks).
 * DB insert to ondc_txn_logs is kept as a fire-and-forget side-effect.
 */

import type { Request, Response, NextFunction } from 'express';
import { logBecknIncoming } from '~/ondc/utils/logger.util';
import { txnLogModel } from '~/ondc/models/log.model';
import type { BecknContext } from '~/ondc/types/beckn.types';

export function ondcRequestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const body = req.body as { context?: BecknContext };
  const ctx = body.context;

  const transactionId = ctx?.transaction_id ?? 'unknown';
  const action = ctx?.action ?? req.path.split('/').pop() ?? 'unknown';
  const bapId = ctx?.bap_id ?? null;

  // Intercept res.json so we can capture the ACK/NACK body sent back to the BAP.
  // We restore the original immediately after — only one call is needed per request.
  let syncResponse: unknown;
  const originalJson = res.json.bind(res) as (...args: any[]) => Response;
  (res as any).json = function (data: unknown): Response {
    syncResponse = data;
    (res as any).json = originalJson; // restore to prevent double-wrap on any later call
    return originalJson(data);
  };

  // After the HTTP response is fully sent, write the full log entry.
  res.on('finish', () => {
    logBecknIncoming({
      action,
      transactionId,
      messageId: ctx?.message_id ?? 'unknown',
      bapId,
      domain: ctx?.domain ?? null,
      ip: req.ip ?? req.socket.remoteAddress ?? 'unknown',
      headers: {
        authorization: req.headers['authorization'] as string | undefined,
        'x-gateway-authorization': req.headers['x-gateway-authorization'] as string | undefined,
        'content-type': req.headers['content-type'] as string | undefined,
        'user-agent': req.headers['user-agent'] as string | undefined,
        host: req.headers['host'] as string | undefined,
      },
      body: req.body,
      syncResponse,
      syncStatusCode: res.statusCode,
      elapsedMs: Date.now() - startTime,
    });

    // Single inbound DB log — written here (after flush) so it records the
    // ACK/NACK we actually returned to the BAP, captured from syncResponse.
    // This is the ONE place inbound requests are logged; beckn controllers
    // only log their outbound callbacks. Fire-and-forget: never fails a request.
    const resp = syncResponse as
      | {
          context?: { bpp_id?: string };
          message?: { ack?: { status?: string } };
          error?: { message?: string };
        }
      | undefined;
    const ackRaw = resp?.message?.ack?.status;
    const ackStatus: 'ACK' | 'NACK' | null = ackRaw === 'ACK' || ackRaw === 'NACK' ? ackRaw : null;

    txnLogModel
      .insert({
        transaction_id: transactionId,
        message_id: ctx?.message_id ?? 'unknown',
        action,
        direction: 'inbound',
        bap_id: bapId,
        bpp_id: resp?.context?.bpp_id ?? ctx?.bpp_id ?? null,
        domain: ctx?.domain ?? null,
        http_status: res.statusCode,
        ack_status: ackStatus,
        payload_json: JSON.stringify(req.body),
        error_message: resp?.error?.message ?? null,
      })
      .catch(() => {
        // Logging must never fail a request
      });
  });

  next();
}
