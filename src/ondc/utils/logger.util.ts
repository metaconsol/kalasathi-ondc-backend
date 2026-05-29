/**
 * ONDC-specific Winston logger.
 *
 * Files written:
 *   logs/ondc/beckn_incoming.log  — every inbound Beckn request (headers + body + sync ACK/NACK)
 *   logs/ondc/beckn_outgoing.log  — every outbound callback (payload + HTTP response / error)
 *   logs/ondc/app_error.log       — error-level events
 *   logs/ondc/network_debug.log   — general debug (kept for backward compat)
 *   logs/ondc/status_outgoing.log — status flow outgoing
 *   logs/ondc/recon_error.log     — reconciliation errors
 */

import winston from 'winston';
import path from 'path';

const ONDC_LOG_DIR = path.join(process.cwd(), 'logs', 'ondc');
const SEP = '='.repeat(80);

// ─── Winston transport helpers ───────────────────────────────────────────────

const fileTransport = (filename: string, level = 'debug') =>
  new winston.transports.File({
    filename: path.join(ONDC_LOG_DIR, filename),
    level,
    maxsize: 10 * 1024 * 1024,
    maxFiles: 5,
    tailable: true,
  });

/** Raw-text transport — skips Winston's default JSON wrapping. */
const rawFileTransport = (filename: string) =>
  new winston.transports.File({
    filename: path.join(ONDC_LOG_DIR, filename),
    level: 'info',
    maxsize: 20 * 1024 * 1024,
    maxFiles: 10,
    tailable: true,
    format: winston.format.printf(({ message }) => message as string),
  });

// ─── Existing loggers (kept for backward compat) ─────────────────────────────

export const ondcLogger = winston.createLogger({
  level: process.env['NODE_ENV'] === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [
    fileTransport('app_error.log', 'error'),
    fileTransport('network_debug.log', 'debug'),
  ],
  exceptionHandlers: [fileTransport('app_error.log', 'error')],
});

if (process.env['NODE_ENV'] !== 'production') {
  ondcLogger.add(
    new winston.transports.Console({
      level: 'warn',
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
          return `[ONDC] ${timestamp} ${level}: ${message}${metaStr}`;
        }),
      ),
    }),
  );
}

export const statusOutgoingLogger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [fileTransport('status_outgoing.log')],
});

export const reconLogger = winston.createLogger({
  level: 'error',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [fileTransport('recon_error.log', 'error')],
});

// ─── New human-readable Beckn loggers ────────────────────────────────────────

const becknIncomingLogger = winston.createLogger({
  level: 'info',
  transports: [rawFileTransport('beckn_incoming.log')],
});

const becknOutgoingLogger = winston.createLogger({
  level: 'info',
  transports: [rawFileTransport('beckn_outgoing.log')],
});

// ─── Internal helpers ─────────────────────────────────────────────────────────

function ts(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function safejson(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface BecknIncomingLogInfo {
  action: string;
  transactionId: string;
  messageId: string;
  bapId: string | null;
  domain: string | null;
  ip: string;
  headers: Record<string, string | null | undefined>;
  body: unknown;
  syncResponse?: unknown;
  syncStatusCode?: number;
  elapsedMs?: number;
}

export interface BecknOutgoingLogInfo {
  action: string;
  transactionId: string;
  messageId: string;
  url: string;
  body: unknown;
  authHeader?: string;
  httpStatus?: number;
  responseBody?: unknown;
  error?: string;
  elapsedMs?: number;
}

// ─── Public log functions ─────────────────────────────────────────────────────

export function logBecknIncoming(info: BecknIncomingLogInfo): void {
  const lines: string[] = [
    '',
    SEP,
    `${ts()}  [INBOUND]  ${info.action.toUpperCase()}`,
    SEP,
    `  txn_id  : ${info.transactionId}`,
    `  msg_id  : ${info.messageId}`,
    `  bap_id  : ${info.bapId ?? '-'}`,
    `  domain  : ${info.domain ?? '-'}`,
    `  ip      : ${info.ip}`,
  ];

  if (info.elapsedMs !== undefined) {
    lines.push(`  elapsed : ${info.elapsedMs}ms`);
  }

  const relevantHeaders = Object.entries(info.headers).filter(([, v]) => v != null);
  if (relevantHeaders.length) {
    lines.push('', '─── REQUEST HEADERS ' + '─'.repeat(60));
    for (const [k, v] of relevantHeaders) {
      // Truncate long Authorization signatures for readability
      const val = typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v;
      lines.push(`  ${k}: ${val}`);
    }
  }

  lines.push('', '─── REQUEST BODY ' + '─'.repeat(63), safejson(info.body));

  if (info.syncResponse !== undefined) {
    const statusLabel = info.syncStatusCode !== undefined ? ` (HTTP ${info.syncStatusCode})` : '';
    lines.push(
      '',
      `─── SYNC RESPONSE${statusLabel} ` + '─'.repeat(63),
      safejson(info.syncResponse),
    );
  }

  lines.push('');
  becknIncomingLogger.info(lines.join('\n'));
}

export function logBecknOutgoing(info: BecknOutgoingLogInfo): void {
  const isError = !!info.error;
  const lines: string[] = [
    '',
    SEP,
    `${ts()}  [OUTBOUND]  ${info.action.toUpperCase()}${isError ? '  *** ERROR ***' : ''}`,
    SEP,
    `  txn_id  : ${info.transactionId}`,
    `  msg_id  : ${info.messageId}`,
    `  url     : ${info.url}`,
  ];

  if (info.elapsedMs !== undefined) {
    lines.push(`  elapsed : ${info.elapsedMs}ms`);
  }

  lines.push('', '─── REQUEST BODY ' + '─'.repeat(63), safejson(info.body));

  if (isError) {
    lines.push('', '─── ERROR ' + '─'.repeat(70), `  ${info.error}`);
    if (info.httpStatus !== undefined) {
      lines.push(`  HTTP status: ${info.httpStatus}`);
    }
    if (info.responseBody !== undefined) {
      lines.push('', '  Response body:', safejson(info.responseBody));
    }
  } else {
    const statusLabel = info.httpStatus !== undefined ? `HTTP ${info.httpStatus}` : '?';
    lines.push('', `─── RESPONSE (${statusLabel}) ` + '─'.repeat(65), safejson(info.responseBody));
  }

  lines.push('');
  becknOutgoingLogger.info(lines.join('\n'));
}

/** Kept for backward compat — still writes to network_debug.log */
export function logNetworkCall(
  direction: 'inbound' | 'outbound',
  action: string,
  transactionId: string,
  payload: unknown,
  statusCode?: number,
  error?: string,
): void {
  ondcLogger.debug('ONDC network call', {
    direction,
    action,
    transaction_id: transactionId,
    status_code: statusCode,
    error,
    payload,
  });
}
