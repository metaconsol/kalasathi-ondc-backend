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

function extractInboundLogFields(body: { context?: Record<string, unknown> }, req: Request) {
  const ctx = body.context ?? {};
  const pathAction = req.path.split('/').pop() ?? 'unknown';
  return {
    transactionId: String(ctx.transaction_id ?? 'unknown'),
    messageId: String(ctx.message_id ?? 'unknown'),
    action: String(ctx.action ?? pathAction),
    domain: (ctx.domain as string | undefined) ?? null,
    bapId: (ctx.bap_id as string | undefined) ?? null,
    bppId: (ctx.bpp_id as string | undefined) ?? null,
  };
}

export function ondcRequestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const body = req.body as { context?: BecknContext | Record<string, unknown> };
  const fields = extractInboundLogFields(body as { context?: Record<string, unknown> }, req);

  const transactionId = fields.transactionId;
  const action = fields.action;
  const bapId = fields.bapId;

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
      messageId: fields.messageId,
      bapId,
      domain: fields.domain,
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
          context?: { bpp_id?: string; domain?: string };
          message?: { ack?: { status?: string } };
          error?: { message?: string };
        }
      | undefined;
    const ackRaw = resp?.message?.ack?.status;
    const ackStatus: 'ACK' | 'NACK' | null = ackRaw === 'ACK' || ackRaw === 'NACK' ? ackRaw : null;

    txnLogModel
      .insert({
        transaction_id: transactionId,
        message_id: fields.messageId,
        action,
        direction: 'inbound',
        bap_id: bapId,
        bpp_id: resp?.context?.bpp_id ?? fields.bppId,
        domain: resp?.context?.domain ?? fields.domain,
        http_status: res.statusCode,
        ack_status: ackStatus,
        payload_json: JSON.stringify(
          ackStatus === 'NACK' && syncResponse ? syncResponse : req.body,
        ),
        error_message: resp?.error?.message ?? null,
      })
      .catch(() => {
        // Logging must never fail a request
      });
  });

  next();
}
