/**
 * ONDC Registry Service — lookup subscriber public keys for signature verification.
 *
 * Matches PHP registry_lookup_pubkey() exactly:
 *   - Body fields: subscriber_id, ukId, type='BAP', country, domain, city
 *   - Request is signed with BPP's own Ed25519 key (Digest + Authorization headers)
 *   - In-memory TTL cache to avoid hitting registry on every request
 */

import axios from 'axios';
import { ondcNetwork } from '~/ondc/config/network.config';
import { ondcLogger } from '~/ondc/utils/logger.util';
import { signRequest, bodyDigest } from '~/ondc/utils/signature.util';
import type { OndcRegistryLookupResponse } from '~/ondc/types/ondc.types';

interface CacheEntry {
  pubKey: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const pubKeyCache = new Map<string, CacheEntry>();

function cacheKey(subscriberId: string, uniqueKeyId: string): string {
  return `${subscriberId}|${uniqueKeyId}`;
}

export const registryService = {
  /**
   * Look up a subscriber's signing public key from the ONDC registry.
   * The request is signed with the BPP's own credentials — required by registry.
   */
  async lookupPublicKey(
    subscriberId: string,
    uniqueKeyId: string,
    domain = '*',
    city = '*',
  ): Promise<string | null> {
    const key = cacheKey(subscriberId, uniqueKeyId);
    const cached = pubKeyCache.get(key);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.pubKey;
    }

    const requestBody = {
      subscriber_id: subscriberId,
      ukId: uniqueKeyId,
      type: 'BAP',
      country: 'IND',
      domain: domain || '*',
      city: city || '*',
    };

    const bodyStr = JSON.stringify(requestBody);
    const digest = bodyDigest(bodyStr);
    const authHeader = signRequest(bodyStr);

    try {
      const { data } = await axios.post<OndcRegistryLookupResponse[]>(
        ondcNetwork.registryLookup,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
            Digest: digest,
            Authorization: authHeader,
          },
          timeout: ondcNetwork.timeouts.registry,
        },
      );

      const arr = Array.isArray(data) ? data : [];

      // PHP match order: exact ukId first, then subscriber_id fallback
      // Registry returns ukId field; unique_key_id is an older alias some versions use
      let entry = arr.find(
        (r) => (r.ukId === uniqueKeyId || r.unique_key_id === uniqueKeyId) && r.signing_public_key,
      );
      if (!entry) {
        entry = arr.find((r) => r.subscriber_id === subscriberId && r.signing_public_key);
      }

      if (!entry?.signing_public_key) return null;

      pubKeyCache.set(key, {
        pubKey: entry.signing_public_key,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });

      return entry.signing_public_key;
    } catch (err) {
      ondcLogger.error('Registry lookup failed', { subscriberId, uniqueKeyId, err });
      return cached?.pubKey ?? null;
    }
  },

  invalidate(subscriberId: string, uniqueKeyId: string): void {
    pubKeyCache.delete(cacheKey(subscriberId, uniqueKeyId));
  },

  clearCache(): void {
    pubKeyCache.clear();
  },
};
