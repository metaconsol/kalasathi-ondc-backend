/**
 * Ed25519 request signing & verification for ONDC Authorization headers.
 *
 * Key format (from PHP .env):
 *   BPP_SIGN_PRIV_KEY  = base64 of 64-byte raw keypair (seed[0:32] + pub[32:64])
 *   BPP_SIGN_PUB_KEY   = base64 of 32-byte raw public key
 *
 * Algorithm:
 *   digest     = BLAKE-512=base64(blake2b_512(body))   [falls back to SHA-256=... if unavailable]
 *   sigString  = "(created): {created}\n(expires): {expires}\ndigest: {digest}"
 *   signature  = base64(ed25519_sign(sigString, privKey))
 *   header     = Signature keyId="{subId}|{ukId}|ed25519",algorithm="ed25519",
 *                created="{created}",expires="{expires}",
 *                headers="(created) (expires) digest",signature="{signature}"
 */

import crypto from 'crypto';
import { ondcEnv } from '~/config/ondc.config';
import type { OndcAuthHeader } from '~/ondc/types/api.types';

// ---------- Key conversion helpers ----------

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex'); // 16 bytes
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex'); // 12 bytes

function rawPrivToNode(b64: string): crypto.KeyObject {
  const raw = Buffer.from(b64, 'base64');
  // Take first 32 bytes (seed). The PHP stores seed[32]+pub[32] = 64 bytes total.
  const seed = raw.length === 64 ? raw.subarray(0, 32) : raw.subarray(0, 32);
  return crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

function rawPubToNode(b64: string): crypto.KeyObject {
  const raw = Buffer.from(b64, 'base64');
  return crypto.createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

// ---------- Digest ----------

/** Returns "BLAKE-512=<b64>" if blake2b512 available, else "SHA-256=<b64>" */
export function bodyDigest(body: string): string {
  try {
    const h = crypto.createHash('blake2b512').update(body, 'utf8').digest('base64');
    return `BLAKE-512=${h}`;
  } catch {
    // Node.js < 21 or OpenSSL without BLAKE2b — fall back to SHA-256
    const h = crypto.createHash('sha256').update(body, 'utf8').digest('base64');
    return `SHA-256=${h}`;
  }
}

// ---------- Signing ----------

function buildSigningString(created: number, expires: number, digest: string): string {
  return `(created): ${created}\n(expires): ${expires}\ndigest: ${digest}`;
}

/** Build the Authorization header value for an outgoing ONDC callback */
export function signRequest(body: string, ttlSeconds = 300): string {
  const created = Math.floor(Date.now() / 1000);
  const expires = created + ttlSeconds;
  const digest = bodyDigest(body);
  const sigStr = buildSigningString(created, expires, digest);

  const privKey = rawPrivToNode(ondcEnv.signPrivKey);
  const sigBuf = crypto.sign(null, Buffer.from(sigStr, 'utf8'), privKey);
  const signature = sigBuf.toString('base64');

  return (
    `Signature keyId="${ondcEnv.subscriberId}|${ondcEnv.uniqueKeyId}|ed25519",` +
    `algorithm="ed25519",` +
    `created="${created}",` +
    `expires="${expires}",` +
    `headers="(created) (expires) digest",` +
    `signature="${signature}"`
  );
}

// ---------- Verification ----------

export function parseAuthHeader(header: string): OndcAuthHeader | null {
  const cleaned = header.replace(/^Signature\s+/i, '');
  const parts: Record<string, string> = {};
  // Split on commas that are NOT inside quotes
  for (const part of cleaned.split(/,(?=\s*\w+=")/)) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part
      .slice(eq + 1)
      .trim()
      .replace(/^"|"$/g, '');
    parts[key] = val;
  }
  if (!parts['keyId'] || !parts['signature']) return null;
  return {
    keyId: parts['keyId'] ?? '',
    algorithm: parts['algorithm'] ?? 'ed25519',
    created: parseInt(parts['created'] ?? '0', 10),
    expires: parseInt(parts['expires'] ?? '0', 10),
    headers: parts['headers'] ?? '',
    signature: parts['signature'] ?? '',
  };
}

/** Verify an incoming request's Authorization header against a known raw-base64 public key */
export function verifySignature(
  body: string,
  parsed: OndcAuthHeader,
  base64PubKey: string,
): boolean {
  try {
    const now = Math.floor(Date.now() / 1000);
    if (parsed.expires > 0 && now > parsed.expires + ondcEnv.headerMaxSkewSec) return false;
    if (parsed.created > 0 && parsed.created > now + ondcEnv.headerMaxSkewSec) return false;

    const digest = bodyDigest(body);
    const sigStr = buildSigningString(parsed.created, parsed.expires, digest);
    const pubKey = rawPubToNode(base64PubKey);
    const sigBuf = Buffer.from(parsed.signature, 'base64');
    return crypto.verify(null, Buffer.from(sigStr, 'utf8'), pubKey, sigBuf);
  } catch {
    return false;
  }
}

/** Verify the digest header of an incoming request */
export function verifyDigestHeader(body: string, digestHeader: string): boolean {
  const computed = bodyDigest(body);
  return computed === digestHeader;
}
