/**
 * In-process cache of the switched-off buyer apps, so the filter costs no query
 * on the hot path. There is no Redis in this stack and the API runs as a single
 * Node process, so a module-level Map is the whole requirement — a cache server
 * would add an operational dependency and a second failure mode for a list of
 * about twenty short strings.
 *
 * A toggle calls invalidateBapFilterCache(), so a change is visible immediately
 * rather than after the TTL. The TTL only backstops a write this process did not
 * make itself.
 */

import { bapManagementModel } from '~/ondc/models/bap_management.model';
import { bapFilterConfig } from '~/ondc/config/bap-filter.config';

let cached: Set<string> | null = null;
let expiresAt = 0;
let inFlight: Promise<Set<string>> | null = null;

/** The ids currently switched OFF. Throws if it cannot be read — the caller decides. */
export async function inactiveBapIds(): Promise<Set<string>> {
  const now = Date.now();
  if (cached && now < expiresAt) return cached;

  // Collapse a burst of concurrent misses into one query.
  if (!inFlight) {
    inFlight = bapManagementModel
      .listInactiveIds()
      .then((ids) => {
        cached = new Set(ids);
        expiresAt = Date.now() + bapFilterConfig.cacheTtlSeconds * 1000;
        return cached;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function invalidateBapFilterCache(): void {
  cached = null;
  expiresAt = 0;
}
