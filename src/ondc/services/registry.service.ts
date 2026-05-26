/**
 * ONDC Registry Service — lookup subscriber public keys for signature verification.
 * Implements an in-memory TTL cache to avoid hitting registry on every request.
 *
 * TODO: Optionally persist cache to DB for multi-instance deployments.
 */

import axios from 'axios';
import { ondcNetwork } from '~/ondc/config/network.config';
import { ondcLogger } from '~/ondc/utils/logger.util';
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
  /** Look up a subscriber's signing public key, with cache */
  async lookupPublicKey(subscriberId: string, uniqueKeyId: string): Promise<string | null> {
    const key = cacheKey(subscriberId, uniqueKeyId);
    const cached = pubKeyCache.get(key);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.pubKey;
    }

    try {
      const { data } = await axios.post<OndcRegistryLookupResponse[]>(
        ondcNetwork.registryLookup,
        { subscriber_id: subscriberId, unique_key_id: uniqueKeyId, type: 'BUY' },
        { timeout: ondcNetwork.timeouts.registry },
      );

      const entry = Array.isArray(data) ? data[0] : null;
      if (!entry?.signing_public_key) return null;

      pubKeyCache.set(key, {
        pubKey: entry.signing_public_key,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });

      return entry.signing_public_key;
    } catch (err) {
      ondcLogger.error('Registry lookup failed', { subscriberId, uniqueKeyId, err });
      // Return cached value (even stale) on network failure
      return cached?.pubKey ?? null;
    }
  },

  /** Force-invalidate cache entry */
  invalidate(subscriberId: string, uniqueKeyId: string): void {
    pubKeyCache.delete(cacheKey(subscriberId, uniqueKeyId));
  },

  clearCache(): void {
    pubKeyCache.clear();
  },
};
