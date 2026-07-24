/**
 * ONDC environment configuration.
 * Reads from process.env (populated from .env.ondc via dotenv).
 */

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required ONDC env var: ${key}`);
  return val;
}

function optionalEnv(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

// Resolved first so env-dependent defaults below can use it.
const environment = optionalEnv('ONDC_ENVIRONMENT', 'preprod') as 'preprod' | 'prod';

export const ondcEnv = {
  // Network identity
  subscriberId: requireEnv('BPP_SUBSCRIBER_ID'),
  uniqueKeyId: requireEnv('BPP_UNIQUE_KEY_ID'),
  baseUri: requireEnv('BPP_BASE_URI').replace(/\/$/, ''),

  // Crypto signing keys (raw base64 Ed25519)
  signPrivKey: requireEnv('BPP_SIGN_PRIV_KEY'),
  signPubKey: requireEnv('BPP_SIGN_PUB_KEY'),

  // ONDC registry
  registryLookupUrl: requireEnv('ONDC_REGISTRY_LOOKUP_URL'),

  // ONDC Observability — no prod default: pushing prod logs to the preprod endpoint must never happen silently.
  observabilityUrl: optionalEnv(
    'ONDC_OBSERVABILITY_URL',
    environment === 'prod'
      ? ''
      : 'https://analytics-api-pre-prod.aws.ondc.org/v1/api/push-txn-logs',
  ),
  observabilityToken: optionalEnv('ONDC_OBSERVABILITY_TOKEN'),

  // Environment flag
  environment,

  // Auth
  adminEmail: optionalEnv('ONDC_ADMIN_EMAIL'),
  adminPasswordHash: optionalEnv('ONDC_ADMIN_PASSWORD_HASH'),

  // PIN that lets an admin temporarily reveal the signing keys on the BPP
  // Settings page. Unset = reveal disabled entirely.
  settingsRevealPin: optionalEnv('ONDC_SETTINGS_REVEAL_PIN'),

  // Signature skew tolerance in seconds
  headerMaxSkewSec: parseInt(optionalEnv('ONDC_HEADER_MAX_SKEW_SEC', '300'), 10),

  // Explicit opt-in for the ?insecure=1 signature-verification bypass (testing).
  // Server-side flag only — NEVER derived from request headers. Loopback callers
  // (local Postman/curl) are additionally allowed without this flag.
  // Set ONDC_ALLOW_INSECURE=1 on the preprod box while testing; remove for prod.
  allowInsecure: optionalEnv('ONDC_ALLOW_INSECURE', '0') === '1',

  // Buyer app finder fee default (%)
  buyerFinderFeeDefault: optionalEnv('ONDC_BUYER_FINDER_FEE_DEFAULT', '3'),

  // Whether to enrich catalog on /confirm (mirrors PHP ENRICH_ON_CONFIRM)
  enrichOnConfirm: optionalEnv('ONDC_ENRICH_ON_CONFIRM', '0') === '1',

  // Feature flag — set ONDC_ENABLED=false to disable all ONDC routes
  enabled: optionalEnv('ONDC_ENABLED', 'true') !== 'false',
};
