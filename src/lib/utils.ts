import { env } from 'node:process';

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
