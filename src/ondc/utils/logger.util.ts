/**
 * ONDC-specific Winston logger.
 *
 * Files written:
 *   logs/ondc/<action>_incoming.log  — per-action inbound (e.g. search_incoming.log, select_incoming.log)
 *   logs/ondc/<action>_outgoing.log  — per-action outbound (on_X stripped → X_outgoing.log)
 *   logs/ondc/catalog.log            — unique on_search catalogs (deduped by SHA-256)
 *   logs/ondc/app_error.log          — error-level events
 *   logs/ondc/network_debug.log      — general debug (kept for backward compat)
 *   logs/ondc/status_outgoing.log    — status flow outgoing
 *   logs/ondc/recon_error.log        — reconciliation errors
 *
 * Outgoing logs include the headers WE sent (Authorization, Digest, Content-Type).
 * Both incoming and outgoing logs include errors when present.
 * search_outgoing.log shows `catalog: {}` plus a `catalog_hash` reference; the
 * full catalog body lives once per unique hash in catalog.log.
 */

import winston from 'winston';
import path from 'path';
import crypto from 'crypto';

const ONDC_LOG_DIR = path.join(process.cwd(), 'logs', 'ondc');
const SEP = '='.repeat(80);
const HDR_REQ = '─── REQUEST HEADERS ' + '─'.repeat(60);
const HDR_RES = '─── RESPONSE HEADERS ' + '─'.repeat(59);
const HDR_BODY = '─── REQUEST BODY ' + '─'.repeat(63);
const HDR_ERR = '─── ERROR ' + '─'.repeat(70);
const HDR_SYNC_BASE = '─'.repeat(63);
const HDR_RESPONSE_BASE = '─'.repeat(65);

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

const makeRawLogger = (filename: string) =>
  winston.createLogger({
    level: 'info',
    transports: [rawFileTransport(filename)],
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

// ─── Per-action logger factory ───────────────────────────────────────────────

const actionLoggers = new Map<string, winston.Logger>();

function loggerForFile(filename: string): winston.Logger {
  let lg = actionLoggers.get(filename);
  if (!lg) {
    lg = makeRawLogger(filename);
    actionLoggers.set(filename, lg);
  }
  return lg;
}

/** Map an outbound action to its log family.
 *  `on_search` → `search_outgoing.log` so request + response live together. */
function outgoingFileFor(action: string): string {
  const a = action.toLowerCase();
  const stem = a.startsWith('on_') ? a.slice(3) : a;
  return `${stem || 'unknown'}_outgoing.log`;
}

function incomingFileFor(action: string): string {
  const a = action.toLowerCase();
  // For inbound on_X callbacks (e.g. on_receiver_recon) keep the full name
  return `${a || 'unknown'}_incoming.log`;
}

// ─── Catalog dedup ───────────────────────────────────────────────────────────

const catalogLogger = makeRawLogger('catalog.log');
const seenCatalogHashes = new Set<string>();

interface CatalogLogContext {
  txnId: string;
  bapId: string | null;
  domain: string | null;
}

/** Hash the catalog from its pretty-printed JSON (single pass, reused for the
 *  catalog.log entry). Returns { hash, prettyJson }. */
function hashCatalog(catalog: unknown): { hash: string; prettyJson: string } {
  const prettyJson = safejson(catalog);
  const hash = crypto.createHash('sha256').update(prettyJson).digest('hex').slice(0, 16);
  return { hash, prettyJson };
}

/** Write the catalog to catalog.log if its hash hasn't been seen this process. */
function logCatalogIfNew(prettyJson: string, hash: string, context: CatalogLogContext): void {
  if (seenCatalogHashes.has(hash)) return;
  seenCatalogHashes.add(hash);

  catalogLogger.info(
    [
      '',
      SEP,
      `${ts()}  [CATALOG]  hash=${hash}`,
      SEP,
      `  first_seen_txn : ${context.txnId}`,
      `  first_seen_bap : ${context.bapId ?? '-'}`,
      `  first_seen_dom : ${context.domain ?? '-'}`,
      '',
      prettyJson,
      '',
    ].join('\n'),
  );
}

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

/** Returns a clone of `payload` where `message.catalog` is replaced with `{}`.
 *  Does NOT mutate the input — payload builder output is untouched. */
function stripCatalogForLog(payload: unknown): { stripped: unknown; catalog: unknown | undefined } {
  if (!payload || typeof payload !== 'object') return { stripped: payload, catalog: undefined };
  const p = payload as Record<string, any>;
  const msg = p['message'];
  if (!msg || typeof msg !== 'object' || msg['catalog'] === undefined) {
    return { stripped: payload, catalog: undefined };
  }
  const clone = { ...p, message: { ...msg, catalog: {} } };
  return { stripped: clone, catalog: msg['catalog'] };
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
  error?: string;
}

export interface BecknOutgoingLogInfo {
  action: string;
  transactionId: string;
  messageId: string;
  url: string;
  body: unknown;
  /** Headers WE sent on the outbound request. */
  requestHeaders?: Record<string, string | null | undefined>;
  httpStatus?: number;
  responseBody?: unknown;
  /** Headers the BAP returned. */
  responseHeaders?: Record<string, string | null | undefined>;
  error?: string;
  elapsedMs?: number;
}

// ─── Public log functions ─────────────────────────────────────────────────────

/** Render headers full-length (no truncation) under a section header. */
function pushHeaders(
  lines: string[],
  sectionTitle: string,
  headers: Record<string, string | null | undefined> | undefined,
): void {
  if (!headers) return;
  const entries = Object.entries(headers).filter(([, v]) => v != null);
  if (!entries.length) return;
  lines.push('', sectionTitle);
  for (const [k, v] of entries) {
    lines.push(`  ${k}: ${v}`);
  }
}

function extractCtx(payload: unknown): { bapId: string | null; domain: string | null } {
  const ctx = (payload as any)?.context;
  return { bapId: ctx?.bap_id ?? null, domain: ctx?.domain ?? null };
}

export function logBecknIncoming(info: BecknIncomingLogInfo): void {
  const isError = !!info.error;
  const lines: string[] = [
    '',
    SEP,
    `${ts()}  [INBOUND]  ${info.action.toUpperCase()}${isError ? '  *** ERROR ***' : ''}`,
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

  pushHeaders(lines, HDR_REQ, info.headers);

  lines.push('', HDR_BODY, safejson(info.body));

  if (info.syncResponse !== undefined) {
    const statusLabel = info.syncStatusCode !== undefined ? ` (HTTP ${info.syncStatusCode})` : '';
    lines.push('', `─── SYNC RESPONSE${statusLabel} ${HDR_SYNC_BASE}`, safejson(info.syncResponse));
  }

  if (isError) {
    lines.push('', HDR_ERR, `  ${info.error}`);
  }

  lines.push('');
  loggerForFile(incomingFileFor(info.action)).info(lines.join('\n'));
}

export function logBecknOutgoing(info: BecknOutgoingLogInfo): void {
  const isError = !!info.error;

  // For on_search: hash + log catalog separately (deduped), substitute `{}` in
  // the per-action outgoing log body. Single JSON.stringify pass — the pretty
  // JSON used to hash is reused as catalog.log content.
  let bodyForLog: unknown = info.body;
  let catalogHashLine: string | null = null;
  if (info.action.toLowerCase() === 'on_search') {
    const { stripped, catalog } = stripCatalogForLog(info.body);
    if (catalog !== undefined) {
      const { hash, prettyJson } = hashCatalog(catalog);
      const { bapId, domain } = extractCtx(info.body);
      logCatalogIfNew(prettyJson, hash, { txnId: info.transactionId, bapId, domain });
      catalogHashLine = `  catalog_hash : ${hash}  (full body in catalog.log)`;
      bodyForLog = stripped;
    }
  }

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
  if (catalogHashLine) {
    lines.push(catalogHashLine);
  }

  pushHeaders(lines, HDR_REQ, info.requestHeaders);
  lines.push('', HDR_BODY, safejson(bodyForLog));
  pushHeaders(lines, HDR_RES, info.responseHeaders);

  if (isError) {
    lines.push('', HDR_ERR, `  ${info.error}`);
    if (info.httpStatus !== undefined) {
      lines.push(`  HTTP status: ${info.httpStatus}`);
    }
    if (info.responseBody !== undefined) {
      lines.push('', '  Response body:', safejson(info.responseBody));
    }
  } else {
    const statusLabel = info.httpStatus !== undefined ? `HTTP ${info.httpStatus}` : '?';
    lines.push(
      '',
      `─── RESPONSE (${statusLabel}) ${HDR_RESPONSE_BASE}`,
      safejson(info.responseBody),
    );
  }

  lines.push('');
  loggerForFile(outgoingFileFor(info.action)).info(lines.join('\n'));
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
