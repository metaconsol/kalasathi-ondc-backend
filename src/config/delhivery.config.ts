/**
 * Delhivery courier config — used ONLY for pincode serviceability checks in
 * /select (see src/ondc/services/serviceability.service.ts). Mirrors
 * odop_backend's src/config/env.config.ts `delhivery` block; use the SAME
 * DELHIVERY_API_TOKEN value here if you want this BPP to see the same
 * courier coverage the storefront already checks.
 *
 * Disabled by default — the serviceability check falls back to the
 * seller/product-level restriction alone until DELHIVERY_ENABLED=true and a
 * token are set.
 */

function envBool(key: string, fallback = false): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  const normalized = v.trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
}

function envValue(key: string, fallback = ''): string {
  return (process.env[key] ?? fallback).trim();
}

const environment =
  envValue('DELHIVERY_ENV', 'staging').toLowerCase() === 'production' ? 'production' : 'staging';

export const delhiveryEnv = {
  enabled: envBool('DELHIVERY_ENABLED', false),
  environment: environment as 'staging' | 'production',
  baseUrl:
    environment === 'production'
      ? envValue('DELHIVERY_PRODUCTION_BASE_URL', 'https://track.delhivery.com')
      : envValue('DELHIVERY_STAGING_BASE_URL', 'https://staging-express.delhivery.com'),
  token: envValue('DELHIVERY_API_TOKEN'),
};
