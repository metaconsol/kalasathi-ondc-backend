/**
 * Admin Settings Controller — exposes the BPP's NON-SECRET ONDC configuration
 * (from ondcEnv / .env.ondc) for the read-only BPP Settings page.
 *
 * The Ed25519 private key is NEVER returned — only a boolean "is it set". The
 * public key and unique key id ARE public (they live in the ONDC registry), so
 * they're returned as-is.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { ApiResponse, AppError } from '~/lib/response';
import { ondcEnv } from '~/config/ondc.config';
import { ondcNetwork } from '~/ondc/config/network.config';
import { ondcLogger } from '~/ondc/utils/logger.util';

/** GET /api/v1/ondc/admin/settings */
export async function getSettings(_req: Request, res: Response): Promise<void> {
  ApiResponse.success(res, 'BPP settings', {
    subscriber_id: ondcEnv.subscriberId,
    base_uri: ondcEnv.baseUri,
    unique_key_id: ondcEnv.uniqueKeyId,
    environment: ondcEnv.environment,
    registry_lookup_url: ondcEnv.registryLookupUrl,
    gateway_url: ondcNetwork.gateway,
    observability_url: ondcEnv.observabilityUrl,
    // key presence only — never leak the private key material
    sign_priv_key_set: Boolean(ondcEnv.signPrivKey),
    sign_pub_key_set: Boolean(ondcEnv.signPubKey),
    allow_insecure: ondcEnv.allowInsecure,
    // whether the PIN-protected key reveal is available at all
    key_reveal_enabled: Boolean(ondcEnv.settingsRevealPin),
  });
}

// ---------------------------------------------------------------------------
// PIN-protected key reveal — admin enters ONDC_SETTINGS_REVEAL_PIN to see the
// signing keys for a short window (frontend auto-hides after expires_in_sec).
// Brute-force guard: 5 wrong PINs → locked for 10 minutes (in-memory).
// ---------------------------------------------------------------------------

const REVEAL_TTL_SEC = 120;
const MAX_PIN_FAILURES = 5;
const PIN_LOCK_MS = 10 * 60 * 1000;
const revealGuard = { failures: 0, lockedUntil: 0 };

/** Constant-time PIN comparison (via fixed-length digests). */
function pinMatches(input: string, expected: string): boolean {
  const a = createHash('sha256').update(input).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** POST /api/v1/ondc/admin/settings/reveal-keys — body: { pincode } */
export async function revealKeys(req: Request, res: Response): Promise<void> {
  const expected = ondcEnv.settingsRevealPin;
  if (!expected) {
    throw new AppError(
      'Key reveal is disabled — set ONDC_SETTINGS_REVEAL_PIN in the backend env',
      400,
    );
  }

  const now = Date.now();
  if (now < revealGuard.lockedUntil) {
    const waitMin = Math.ceil((revealGuard.lockedUntil - now) / 60_000);
    throw new AppError(`Too many wrong attempts — locked for ${waitMin} more min`, 429);
  }

  const pincode = String(
    (req.body as Record<string, unknown> | undefined)?.['pincode'] ?? '',
  ).trim();
  if (!pincode || !pinMatches(pincode, expected)) {
    revealGuard.failures += 1;
    ondcLogger.warn('BPP settings key reveal: wrong PIN', {
      ip: req.ip,
      failures: revealGuard.failures,
    });
    if (revealGuard.failures >= MAX_PIN_FAILURES) {
      revealGuard.failures = 0;
      revealGuard.lockedUntil = now + PIN_LOCK_MS;
      throw new AppError('Too many wrong attempts — locked for 10 min', 429);
    }
    throw new AppError('Wrong PIN', 401);
  }

  revealGuard.failures = 0;
  ondcLogger.info('BPP settings signing keys revealed to admin', { ip: req.ip });
  ApiResponse.success(res, 'Keys revealed', {
    sign_priv_key: ondcEnv.signPrivKey,
    sign_pub_key: ondcEnv.signPubKey,
    expires_in_sec: REVEAL_TTL_SEC,
  });
}
