/**
 * Liveness guard for provider-directed transactions.
 * /on_search only offers live providers, but buyer apps cache catalogs and a
 * deactivated provider keeps receiving /select, /init and /confirm for as long
 * as that cache lives — so each one re-checks the provider it was sent.
 */

import type { BecknError } from '~/ondc/types/beckn.types';
import { isStoreLiveOnOndc } from '~/ondc/adapters/seller.adapter';
import { orderModel } from '~/ondc/models/order.model';

/** ONDC error-codes table: 30021 Merchant Inactive. */
const MERCHANT_INACTIVE: BecknError = {
  type: 'DOMAIN-ERROR',
  code: '30021',
  message: 'Merchant is not available on the network',
};

/** store id a request names, or null when it names none we can act on. */
function namedStoreId(order: Record<string, any> | undefined): number | null {
  const id = Number(order?.['provider']?.['id']);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Error for a request aimed at a provider that is not live, or null to proceed.
 * Returns null when no usable provider.id is present: the callers infer the
 * store from the items in that case, and rejecting there would break requests
 * that work today.
 */
export async function inactiveProviderError(
  order: Record<string, any> | undefined,
): Promise<BecknError | null> {
  const storeId = namedStoreId(order);
  if (storeId === null) return null;
  return (await isStoreLiveOnOndc(storeId)) ? null : MERCHANT_INACTIVE;
}

/** Same guard for /confirm, but an order already placed still settles — retries must not NACK. */
export async function inactiveProviderErrorForConfirm(
  order: Record<string, any> | undefined,
  ondcOrderId: string,
): Promise<BecknError | null> {
  const error = await inactiveProviderError(order);
  if (!error) return null;
  return (await orderModel.findByOndcOrderId(ondcOrderId)) ? null : error;
}
