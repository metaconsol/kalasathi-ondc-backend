/**
 * Verifies the ONDC Authorization (Signature) header on incoming Beckn requests.
 *
 * Flow:
 * 1. Parse the Authorization header
 * 2. Extract subscriber_id + unique_key_id from keyId
 * 3. Look up the subscriber's public key from ONDC registry (cached, 10-min TTL)
 * 4. Verify Ed25519 signature over the signing string built from the RAW request
 *    bytes (req.rawBody, captured by the express.json verify hook in app.ts) —
 *    JSON.parse→stringify does NOT round-trip whitespace / \uXXXX escapes, so
 *    re-serialization breaks verification for Python/PHP/Java BAPs.
 * 5. On failure, invalidate the cached key and retry once with a fresh registry
 *    lookup (handles BAP key rotation inside the cache TTL).
 * 6. If X-Gateway-Authorization is present (gateway-relayed /search), verify it
 *    too against the gateway's registry key.
 *
 * ?insecure=1 bypass (testing): allowed ONLY when the TCP peer is loopback
 * (local Postman/curl) or ONDC_ALLOW_INSECURE=1 is set server-side. Never
 * derived from Host / X-Forwarded-* headers — those are client-controlled.
 */

import type { Request, Response, NextFunction } from 'express';
import { parseAuthHeader, verifySignature, verifyDigestHeader } from '~/ondc/utils/signature.util';
import { ondcLogger } from '~/ondc/utils/logger.util';
import { buildNack } from '~/ondc/utils/payload.builder';
import { registryService } from '~/ondc/services/registry.service';
import { ondcEnv } from '~/config/ondc.config';
import type { BecknContext } from '~/ondc/types/beckn.types';

function nack401(req: Request, res: Response, message: string, code = '20001'): void {
  const ctx = (req.body as { context?: BecknContext }).context;
  if (ctx) {
    res.status(401).json(buildNack(ctx, { type: 'CORE-ERROR', code, message }));
    return;
  }
  res.status(401).json({ error: message });
}

/** Verify one Signature-scheme header value against the raw body; retries once
 *  with a cache-bypassed registry lookup when the cached key fails. */
async function verifySignatureHeader(
  headerValue: string,
  bodyRaw: string,
): Promise<{ ok: boolean; reason?: string; subscriberId?: string }> {
  const parsed = parseAuthHeader(headerValue);
  if (!parsed) return { ok: false, reason: 'Malformed header' };

  // keyId format: "{subscriber_id}|{unique_key_id}|{algo}"
  const [subscriberId, uniqueKeyId] = parsed.keyId.split('|');
  if (!subscriberId || !uniqueKeyId) return { ok: false, reason: 'Invalid keyId format' };

  const pubKey = await registryService.lookupPublicKey(subscriberId, uniqueKeyId);
  if (!pubKey) return { ok: false, reason: 'Subscriber not found', subscriberId };

  if (verifySignature(bodyRaw, parsed, pubKey)) return { ok: true, subscriberId };

  // Key may have rotated inside the cache TTL — invalidate and retry once.
  registryService.invalidate(subscriberId, uniqueKeyId);
  const freshKey = await registryService.lookupPublicKey(subscriberId, uniqueKeyId);
  if (freshKey && freshKey !== pubKey && verifySignature(bodyRaw, parsed, freshKey)) {
    ondcLogger.info('Signature verified after key-cache refresh', { subscriberId });
    return { ok: true, subscriberId };
  }

  return { ok: false, reason: 'Signature verification failed', subscriberId };
}

export async function ondcAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // ?insecure=1 bypass — testing only. Gate on the actual TCP peer address and a
  // server-side env flag; req.hostname is spoofable via X-Forwarded-Host.
  if (req.query['insecure'] === '1') {
    const peer = req.socket.remoteAddress ?? '';
    const isLoopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
    if (isLoopback || ondcEnv.allowInsecure) {
      ondcLogger.warn('insecure=1 bypass — signature verification skipped', {
        path: req.path,
        peer,
        via: isLoopback ? 'loopback' : 'ONDC_ALLOW_INSECURE',
      });
      next();
      return;
    }
    // Not permitted — fall through to normal verification
  }

  const authHeader = req.headers['authorization'] as string | undefined;
  if (!authHeader) {
    ondcLogger.warn('Missing Authorization header', { path: req.path });
    nack401(req, res, 'Missing Authorization header');
    return;
  }

  // Verify against the exact bytes received. rawBody is set by the express.json
  // verify hook (app.ts); the stringify fallback only covers exotic body-parser
  // paths and test harnesses that inject req.body directly.
  const bodyRaw = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);

  // Diagnostics only: a Digest header mismatch means the sender hashed different
  // bytes than we received (proxy rewriting? charset?). The signature check below
  // is authoritative; this log pinpoints WHY it will fail.
  const digestHeader = req.headers['digest'];
  if (typeof digestHeader === 'string' && digestHeader.trim() !== '') {
    if (!verifyDigestHeader(bodyRaw, digestHeader.trim())) {
      ondcLogger.warn('Digest header does not match received body bytes', { path: req.path });
    }
  }

  try {
    const result = await verifySignatureHeader(authHeader, bodyRaw);
    if (!result.ok) {
      ondcLogger.warn('Authorization verification failed', {
        path: req.path,
        reason: result.reason,
        subscriberId: result.subscriberId,
      });
      nack401(
        req,
        res,
        result.reason ?? 'Signature verification failed',
        result.reason === 'Subscriber not found' ? '20002' : '20001',
      );
      return;
    }

    // Gateway-relayed requests (/search via BG) also carry X-Gateway-Authorization;
    // per the ONDC integration guide the Seller App must verify it as well.
    const gwHeader = req.headers['x-gateway-authorization'] as string | undefined;
    if (gwHeader && gwHeader.trim() !== '') {
      const gwResult = await verifySignatureHeader(gwHeader, bodyRaw);
      if (!gwResult.ok) {
        ondcLogger.warn('X-Gateway-Authorization verification failed', {
          path: req.path,
          reason: gwResult.reason,
          subscriberId: gwResult.subscriberId,
        });
        nack401(req, res, 'Gateway signature verification failed');
        return;
      }
    }

    next();
  } catch (err) {
    ondcLogger.error('Error in ondcAuthMiddleware', { err });
    next(err);
  }
}
