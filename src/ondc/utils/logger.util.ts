/**
 * ONDC-specific Winston logger.
 * Writes to logs/ondc/ directory with separate files per concern.
 */

import winston from 'winston';
import path from 'path';

const ONDC_LOG_DIR = path.join(process.cwd(), 'logs', 'ondc');

const fileTransport = (filename: string, level = 'debug') =>
  new winston.transports.File({
    filename: path.join(ONDC_LOG_DIR, filename),
    level,
    maxsize: 10 * 1024 * 1024, // 10 MB
    maxFiles: 5,
    tailable: true,
  });

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
  // Terminal stays quiet — only warnings and errors print to the console.
  // Full debug + info traffic (network calls, catalog payloads, etc.) is
  // still written to logs/ondc/network_debug.log and app_error.log.
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

/** Separate logger for outgoing status updates */
export const statusOutgoingLogger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [fileTransport('status_outgoing.log')],
});

/** Separate logger for reconciliation errors */
export const reconLogger = winston.createLogger({
  level: 'error',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [fileTransport('recon_error.log', 'error')],
});

/** Log an ONDC network call (request or response) */
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
