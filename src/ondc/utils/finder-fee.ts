/**
 * Buyer app finder fee — resolved once, echoed everywhere.
 *
 * The BAP declares its fee on /search. Every on_* callback must return that
 * same value, and the /recon commission must be computed from it. Before this
 * existed each emit site made its own decision and most fell back to
 * ONDC_BUYER_FINDER_FEE_DEFAULT, which is wrong for nearly every BAP.
 */

import { ondcQuery } from '~/lib/ondcSql';
import { ondcEnv } from '~/config/ondc.config';
import { ondcLogger } from '~/ondc/utils/logger.util';

export type FinderFeeType = 'percent' | 'amount';

export interface FinderFee {
  amount: string;
  type: FinderFeeType;
  /** Which tier answered — 'default' means we invented it and nobody asked for it. */
  source: 'request' | 'order' | 'transaction' | 'bap' | 'default';
}

const AMOUNT_KEYS = ['@ondc/org/buyer_app_finder_fee_amount', 'buyer_app_finder_fee_amount'];
const TYPE_KEYS = ['@ondc/org/buyer_app_finder_fee_type', 'buyer_app_finder_fee_type'];

/** Presence, not truthiness — a fee of 0 is a real value and must not fall through. */
function readKey(payment: Record<string, any> | null | undefined, keys: string[]): string | null {
  if (!payment) return null;
  for (const key of keys) {
    const value = payment[key];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text !== '') return text;
  }
  return null;
}

function normalizeType(value: string | null | undefined): FinderFeeType | null {
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  if (text === 'percent' || text === 'percentage') return 'percent';
  if (text === 'amount') return 'amount';
  return null;
}

/** The fee carried by a request or a stored payment block, if it carries one at all. */
export function readFinderFee(
  payment: Record<string, any> | null | undefined,
): { amount: string; type: FinderFeeType | null } | null {
  const amount = readKey(payment, AMOUNT_KEYS);
  if (amount === null) return null;
  return { amount, type: normalizeType(readKey(payment, TYPE_KEYS)) };
}

function envDefault(): FinderFee {
  return { amount: String(ondcEnv.buyerFinderFeeDefault), type: 'percent', source: 'default' };
}

interface StoredFee {
  amount: string | null;
  type: string | null;
}

async function fromOrder(ondcOrderId: string): Promise<StoredFee | null> {
  const rows = await ondcQuery<StoredFee>(
    `SELECT buyer_finder_fee_amount AS amount, buyer_finder_fee_type AS type
     FROM ondc_orders WHERE ondc_order_id = ? LIMIT 1`,
    [ondcOrderId],
  );
  return rows[0] ?? null;
}

async function fromTransaction(transactionId: string): Promise<StoredFee | null> {
  const rows = await ondcQuery<StoredFee>(
    `SELECT bff_amount AS amount, bff_type AS type
     FROM ondc_transactions WHERE transaction_id = ? LIMIT 1`,
    [transactionId],
  );
  return rows[0] ?? null;
}

async function fromBap(bapId: string): Promise<StoredFee | null> {
  const rows = await ondcQuery<StoredFee>(
    `SELECT bff_percent AS amount, bff_type AS type
     FROM bap_terms WHERE bap_id = ? LIMIT 1`,
    [bapId],
  );
  return rows[0] ?? null;
}

function use(stored: StoredFee | null, source: FinderFee['source']): FinderFee | null {
  const amount = String(stored?.amount ?? '').trim();
  if (!stored || amount === '') return null;
  return { amount, type: normalizeType(stored.type) ?? 'percent', source };
}

export interface ResolveInput {
  /** Payment block of the request being answered. Wins when it carries the fee. */
  requestPayment?: Record<string, any> | null;
  ondcOrderId?: string | null;
  transactionId?: string | null;
  bapId?: string | null;
}

/**
 * The fee to put on the wire, resolved from the most specific source available.
 *
 * A request that states its own fee wins: we are answering that request, and
 * contradicting it would break the mirror the BAP validates against. Any
 * divergence from the stored value is logged rather than silently overridden.
 * Falling through to the env default is logged too — it produces a number
 * nobody asked for, and it used to do so invisibly.
 */
export async function resolveFinderFee(input: ResolveInput): Promise<FinderFee> {
  const stored =
    (input.ondcOrderId ? use(await fromOrder(input.ondcOrderId), 'order') : null) ??
    (input.transactionId ? use(await fromTransaction(input.transactionId), 'transaction') : null) ??
    (input.bapId ? use(await fromBap(input.bapId), 'bap') : null);

  const fromRequest = readFinderFee(input.requestPayment);
  if (fromRequest) {
    const resolved: FinderFee = {
      amount: fromRequest.amount,
      type: fromRequest.type ?? stored?.type ?? 'percent',
      source: 'request',
    };
    if (stored && stored.amount !== resolved.amount) {
      ondcLogger.warn('finder fee: request disagrees with stored value — echoing the request', {
        transactionId: input.transactionId,
        bapId: input.bapId,
        request: resolved.amount,
        stored: stored.amount,
        storedSource: stored.source,
      });
    }
    return resolved;
  }

  if (stored) return stored;

  ondcLogger.warn('finder fee: no BAP value known — falling back to the env default', {
    transactionId: input.transactionId,
    bapId: input.bapId,
    default: ondcEnv.buyerFinderFeeDefault,
  });
  return envDefault();
}

/** The two keys, ready to spread into an outbound payment block. */
export function finderFeeKeys(fee: FinderFee): Record<string, string> {
  return {
    '@ondc/org/buyer_app_finder_fee_type': fee.type,
    '@ondc/org/buyer_app_finder_fee_amount': fee.amount,
  };
}

/** Synchronous read for money code: the order's frozen fee, else its stored payment block. */
export function orderFinderFee(
  order: { buyer_finder_fee_amount?: string | null; buyer_finder_fee_type?: string | null },
  payment?: Record<string, any> | null,
): FinderFee | null {
  const frozen = use(
    { amount: order.buyer_finder_fee_amount ?? null, type: order.buyer_finder_fee_type ?? null },
    'order',
  );
  if (frozen) return frozen;
  const declared = readFinderFee(payment);
  if (!declared) return null;
  return { amount: declared.amount, type: declared.type ?? 'percent', source: 'request' };
}

/**
 * Commission the BAP is owed. 'amount' is a flat fee, not a percentage —
 * dividing it by 100 (as every call site used to) understates it 100-fold.
 */
export function finderFeeCommission(fee: FinderFee | null, orderTotal: number): number {
  const amount = Number(fee?.amount ?? NaN);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  if (fee?.type === 'amount') return amount;
  return (orderTotal * amount) / 100;
}
