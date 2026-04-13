import { env } from 'node:process';

export function debugForDev(message: string, error?: any) {
  if (!env.isProduction) {
    console.log(message);
    if (error) {
      console.error(error);
    }
  }
}
