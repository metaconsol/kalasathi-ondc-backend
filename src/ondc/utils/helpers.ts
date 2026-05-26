/** General-purpose helpers for ONDC module */

/** Generate a unique ONDC order ID with prefix */
export function generateOndcOrderId(): string {
  return `ONDC-${Date.now()}-${crypto.randomUUID().split('-')[0]?.toUpperCase()}`;
}

/** Sanitize PII from ONDC payload for observability logging */
export function sanitizePii<T extends Record<string, any>>(payload: T): T {
  const clone = structuredClone(payload) as any;
  const order = clone?.message?.order;
  if (!order) return clone as T;

  if (order.billing) {
    if ('phone' in order.billing) order.billing.phone = 'XXXXXXXXXX';
    if ('email' in order.billing) order.billing.email = 'anonymous@example.com';
    if ('name' in order.billing) order.billing.name = 'Anonymous User';
  }

  const fulfillments = order.fulfillments as any[] | undefined;
  if (Array.isArray(fulfillments)) {
    for (const f of fulfillments) {
      if (f?.end?.contact?.phone) f.end.contact.phone = 'XXXXXXXXXX';
      if (f?.end?.contact?.email) f.end.contact.email = 'anonymous@example.com';
      if (f?.end?.person?.name) f.end.person.name = 'Anonymous User';
    }
  }

  return clone as T;
}

/** Truncate a string to max length with ellipsis */
export function truncate(str: string, max = 255): string {
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}

/** Convert a comma-separated image string or array to string[] */
export function normalizeImages(images: string | string[] | null | undefined): string[] {
  if (!images) return [];
  if (Array.isArray(images)) return images.filter(Boolean);
  return images
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Safe multiply for price calculations (avoids float precision issues) */
export function safeMul(a: number, b: number, decimals = 2): number {
  return parseFloat((a * b).toFixed(decimals));
}

/** Current UTC timestamp as ISO-8601 string */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Unix epoch seconds */
export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/** Parse "YYYY-MM-DD" or ISO string → Date, return null on failure */
export function parseDate(val: string): Date | null {
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

/** Chunk an array into pages */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Retry an async fn up to `times` times with exponential backoff */
export async function withRetry<T>(fn: () => Promise<T>, times = 3, baseDelayMs = 500): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < times; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < times - 1) await sleep(baseDelayMs * 2 ** i);
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
