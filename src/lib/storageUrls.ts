import { isS3Enabled, resolveS3KeyToUrl } from '~/lib/s3';

const S3_REF = /^s3:(.+)$/;

/** Stored DB value `s3:object/key` → HTTPS URL; otherwise returned unchanged. */
export async function resolveStoredMediaUrl(
  raw: string | null | undefined,
): Promise<string | null> {
  if (raw == null || raw === '') return null;
  const m = raw.match(S3_REF);
  if (!m) return raw;
  if (!isS3Enabled()) return raw;
  try {
    return await resolveS3KeyToUrl(m[1]!);
  } catch {
    return raw;
  }
}

/** Walk plain objects/arrays and replace `s3:…` strings with signed or public HTTPS URLs. */
export async function expandS3RefsDeep<T>(data: T): Promise<T> {
  async function walk(v: unknown): Promise<unknown> {
    if (v == null) return v;
    if (typeof v === 'string') {
      const m = v.match(S3_REF);
      if (m && isS3Enabled()) {
        try {
          return await resolveS3KeyToUrl(m[1]!);
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
