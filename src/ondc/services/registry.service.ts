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
   *
   * Filters by subscriber_id + ukId ONLY: those uniquely identify the signing
   * key across all subscriber roles. A hardcoded type filter (old behaviour:
   * type='BAP') made gateway/BPP/logistics-signed requests fail lookup, and
   * request-derived domain/city both poisoned the filter and disagreed with the
   * cache key. A type='BAP' retry is kept as a fallback for registry versions
   * that behave differently without a type filter.
   */
  async lookupPublicKey(subscriberId: string, uniqueKeyId: string): Promise<string | null> {
    const key = cacheKey(subscriberId, uniqueKeyId);
    const cached = pubKeyCache.get(key);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.pubKey;
    }

    const doLookup = async (withBapType: boolean): Promise<string | null> => {
      const requestBody: Record<string, string> = {
        subscriber_id: subscriberId,
        ukId: uniqueKeyId,
        country: 'IND',
        ...(withBapType ? { type: 'BAP' } : {}),
      };

      const bodyStr = JSON.stringify(requestBody);
      const digest = bodyDigest(bodyStr);
      const authHeader = signRequest(bodyStr);

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
      return entry?.signing_public_key ?? null;
    };

    try {
      const pubKey = (await doLookup(false)) ?? (await doLookup(true));
      if (!pubKey) return null;

      pubKeyCache.set(key, {
        pubKey,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });

      return pubKey;
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
