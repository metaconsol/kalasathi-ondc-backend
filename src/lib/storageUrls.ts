import { env } from '~/config/env.config';
import { isS3Enabled, resolveS3KeyToUrl } from '~/lib/s3';

const S3_REF = /^s3:(.+)$/;

function extractConfiguredS3ObjectKey(raw: string): string | null {
  try {
    const url = new URL(raw);
    const expectedHost = `${env.awsBucketName}.s3.${env.awsRegion}.amazonaws.com`;
    if (url.protocol !== 'https:' || url.hostname !== expectedHost) return null;
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    return key || null;
  } catch {
    return null;
  }
}

/** Stored DB value `s3:object/key` → HTTPS URL; otherwise returned unchanged. */
export async function resolveStoredMediaUrl(
  raw: string | null | undefined,
): Promise<string | null> {
  if (raw == null || raw === '') return null;
  const m = raw.match(S3_REF);
  if (!isS3Enabled()) return raw;
  try {
    if (m) return await resolveS3KeyToUrl(m[1]!);
    const key = extractConfiguredS3ObjectKey(raw);
    if (key) return await resolveS3KeyToUrl(key);
    return raw;
  } catch {
    return raw;
  }
}

/** Walk plain objects/arrays and replace `s3:…` strings with public or signed HTTPS URLs. */
export async function expandS3RefsDeep<T>(data: T): Promise<T> {
  async function walk(v: unknown): Promise<unknown> {
    if (v == null) return v;
    if (typeof v === 'string') {
      const m = v.match(S3_REF);
      if (isS3Enabled()) {
        try {
          if (m) return await resolveS3KeyToUrl(m[1]!);
          const key = extractConfiguredS3ObjectKey(v);
          if (key) return await resolveS3KeyToUrl(key);
        } catch {
          return v;
        }
      }
      return v;
    }
    if (Array.isArray(v)) {
      return Promise.all(v.map((x) => walk(x)));
    }
    if (typeof v === 'object' && !(v instanceof Date)) {
      const o = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(o)) {
        out[k] = await walk(val);
      }
      return out;
    }
    return v;
  }
  return walk(data) as Promise<T>;
}
