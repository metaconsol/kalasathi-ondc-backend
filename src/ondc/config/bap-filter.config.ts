/** Feature flags and action scope for the buyer-app filter. */

const flag = (name: string, fallback = false): boolean => {
  const raw = String(process.env[name] ?? '')
    .trim()
    .toLowerCase();
  if (raw === '') return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
};

/**
 * Only discovery is filterable by default. A switched-off buyer app that still
 * sends /select, /init, /confirm, /status, /track, /cancel, /update or an IGM
 * action is answered normally — those carry real orders and obligations that
 * outlive a toggle, and discovery is where the wasted work actually is.
 * ONDC_BAP_FILTER_ACTIONS overrides, comma-separated.
 */
const DEFAULT_FILTERABLE = ['search'];

function filterableActions(): Set<string> {
  const raw = String(process.env['ONDC_BAP_FILTER_ACTIONS'] ?? '').trim();
  const list = raw
    ? raw
        .split(',')
        .map((a) => a.trim().toLowerCase())
        .filter(Boolean)
    : DEFAULT_FILTERABLE;
  return new Set(list);
}

export const bapFilterConfig = {
  /** Master switch — off means the middleware is a straight pass-through. */
  enabled: flag('FEATURE_BAP_TOGGLE_MANAGER_ENABLED', false),
  /** Record what would be dropped without dropping it. Defaults ON so enabling the
   *  feature alone can never black out a buyer app; clear it deliberately. */
  auditOnly: flag('BAP_FILTER_AUDIT_ONLY', true),
  /** Seconds the inactive list is cached in-process. */
  cacheTtlSeconds: Math.max(0, Number(process.env['BAP_FILTER_CACHE_TTL_SECONDS'] ?? 300) || 0),
};

export function isFilterableAction(action: string): boolean {
  return filterableActions().has(
    String(action ?? '')
      .trim()
      .toLowerCase(),
  );
}
