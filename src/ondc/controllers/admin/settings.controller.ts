/**
 * Admin Settings Controller — exposes the BPP's NON-SECRET ONDC configuration
 * (from ondcEnv / .env.ondc) for the read-only BPP Settings page.
 *
 * The Ed25519 private key is NEVER returned — only a boolean "is it set". The
 * public key and unique key id ARE public (they live in the ONDC registry), so
 * they're returned as-is.
 */

import type { Request, Response } from 'express';
import { ApiResponse } from '~/lib/response';
import { ondcEnv } from '~/config/ondc.config';

/** GET /api/v1/ondc/admin/settings */
export async function getSettings(_req: Request, res: Response): Promise<void> {
  ApiResponse.success(res, 'BPP settings', {
    subscriber_id: ondcEnv.subscriberId,
    base_uri: ondcEnv.baseUri,
    unique_key_id: ondcEnv.uniqueKeyId,
    environment: ondcEnv.environment,
    registry_lookup_url: ondcEnv.registryLookupUrl,
    observability_url: ondcEnv.observabilityUrl,
    // key presence only — never leak the private key material
    sign_priv_key_set: Boolean(ondcEnv.signPrivKey),
    sign_pub_key_set: Boolean(ondcEnv.signPubKey),
    allow_insecure: ondcEnv.allowInsecure,
  });
}
