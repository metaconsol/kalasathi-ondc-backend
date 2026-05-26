/**
 * Verifies the ONDC Authorization (Signature) header on incoming Beckn requests.
 *
 * Flow:
 * 1. Parse the Authorization header
 * 2. Extract subscriber_id + unique_key_id from keyId
 * 3. Look up the subscriber's public key from ONDC registry (cached)
 * 4. Verify Ed25519 signature over the signing string
 * 5. Check created/expires timestamps are within allowed skew
 *
 * TODO: Implement registry public-key cache (TTL-based, store in DB or in-memory Map)
 */

import type { Request, Response, NextFunction } from 'express';
import { parseAuthHeader, verifySignature } from '~/ondc/utils/signature.util';
import { ondcLogger } from '~/ondc/utils/logger.util';
import { buildNack } from '~/ondc/utils/payload.builder';
import { registryService } from '~/ondc/services/registry.service';
import type { BecknContext } from '~/ondc/types/beckn.types';

export async function ondcAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // ?insecure=1 bypass — local/dev testing only (mirrors PHP preprod ?insecure=1 behaviour)
  if (req.query['insecure'] === '1') {
    const host = req.hostname ?? '';
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (isLocal || process.env['NODE_ENV'] !== 'production') {
      ondcLogger.warn('insecure=1 bypass — signature verification skipped', { path: req.path });
      next();
      return;
    }
    // On prod, refuse the bypass attempt silently (fall through to normal verification)
  }

  const authHeader = req.headers['authorization'] as string | undefined;

  if (!authHeader) {
    ondcLogger.warn('Missing Authorization header', { path: req.path });
    const ctx = (req.body as { context?: BecknContext }).context;
    if (ctx) {
      res
        .status(401)
        .json(
          buildNack(ctx, {
            type: 'CORE-ERROR',
            code: '20001',
            message: 'Missing Authorization header',
          }),
        );
      return;
    }
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  const parsed = parseAuthHeader(authHeader);
  if (!parsed) {
    ondcLogger.warn('Malformed Authorization header', { path: req.path });
    const ctx = (req.body as { context?: BecknContext }).context;
    if (ctx) {
      res
        .status(401)
        .json(
          buildNack(ctx, {
            type: 'CORE-ERROR',
            code: '20001',
            message: 'Malformed Authorization header',
          }),
        );
      return;
    }
    res.status(401).json({ error: 'Malformed Authorization header' });
    return;
  }

  // keyId format: "{subscriber_id}|{unique_key_id}|{algo}"
  const [subscriberId, uniqueKeyId] = parsed.keyId.split('|');

  if (!subscriberId || !uniqueKeyId) {
    res.status(401).json({ error: 'Invalid keyId format' });
    return;
  }

  try {
    // TODO: add in-process cache to avoid hitting registry on every request
    const pubKey = await registryService.lookupPublicKey(subscriberId, uniqueKeyId);

    if (!pubKey) {
      ondcLogger.warn('Subscriber not found in registry', { subscriberId, uniqueKeyId });
      const ctx = (req.body as { context?: BecknContext }).context;
      if (ctx) {
        res
          .status(401)
          .json(
            buildNack(ctx, { type: 'CORE-ERROR', code: '20002', message: 'Subscriber not found' }),
          );
        return;
      }
      res.status(401).json({ error: 'Subscriber not found' });
      return;
    }

    const bodyRaw = JSON.stringify(req.body);
    const valid = verifySignature(bodyRaw, parsed, pubKey);

    if (!valid) {
      ondcLogger.warn('Signature verification failed', { subscriberId, path: req.path });
      const ctx = (req.body as { context?: BecknContext }).context;
      if (ctx) {
        res
          .status(401)
          .json(
            buildNack(ctx, {
              type: 'CORE-ERROR',
              code: '20001',
              message: 'Signature verification failed',
            }),
          );
        return;
      }
      res.status(401).json({ error: 'Signature verification failed' });
      return;
    }

    next();
  } catch (err) {
    ondcLogger.error('Error in ondcAuthMiddleware', { err });
    next(err);
  }
}
