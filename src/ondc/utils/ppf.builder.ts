/**
 * ONDC NTS10 / PPF (RSF) payload builders — recon & on_recon v2.0.0.
 */

import { randomUUID } from 'crypto';
import { ondcEnv } from '~/config/ondc.config';
import type { OndcOrderItemRow, OndcOrderRow } from '~/ondc/models/order.model';
import type { PpfSettlementItem } from '~/ondc/models/ppf.model';
import type { BecknPayment } from '~/ondc/types/beckn.types';
import { safeJsonParse } from '~/ondc/utils/payload.builder';

export interface NtsContext {
  domain: string;
  location: { country: { code: string }; city: { code: string } };
  version: string;
  action: string;
  bap_id: string;
  bap_uri: string;
  bpp_id: string;
  bpp_uri: string;
  transaction_id: string;
  message_id: string;
  timestamp: string;
  ttl: string;
}

const money = (v: number | string): string => Number(v).toFixed(2);

export function nowNtsIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function buildNtsContext(
  incoming: Partial<NtsContext>,
  action: 'recon' | 'on_recon',
  messageId?: string,
): NtsContext {
  return {
    domain: 'ONDC:NTS10',
    location: {
      country: { code: incoming.location?.country?.code ?? 'IND' },
      city: { code: incoming.location?.city?.code ?? 'std:080' },
    },
    version: incoming.version ?? '2.0.0',
    action,
    bap_id: incoming.bap_id ?? '',
    bap_uri: incoming.bap_uri ?? '',
    bpp_id: incoming.bpp_id ?? ondcEnv.subscriberId,
    bpp_uri: incoming.bpp_uri ?? ondcEnv.baseUri,
    transaction_id: incoming.transaction_id ?? '',
    message_id: messageId ?? randomUUID(),
    timestamp: nowNtsIso(),
    ttl: incoming.ttl ?? 'P1D',
  };
}

export function mapOrderStatusForRecon(status: string): string {
  if (['DELIVERED', 'CONFIRMED', 'CREATED', 'PACKED', 'OUT_FOR_DELIVERY'].includes(status)) {
    return 'COMPLETED';
  }
  if (status === 'CANCELLED') return 'CANCELLED';
  return 'COMPLETED';
}

function itemTitle(row: OndcOrderItemRow): string {
  const raw = safeJsonParse<{ descriptor?: { name?: string } }>(row.raw_item_json, {});
  return raw.descriptor?.name ?? row.item_id;
}

/** Build quote.breakup from persisted order + line items (NTS recon shape). */
export function buildQuoteFromOrder(
  order: OndcOrderRow,
  items: OndcOrderItemRow[],
): Record<string, unknown> {
  const currency = order.currency || 'INR';
  const breakup: Record<string, unknown>[] = [];

  for (const row of items) {
    breakup.push({
      '@ondc/org/item_id': row.item_id,
      '@ondc/org/item_quantity': { count: row.quantity },
      title: itemTitle(row),
      '@ondc/org/title_type': 'item',
      price: { currency, value: money(row.line_amount) },
      item: {
        quantity: { available: { count: '99' }, maximum: { count: '99' } },
        price: { currency, value: money(row.unit_price) },
      },
    });
    const taxAmt = (
      (parseFloat(String(row.line_amount)) * parseFloat(String(row.tax_percent ?? 0))) /
      100
    ).toFixed(2);
    if (parseFloat(taxAmt) > 0) {
      breakup.push({
        '@ondc/org/item_id': row.item_id,
        title: 'Tax',
        '@ondc/org/title_type': 'tax',
        price: { currency, value: taxAmt },
      });
    }
  }

  const fulfillmentId = items[0]?.fulfillment_id ?? 'F1';
  const pushCharge = (
    title: string,
    type: string,
    amount: string,
    extra?: Record<string, unknown>,
  ) => {
    if (parseFloat(amount) <= 0) return;
    breakup.push({
      '@ondc/org/item_id': fulfillmentId,
      title,
      '@ondc/org/title_type': type,
      price: { currency, value: money(amount) },
      ...extra,
    });
  };

  pushCharge('Delivery charges', 'delivery', order.delivery_charges);
  pushCharge('Packing charges', 'packing', order.packing_charges);
  pushCharge('Tax', 'tax', order.tax_total, {
    item: {
      tags: [{ code: 'quote', list: [{ code: 'type', value: 'fulfillment' }] }],
    },
  });
  pushCharge('Convenience Fee', 'misc', order.convenience_fee);

  return {
    price: { currency, value: money(order.order_total) },
    breakup,
    ttl: 'P1D',
  };
}

/** Build settlement rows from order payment + totals. */
export function buildSettlementsFromOrder(
  order: OndcOrderRow,
  counterpartyId?: string,
): PpfSettlementItem[] {
  const payment: BecknPayment = safeJsonParse(order.payment_json ?? '{}', {});
  const currency = order.currency || 'INR';
  const total = parseFloat(String(order.order_total ?? 0));
  const finderFeePercent = parseFloat(payment['@ondc/org/buyer_app_finder_fee_amount'] ?? '3');
  const commission = money((total * finderFeePercent) / 100);
  const withholding = money(payment['@ondc/org/withholding_amount'] ?? 0);
  const settleAmount = money(total - parseFloat(commission));
  const updatedAt = nowNtsIso();
  const cpId = counterpartyId ?? order.bap_id ?? ondcEnv.subscriberId;

  const settlementDetails = payment['@ondc/org/settlement_details'] ?? [];
  const settlements: PpfSettlementItem[] = [];

  if (settlementDetails.length > 0) {
    let idx = 1;
    for (const d of settlementDetails) {
      const amt = d.settlement_amount ?? settleAmount;
      if (parseFloat(String(amt)) === 0) continue;
      const entry: PpfSettlementItem = {
        id: d.settlement_id ?? `settlement-${order.ondc_order_id}-${idx}`,
        counterparty_id: cpId,
        payment_id: `pymnt-${idx}`,
        status: d.settlement_status === 'SETTLED' ? 'SETTLED' : 'TO_BE_INITIATED',
        amount: { currency, value: money(amt) },
        commission: { currency, value: commission },
        withholding_amount: { currency, value: withholding },
        tcs: { currency, value: '0.00' },
        tds: { currency, value: '0.00' },
        updated_at: d.settlement_timestamp ?? updatedAt,
      };
      if (d.settlement_reference) entry.settlement_ref_no = d.settlement_reference;
      settlements.push(entry);
      idx++;
    }
  }

  if (settlements.length === 0) {
    settlements.push({
      id: `settlement-${order.ondc_order_id}-1`,
      counterparty_id: cpId,
      payment_id: 'pymnt-1',
      status: order.payment_status === 'PAID' ? 'PENDING' : 'TO_BE_INITIATED',
      amount: { currency, value: settleAmount },
      commission: { currency, value: commission },
      withholding_amount: { currency, value: withholding },
      tcs: { currency, value: '0.00' },
      tds: { currency, value: '0.00' },
      updated_at: updatedAt,
    });
  }

  return settlements;
}

export function buildReconOrderPayload(
  order: OndcOrderRow,
  items: OndcOrderItemRow[],
  settlements: PpfSettlementItem[],
): Record<string, unknown> {
  const currency = order.currency || 'INR';
  const settlementTotal = settlements.reduce((sum, s) => sum + parseFloat(s.amount.value), 0);
  return {
    id: order.ondc_order_id,
    status: mapOrderStatusForRecon(order.status),
    amount: { currency, value: money(settlementTotal) },
    quote: buildQuoteFromOrder(order, items),
    settlements: settlements.map(formatSettlementForRecon),
  };
}

type MoneyField = { currency: string; value: string; diff_value?: string };

function stripDiffFields(s: PpfSettlementItem): Record<string, unknown> {
  const out: Record<string, unknown> = { ...s };
  for (const key of [
    'amount',
    'commission',
    'withholding_amount',
    'tcs',
    'tds',
    'delay_amount',
  ] as const) {
    const field = (out as any)[key] as MoneyField | undefined;
    if (field && 'diff_value' in field) {
      const { diff_value: _, ...rest } = field;
      (out as any)[key] = rest;
    }
  }
  return out;
}

/** Omit empty optional fields; NTS schema rejects `type: ""`. */
function formatSettlementForRecon(s: PpfSettlementItem): Record<string, unknown> {
  const out = stripDiffFields(s);
  if (!out.type) delete out.type;
  return out;
}

function parseMoney(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && v !== null && 'value' in v) {
    return parseFloat(String((v as MoneyField).value)) || 0;
  }
  return parseFloat(String(v)) || 0;
}

function withDiff(ours: MoneyField, theirs: MoneyField): MoneyField {
  const diff = theirs.value ? (parseMoney(theirs) - parseMoney(ours)).toFixed(2) : '0.00';
  return {
    currency: theirs.currency ?? ours.currency ?? 'INR',
    value: theirs.value ?? ours.value,
    diff_value: diff,
  };
}

/**
 * Compare collector settlements with our records.
 * If a prior on_recon was sent (dispute round), accord when incoming matches that response.
 */
export function reconcileSettlements(
  ours: PpfSettlementItem[],
  theirs: Array<Record<string, unknown>>,
  priorOnReconSettlements?: Array<Record<string, unknown>>,
): { accord: boolean; settlements: Record<string, unknown>[] } {
  const oursById = new Map(ours.map((s) => [s.id, s]));
  let accord = true;
  const reconciled: Record<string, unknown>[] = [];

  const priorById = new Map((priorOnReconSettlements ?? []).map((s) => [String(s['id'] ?? ''), s]));

  for (const their of theirs) {
    const id = String(their['id'] ?? '');
    const our = oursById.get(id);
    const prior = priorById.get(id);
    if (!our && !prior) {
      accord = false;
      reconciled.push({ ...their, _unknown: true });
      continue;
    }

    const baseline = our ?? (prior as unknown as PpfSettlementItem);
    const amountFields = [
      'amount',
      'commission',
      'withholding_amount',
      'tcs',
      'tds',
      'delay_amount',
    ] as const;
    const merged: Record<string, unknown> = { ...their };
    let rowMatch = true;

    for (const field of amountFields) {
      const tVal = their[field] as MoneyField | undefined;
      const oVal = (baseline as any)?.[field] as MoneyField | undefined;
      if (!tVal) continue;

      if (prior && prior[field]) {
        const pVal = prior[field] as MoneyField;
        const matchesPrior = parseMoney(tVal) === parseMoney(pVal);
        if (matchesPrior) {
          merged[field] = { ...tVal, diff_value: '0.00' };
          continue;
        }
      }

      if (oVal) {
        const compared = withDiff(oVal, tVal);
        merged[field] = compared;
        if (compared.diff_value && parseFloat(compared.diff_value) !== 0) rowMatch = false;
      }
    }

    if (!rowMatch) accord = false;
    reconciled.push(merged);
  }

  if (theirs.length !== ours.length && !priorOnReconSettlements?.length) accord = false;
  return { accord, settlements: reconciled };
}

export function buildOnReconError(ctx: NtsContext): Record<string, unknown> {
  return {
    context: buildNtsContext(ctx, 'on_recon'),
    error: { code: '70030', message: 'Invalid Order Id' },
  };
}

export function buildOnReconMessage(
  ctx: NtsContext,
  order: Record<string, unknown>,
  accord: boolean,
  settlements: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    context: buildNtsContext(ctx, 'on_recon'),
    message: {
      orders: [
        {
          ...order,
          recon_accord: accord,
          settlements,
        },
      ],
    },
  };
}
