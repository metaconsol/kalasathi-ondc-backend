import { env } from '~/config/env.config';

export function debugForDev(message: string, error?: any) {
  if (!env.isProduction) {
    console.log(message);
    if (error) {
      console.error(error);
    }
  }
}

// Utility to serialize BigInt values for JSON response
export function serializeBigInt<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (key, value) => (typeof value === 'bigint' ? value.toString() : value)),
  );
}

/**
 * Formats a file path into a full URL for the client.
 * Works dynamically on localhost and production.
 */
export function formatFileUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith('http')) return path;

  // Ensure path starts with a slash
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  return `${env.serverUrl}${cleanPath}`;
}
