/**
 * POST /api/v1/ondc/init
 *
 * Adds payment details + cancellation terms to the order and sends /on_init.
 * Uses COMPLETE_CANCELLATION_TERMS (all 5 fulfillment phases) and
 * buildOnInitPayment for settlement_details.
 */

import type { Request, Response } from 'express';
import { buildAck, buildOnInit } from '~/ondc/utils/payload.builder';
import { becknService } from '~/ondc/services/beckn.service';
import { observabilityService } from '~/ondc/services/observability.service';
import { resolveOndcCatalogRow, resolveOndcCategory } from '~/ondc/adapters/product.adapter';
import { estimateDeliveryCharge } from '~/ondc/services/delhivery.service';
import {
  fetchSellerProfileByStoreId,
  fetchStoreById,
  fetchStoreLocations,
} from '~/ondc/adapters/seller.adapter';
import { ondcQuery } from '~/lib/ondcSql';
import { transactionModel } from '~/ondc/models/transaction.model';
import { txnLogModel } from '~/ondc/models/log.model';
import { overallTxnsModel } from '~/ondc/models/overall_txns.model';
import { ondcEnv } from '~/config/ondc.config';
import { ondcLogger } from '~/ondc/utils/logger.util';
import { buildQuote, type QuoteLineInput } from '~/ondc/utils/catalog.builders';
import type { BecknContext } from '~/ondc/types/beckn.types';

type LooseObject = Record<string, any>;
const DEFAULT_QUOTE_ITEM_TAGS = [
  {
    code: 'quote',
    list: [{ code: 'type', value: 'item' }],
  },
];

interface FallbackCatalogRow {
  product_id: number;
  store_id: number;
  name: string;
  price: number;
  stock: number;
  gst_percent: number;
  time_to_ship_value: number | null;
  time_to_ship_unit: string | null;
  category_id: number | null;
  category_name: string | null;
  category_domain: string | null;
  ondc_subcategory: string | null;
}

async function resolveFallbackCatalogRow(
  itemId: string,
  providerId?: string,
): Promise<FallbackCatalogRow | null> {
  const rows = await ondcQuery<any>(
    `SELECT
       p.id AS product_id,
       p.store_id,
       p.product_name AS name,
       COALESCE(p.default_price, p.mrp, 0) AS price,
       COALESCE(p.stock, 0) AS stock,
       COALESCE(p.gst_percent, 0) AS gst_percent,
       p.time_to_ship_value,
       p.time_to_ship_unit,
       p.category_id,
       c.name   AS category_name,
       c.domain AS category_domain,
       p.ondc_subcategory
     FROM ondc_catalog_items oci
     INNER JOIN products p ON p.id = oci.main_db_product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE oci.ondc_item_id = ?
       AND oci.sync_status = 'synced'
       AND (? = '' OR oci.provider_id = ?)
     ORDER BY oci.updated_at DESC
     LIMIT 1`,
    [itemId, providerId ?? '', providerId ?? ''],
  );

  if (!rows[0]) return null;
  return {
    product_id: Number(rows[0].product_id),
    store_id: Number(rows[0].store_id),
    name: String(rows[0].name ?? ''),
    price: Number(rows[0].price ?? 0),
    stock: Number(rows[0].stock ?? 0),
    gst_percent: Number(rows[0].gst_percent ?? 0),
    time_to_ship_value:
      rows[0].time_to_ship_value != null ? Number(rows[0].time_to_ship_value) : null,
    time_to_ship_unit: rows[0].time_to_ship_unit ?? null,
    category_id: rows[0].category_id != null ? Number(rows[0].category_id) : null,
    category_name: rows[0].category_name ?? null,
    category_domain: rows[0].category_domain ?? null,
    ondc_subcategory: rows[0].ondc_subcategory ?? null,
  };
}

function normalizeAddress(address: LooseObject = {}): LooseObject {
  return {
    ...(address?.name || address?.door ? { name: String(address.name ?? address.door) } : {}),
    ...(address?.building ? { building: String(address.building) } : {}),
    ...(address?.locality || address?.street
      ? { locality: String(address.locality ?? address.street) }
      : {}),
    ...(address?.city ? { city: String(address.city) } : {}),
    ...(address?.state ? { state: String(address.state) } : {}),
    ...(address?.country ? { country: String(address.country) } : {}),
    ...(address?.area_code ? { area_code: String(address.area_code) } : {}),
  };
}

function normalizeBilling(billing: LooseObject = {}): LooseObject {
  return {
    ...(billing?.name ? { name: String(billing.name) } : {}),
    address: normalizeAddress(billing?.address ?? {}),
    ...(billing?.tax_number ? { tax_number: String(billing.tax_number) } : {}),
    ...(billing?.email ? { email: String(billing.email) } : {}),
    ...(billing?.phone ? { phone: String(billing.phone) } : {}),
    ...(billing?.created_at ? { created_at: String(billing.created_at) } : {}),
    ...(billing?.updated_at ? { updated_at: String(billing.updated_at) } : {}),
  };
}

function normalizeQuoteBreakupItem(item: any): any {
  if (!item || typeof item !== 'object') return item;

  const sanitizedItem = { ...item };
  delete sanitizedItem.quantity;

  if (!Array.isArray(sanitizedItem.tags) || sanitizedItem.tags.length === 0) {
    sanitizedItem.tags = DEFAULT_QUOTE_ITEM_TAGS;
  }

  return sanitizedItem;
}

function sanitizeQuoteBreakup(breakup: any[]): any[] {
  return breakup.map((entry: any) => {
    const item = entry?.item;
    if (!item || typeof item !== 'object') return entry;

    const sanitizedItem = { ...item };
    delete sanitizedItem.quantity;

    if (!Array.isArray(sanitizedItem.tags) || sanitizedItem.tags.length === 0) {
      sanitizedItem.tags = DEFAULT_QUOTE_ITEM_TAGS;
    }

    if (Object.keys(sanitizedItem).length === 0) {
      const newEntry = { ...entry };
      delete newEntry.item;
      return newEntry;
    }

    return { ...entry, item: sanitizedItem };
  });
}

function normalizeFulfillments(fulfillments: LooseObject[] = []): LooseObject[] {
  return fulfillments.map((fulfillment, index) => ({
    id: String(fulfillment?.id ?? `F${index + 1}`),
    type: String(fulfillment?.type ?? 'Delivery'),
    tracking: false,
    ...(fulfillment?.end
      ? {
          end: {
            ...(fulfillment.end?.location
              ? {
                  location: {
                    ...(fulfillment.end.location?.gps
                      ? { gps: String(fulfillment.end.location.gps) }
                      : {}),
                    address: normalizeAddress(fulfillment.end.location?.address ?? {}),
                  },
                }
              : {}),
            ...(fulfillment.end?.contact
              ? {
                  contact: {
                    ...(fulfillment.end.contact?.phone
                      ? { phone: String(fulfillment.end.contact.phone) }
                      : {}),
                    // ...(fulfillment.end.contact?.email
                    //   ? { email: String(fulfillment.end.contact.email) }
                    //   : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
  }));
}

/**
 * Delivery charge we already quoted in this transaction's outbound /on_select
 * (quote-trail consistency — the contract requires on_init's quote to match
 * on_select's). Returns null when no on_select was logged for the txn.
 * Also used by confirm.controller as its no-inbound-quote fallback.
 */
export async function quotedSelectDeliveryCharge(txnId: string): Promise<number | null> {
  try {
    const rows = await ondcQuery<{ payload_json: string | null }>(
      `SELECT payload_json FROM ondc_txn_logs
       WHERE transaction_id = ? AND action = 'on_select' AND direction = 'outbound'
       ORDER BY id DESC LIMIT 1`,
      [txnId],
    );
    if (!rows[0]?.payload_json) return null;
    const payload = JSON.parse(rows[0].payload_json);
    const breakup = payload?.message?.order?.quote?.breakup;
    if (!Array.isArray(breakup)) return null;
    const delivery = breakup.find((b: any) => String(b?.['@ondc/org/title_type']) === 'delivery');
    if (!delivery) return null;
    const value = Number(delivery?.price?.value);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

export async function handleInit(req: Request, res: Response): Promise<void> {
  const { context: ctx, message } = req.body as {
    context: BecknContext;
    message: { order: Record<string, any> };
  };

  res.status(200).json(buildAck(ctx));

  setImmediate(async () => {
    const txnId = ctx.transaction_id;
    const bapUri = String(ctx.bap_uri ?? '');
    const order = message?.order ?? {};

    try {
      // Inbound request is logged centrally by ondcRequestLogger middleware.
      await transactionModel.upsert({
        transaction_id: txnId,
        bap_id: ctx.bap_id,
        bpp_id: ctx.bpp_id ?? null,
        domain: ctx.domain,
        city: ctx.city,
        country: ctx.country ?? null,
        core_version: ctx.core_version ?? null,
        status: 'INIT',
      });
      await overallTxnsModel.upsert(txnId);
      await overallTxnsModel.patch(txnId, { on_init: 1 });

      const storeIdFromProvider =
        Number.parseInt(String(order?.['provider']?.['id'] ?? ''), 10) || null;
      const inboundItems = Array.isArray(order['items']) ? order['items'] : [];
      const inboundFulfillments = Array.isArray(order['fulfillments']) ? order['fulfillments'] : [];
      const inboundBreakup = Array.isArray(order?.['quote']?.['breakup'])
        ? order['quote']['breakup']
        : [];
      const inboundTags = Array.isArray(order['tags']) ? order['tags'] : undefined;
      const fallbackFulfillmentId = String(
        inboundItems[0]?.fulfillment_id ?? inboundFulfillments[0]?.id ?? 'F1',
      );

      const quoteLines: QuoteLineInput[] = [];
      const shippingItems: Array<{ productId: number; quantity: number }> = [];
      let resolvedStoreId: number | null = storeIdFromProvider;
      // resolveOndcCategory always returns a canonical uppercase domain
      // (e.g. 'ONDC:RET12'); ctx.domain is only trimmed by the validator
      // middleware, not case-normalized, so a lowercase/mixed-case but
      // otherwise valid ctx.domain must be normalized here too — otherwise
      // a strict comparison would reject every item in an order that
      // actually matches.
      const normalizedCtxDomain = String(ctx.domain ?? '')
        .trim()
        .toUpperCase();
      const normalizedItems: Array<{
        id: string;
        fulfillment_id: string;
        quantity: { count: number };
      }> = [];
      for (const rawItem of inboundItems) {
        const quantity = Number(rawItem?.quantity?.count);
        if (!rawItem?.id || !Number.isFinite(quantity) || quantity <= 0) continue;

        const fulfillmentId = String(rawItem.fulfillment_id ?? fallbackFulfillmentId);
        normalizedItems.push({
          id: String(rawItem.id),
          fulfillment_id: fulfillmentId,
          quantity: { count: quantity },
        });

        const catalogRow =
          (await resolveOndcCatalogRow(String(rawItem.id))) ??
          (await resolveFallbackCatalogRow(
            String(rawItem.id),
            String(order?.['provider']?.['id'] ?? ''),
          ));
        if (!catalogRow) continue;
        if (resolvedStoreId !== null && catalogRow.store_id !== resolvedStoreId) continue;
        // Domain cross-check — same rule as /select: a product's real domain
        // comes from categories.domain (→ mappings → rules.json), never from
        // the incoming ctx.domain. Skip enriching the quote for a mismatched
        // item (mirrors the silent-skip convention already used for store_id
        // above); the item id itself is still echoed in normalizedItems since
        // on_init must reflect back what the buyer sent in /init.
        // Fail-safe: a transient DB error resolving ONE item's domain must
        // not abort the whole /init (the outer catch has no callback path,
        // so the buyer would see nothing until TTL expiry) — treat it like a
        // mismatch (skip just this item) and keep going.
        let itemDomain: string | null = null;
        try {
          itemDomain = (await resolveOndcCategory(catalogRow)).domain;
        } catch (err) {
          ondcLogger.error('resolveOndcCategory failed — excluding item from init quote', {
            txnId,
            itemId: rawItem.id,
            err,
          });
        }
        if (itemDomain !== normalizedCtxDomain) continue;

        resolvedStoreId = catalogRow.store_id;
        if ('product_id' in catalogRow && catalogRow.product_id) {
          shippingItems.push({ productId: Number(catalogRow.product_id), quantity });
        }
        quoteLines.push({
          itemId: String(rawItem.id),
          itemName: catalogRow.name,
          unitPrice: catalogRow.price,
          quantity,
          stockAvailable: catalogRow.stock > 0 ? 99 : 0,
          stockMaximum: catalogRow.stock,
          taxPercent: catalogRow.gst_percent,
        });
      }

      // ── Delivery charge: the quote trail must stay consistent — on_init's
      // quote has to match on_select's. Reuse the delivery charge we quoted in
      // THIS transaction's outbound /on_select; if the buyer skipped /select,
      // fall back to a fresh Delhivery estimate (0 only as last resort).
      const buyerPincode =
        String(
          inboundFulfillments.find((f: any) => f?.end?.location?.address?.area_code)?.end?.location
            ?.address?.area_code ??
            (order['billing'] as any)?.address?.area_code ??
            '',
        ).trim() || null;
      const deliveryCharge =
        (await quotedSelectDeliveryCharge(txnId)) ??
        (await estimateDeliveryCharge({
          storeId: resolvedStoreId,
          items: shippingItems,
          buyerPincode,
          paymentType: 'Pre-paid',
        })) ??
        0;

      const quote = (() => {
        const computedQuote = buildQuote(quoteLines, fallbackFulfillmentId, deliveryCharge, {
          includeZeroBreakups: true,
        });
        if (inboundBreakup.length === 0) {
          return {
            ...computedQuote,
            breakup: sanitizeQuoteBreakup((computedQuote.breakup as any[]) ?? []),
          };
        }

        const mergedBreakup = [...inboundBreakup];
        const seenKeys = new Set(
          inboundBreakup.map((entry: any) =>
            [
              String(entry?.['@ondc/org/item_id'] ?? ''),
              String(entry?.['@ondc/org/title_type'] ?? ''),
              String(entry?.title ?? ''),
            ].join('|'),
          ),
        );

        for (const entry of computedQuote.breakup as any[]) {
          const key = [
            String(entry?.['@ondc/org/item_id'] ?? ''),
            String(entry?.['@ondc/org/title_type'] ?? ''),
            String(entry?.title ?? ''),
          ].join('|');
          if (seenKeys.has(key)) continue;
          mergedBreakup.push(entry);
          seenKeys.add(key);
        }

        return {
          ...(order['quote'] ?? {}),
          breakup: sanitizeQuoteBreakup(mergedBreakup),
          ttl: order?.['quote']?.['ttl'] ?? computedQuote.ttl ?? 'P1D',
        };
      })();
      const total = parseFloat(String(quote?.price?.value ?? '0')) || 0;
      const storeId = resolvedStoreId;
      const [store, storeLocations, sellerProfile] = await Promise.all([
        storeId ? fetchStoreById(storeId) : Promise.resolve(null),
        storeId ? fetchStoreLocations(storeId) : Promise.resolve([]),
        storeId ? fetchSellerProfileByStoreId(storeId) : Promise.resolve(null),
      ]);

      const providerLocationIds = storeLocations.map((loc) => ({ id: String(loc.id) }));
      const providerId = storeId ? String(storeId) : String(order?.['provider']?.['id'] ?? '');
      const buyerFeeAmount =
        String(order?.['payment']?.['@ondc/org/buyer_app_finder_fee_amount'] ?? '').trim() ||
        String(ondcEnv.buyerFinderFeeDefault);

      const settlementDetails = [
        {
          settlement_counterparty: 'seller-app',
          settlement_phase: 'sale-amount',
          settlement_type: 'neft',
          beneficiary_name: String(sellerProfile?.business_name ?? store?.name ?? ''),
          upi_address: String(sellerProfile?.upi_id ?? ''),
          settlement_bank_account_no: String(sellerProfile?.bank_account_no ?? ''),
          settlement_ifsc_code: String(sellerProfile?.bank_ifsc ?? ''),
          bank_name: String(sellerProfile?.bank_name ?? 'Kotak Mahindra Bank'),
          branch_name: String(sellerProfile?.branch_name ?? 'Bhopal'),
        },
      ];

      const bppTerms = [
        {
          code: 'bpp_terms',
          list: [
            { code: 'tax_number', value: String(sellerProfile?.gstin ?? '') },
            { code: 'provider_tax_number', value: String(sellerProfile?.pan ?? '') },
          ],
        },
      ];

      const initOrder: {
        provider: object;
        items: object[];
        billing: object;
        fulfillments: object[];
        quote: object;
        payment: object;
        tags?: object[];
      } = {
        provider: {
          id: providerId,
          ...(providerLocationIds.length ? { locations: providerLocationIds } : {}),
        },
        items: normalizedItems,
        billing: normalizeBilling(order['billing'] ?? {}),
        fulfillments: normalizeFulfillments(
          inboundFulfillments.length
            ? inboundFulfillments
            : [{ id: fallbackFulfillmentId, type: 'Delivery' }],
        ),
        quote: {
          ...quote,
          ttl: order?.['quote']?.['ttl'] ?? quote.ttl ?? 'P1D',
        },
        // Contract v1.2.5 on_init payment: type/collected_by + settlement terms
        // are required alongside the finder fee and settlement details.
        payment: {
          type: String(order?.['payment']?.['type'] ?? 'ON-ORDER'),
          collected_by: String(order?.['payment']?.['collected_by'] ?? 'BAP'),
          status: 'NOT-PAID',
          params: {
            amount: total.toFixed(2),
            currency: 'INR',
          },
          '@ondc/org/buyer_app_finder_fee_type': 'percent',
          '@ondc/org/buyer_app_finder_fee_amount': buyerFeeAmount,
          '@ondc/org/settlement_basis': 'delivery',
          '@ondc/org/settlement_window': 'P1D',
          '@ondc/org/withholding_amount': '0.00',
          '@ondc/org/settlement_details': settlementDetails,
        },
      };
      const finalTags = inboundTags ? [...inboundTags, ...bppTerms] : bppTerms;
      if (finalTags) initOrder.tags = finalTags;

      const payload = buildOnInit(ctx, initOrder) as any;
      const { statusCode, error: cbErr } = await becknService.sendCallback(
        becknService.buildCallbackUrl(bapUri, 'on_init'),
        'on_init',
        payload,
        txnId,
      );

      await txnLogModel.insert({
        transaction_id: txnId,
        message_id: payload.context.message_id,
        action: 'on_init',
        direction: 'outbound',
        bap_id: ctx.bap_id,
        bpp_id: payload.context.bpp_id ?? null,
        domain: ctx.domain,
        http_status: statusCode ?? null,
        ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
        payload_json: JSON.stringify(payload),
        error_message: cbErr ?? null,
      });

      observabilityService.push('on_init', payload);
    } catch (err) {
      ondcLogger.error('init async error', { txnId, err });
    }
  });
}
