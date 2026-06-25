/**
 * POST /api/v1/ondc/confirm
 *
 * Most critical endpoint — creates the ONDC order.
 *
 * Flow (mirrors PHP confirm.php exactly):
 * 1. ACK immediately (sync, before any DB work)
 * 2. Persist order to ondc_orders + ondc_order_items + ondc_fulfillments
 * 3. Patch overall_txns (amount, payment, address)
 * 4. Build on_confirm and POST signed to bap_uri
 * 5. If BAP ACKs → update status = CONFIRMED
 */

import type { Request, Response } from 'express';
import { buildAck, buildOnConfirm, nowIso, safeJsonParse } from '~/ondc/utils/payload.builder';
import { becknService } from '~/ondc/services/beckn.service';
import { observabilityService } from '~/ondc/services/observability.service';
import { orderModel } from '~/ondc/models/order.model';
import { providerModel } from '~/ondc/models/provider.model';
import { resolveOndcCatalogRow } from '~/ondc/adapters/product.adapter';
import {
  fetchSellerProfileByStoreId,
  fetchStoreById,
  fetchStoreLocations,
  type MainDbStoreLocation,
} from '~/ondc/adapters/seller.adapter';
import { transactionModel } from '~/ondc/models/transaction.model';
import { txnLogModel } from '~/ondc/models/log.model';
import { overallTxnsModel } from '~/ondc/models/overall_txns.model';
import { bapTermsModel } from '~/ondc/models/bap_terms.model';
import { ondcLogger } from '~/ondc/utils/logger.util';
import { ondcEnv } from '~/config/ondc.config';
import { ondcQuery, withOndcTransaction } from '~/lib/ondcSql';
import { buildQuote, type QuoteLineInput } from '~/ondc/utils/catalog.builders';
import type { BecknContext } from '~/ondc/types/beckn.types';

/** Extract numeric string value from quote.price.value */
function quoteTotal(order: Record<string, any>): number {
  return parseFloat(String(order?.['quote']?.['price']?.['value'] ?? '0')) || 0;
}

/** Sum item quantities */
function itemQtyTotal(items: any[]): number {
  return items.reduce((s, i) => s + (parseInt(i?.quantity?.count ?? '1', 10) || 1), 0);
}

function sanitizeQuoteBreakup(breakup: any[]): any[] {
  return breakup.map((entry: any) => {
    const item = entry?.item;
    if (!item || typeof item !== 'object') return entry;

    const sanitizedItem = { ...item };
    delete sanitizedItem.quantity;
    return { ...entry, item: sanitizedItem };
  });
}

const DEFAULT_STATIC_TERMS_URL =
  'https://github.com/ONDC-Official/protocol-network-extension/discussions/79';

type LooseObject = Record<string, any>;

interface FallbackCatalogRow {
  store_id: number;
  name: string;
  price: number;
  stock: number;
  gst_percent: number;
  time_to_ship_value: number | null;
  time_to_ship_unit: string | null;
}

async function resolveFallbackCatalogRow(
  itemId: string,
  providerId?: string,
): Promise<FallbackCatalogRow | null> {
  const rows = await ondcQuery<any>(
    `SELECT
       p.store_id,
       p.product_name AS name,
       COALESCE(p.default_price, p.mrp, 0) AS price,
       COALESCE(p.stock, 0) AS stock,
       COALESCE(p.gst_percent, 0) AS gst_percent,
       p.time_to_ship_value,
       p.time_to_ship_unit
     FROM ondc_catalog_items oci
     INNER JOIN products p ON p.id = oci.main_db_product_id
     WHERE oci.ondc_item_id = ?
       AND oci.sync_status = 'synced'
       AND (? = '' OR oci.provider_id = ?)
     ORDER BY oci.updated_at DESC
     LIMIT 1`,
    [itemId, providerId ?? '', providerId ?? ''],
  );

  if (!rows[0]) return null;
  return {
    store_id: Number(rows[0].store_id),
    name: String(rows[0].name ?? ''),
    price: Number(rows[0].price ?? 0),
    stock: Number(rows[0].stock ?? 0),
    gst_percent: Number(rows[0].gst_percent ?? 0),
    time_to_ship_value:
      rows[0].time_to_ship_value != null ? Number(rows[0].time_to_ship_value) : null,
    time_to_ship_unit: rows[0].time_to_ship_unit ?? null,
  };
}

function isDuplicateOrderError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'ER_DUP_ENTRY' &&
    'sqlMessage' in err &&
    String((err as { sqlMessage?: string }).sqlMessage ?? '').includes('uq_ondc_order_id')
  );
}

function normalizeAddress(address: LooseObject = {}, includeEmpty = false): LooseObject {
  const normalized = {
    name: String(address?.name ?? address?.door ?? ''),
    building: String(address?.building ?? ''),
    locality: String(address?.locality ?? address?.street ?? ''),
    city: String(address?.city ?? ''),
    state: String(address?.state ?? ''),
    country: String(address?.country ?? ''),
    area_code: String(address?.area_code ?? ''),
  };

  if (includeEmpty) return normalized;

  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== ''));
}

function normalizeBilling(billing: LooseObject = {}, includeEmpty = false): LooseObject {
  const normalized = {
    name: String(billing?.name ?? ''),
    address: normalizeAddress(billing?.address ?? {}, includeEmpty),
    tax_number: String(billing?.tax_number ?? ''),
    email: String(billing?.email ?? ''),
    phone: String(billing?.phone ?? ''),
    created_at: String(billing?.created_at ?? ''),
    updated_at: String(billing?.updated_at ?? ''),
  };

  if (includeEmpty) return normalized;

  return {
    ...Object.fromEntries(
      Object.entries(normalized).filter(([key, value]) => key === 'address' || value !== ''),
    ),
    address: normalized.address,
  };
}

function buildTimeToShip(
  value: number | null | undefined,
  unit: string | null | undefined,
): string {
  if (!value || !unit) return 'P1D';
  switch (String(unit).toUpperCase()) {
    case 'MINUTES':
      return `PT${value}M`;
    case 'HOURS':
      return `PT${value}H`;
    case 'DAYS':
      return `P${value}D`;
    default:
      return 'P1D';
  }
}

export async function handleConfirm(req: Request, res: Response): Promise<void> {
  const { context: ctx, message } = req.body as {
    context: BecknContext;
    message: { order: Record<string, any> };
  };

  // Sync ACK — must be first
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
        status: 'CONFIRM',
      });

      // Parse billing / payment / fulfillment details
      const billing = order['billing'] ?? {};
      const payment = order['payment'] ?? {};
      const items: any[] = Array.isArray(order['items']) ? order['items'] : [];
      const fulfillments: any[] = Array.isArray(order['fulfillments']) ? order['fulfillments'] : [];
      const itemCount = itemQtyTotal(items);
      const inboundBreakup: any[] = safeJsonParse(
        JSON.stringify(order['quote']?.['breakup'] ?? []),
        [],
      );
      const fallbackFulfillmentId = String(items[0]?.fulfillment_id ?? fulfillments[0]?.id ?? 'F1');
      const quoteLines: QuoteLineInput[] = [];
      let resolvedStoreId: number | null =
        Number.parseInt(String(order['provider']?.['id'] ?? ''), 10) || null;
      const normalizedItems: Array<{
        id: string;
        fulfillment_id: string;
        quantity: { count: number };
      }> = [];
      let firstTat = 'P1D';
      for (const item of items) {
        const qty = parseInt(item?.quantity?.count ?? '1', 10) || 1;
        if (!item?.id || qty <= 0) continue;
        const fulfillmentId = String(item.fulfillment_id ?? fallbackFulfillmentId);
        normalizedItems.push({
          id: String(item.id),
          fulfillment_id: fulfillmentId,
          quantity: { count: qty },
        });
        const catalogRow =
          (await resolveOndcCatalogRow(String(item.id))) ??
          (await resolveFallbackCatalogRow(
            String(item.id),
            String(order['provider']?.['id'] ?? ''),
          ));
        if (!catalogRow) continue;
        if (resolvedStoreId !== null && catalogRow.store_id !== resolvedStoreId) continue;
        resolvedStoreId = catalogRow.store_id;
        firstTat = buildTimeToShip(catalogRow.time_to_ship_value, catalogRow.time_to_ship_unit);
        quoteLines.push({
          itemId: String(item.id),
          itemName: catalogRow.name,
          unitPrice: catalogRow.price,
          quantity: qty,
          stockAvailable: catalogRow.stock > 0 ? 99 : 0,
          stockMaximum: catalogRow.stock > 0 ? 99 : 0,
          taxPercent: catalogRow.gst_percent,
        });
      }
      const computedQuote = buildQuote(quoteLines, fallbackFulfillmentId, 0, 0, 0, {
        includeZeroBreakups: true,
        fulfillmentTax: 0,
      });
      const breakup: any[] = (() => {
        if (inboundBreakup.length === 0) {
          return sanitizeQuoteBreakup((computedQuote.breakup as any[]) ?? []);
        }
        const merged = [...inboundBreakup];
        const seen = new Set(
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
          if (seen.has(key)) continue;
          merged.push(entry);
          seen.add(key);
        }
        return sanitizeQuoteBreakup(merged);
      })();
      const total =
        parseFloat(
          String(order?.['quote']?.['price']?.['value'] ?? computedQuote.price.value ?? '0'),
        ) || 0;

      const storeId = resolvedStoreId;
      const [store, storeLocations, sellerProfile] = await Promise.all([
        storeId ? fetchStoreById(storeId) : Promise.resolve(null),
        storeId ? fetchStoreLocations(storeId) : Promise.resolve([]),
        storeId ? fetchSellerProfileByStoreId(storeId) : Promise.resolve(null),
      ]);
      const bapTerms = ctx?.bap_id ? await bapTermsModel.findByBapId(String(ctx.bap_id)) : null;
      const providerId = storeId ? String(storeId) : String(order['provider']?.['id'] ?? '');
      const providerLocationIds = storeLocations.map((loc: MainDbStoreLocation) => ({
        id: String(loc.id),
      }));
      const startLoc = storeLocations[0];
      const providerName = store?.name ?? '';

      let itemTotal = 0,
        deliveryCharge = 0,
        packingCharge = 0,
        taxTotal = 0,
        convenienceFee = 0,
        discountTotal = 0;
      for (const b of breakup) {
        const v = parseFloat(String(b?.price?.value ?? '0')) || 0;
        const t = String(b?.['@ondc/org/title_type'] ?? '');
        if (t === 'item') itemTotal += v;
        if (t === 'delivery') deliveryCharge += v;
        if (t === 'packing') packingCharge += v;
        if (t === 'tax') taxTotal += v;
        if (t === 'misc') convenienceFee += v;
        if (t === 'discount') discountTotal += v;
      }

      const ondcOrderId = String(order['id'] || `ONDC-${txnId.slice(0, 8).toUpperCase()}`);

      // Resolve seller / store from the underlying stores row (provider_id = String(stores.id)).
      const provider = providerId ? await providerModel.findById(providerId) : null;

      // Atomic: create order + items + fulfillments.
      // Idempotent: Pramaan retries /confirm with the same order id; a duplicate
      // insert must NOT block on_confirm from being sent. Reuse the existing order.
      let existingOrder = await orderModel.findByOndcOrderId(ondcOrderId);
      const persistOrder = async () => {
        await withOndcTransaction(async (tx) => {
          await orderModel.create(
            {
              ondc_order_id: ondcOrderId,
              transaction_id: txnId,
              message_id: ctx.message_id,
              domain: ctx.domain,
              city: ctx.city ?? null,
              country: ctx.country ?? null,
              core_version: ctx.core_version ?? null,
              bap_id: ctx.bap_id,
              bap_uri: bapUri,
              bpp_id: ondcEnv.subscriberId,
              provider_id: providerId,
              seller_id: provider?.seller_id ?? 0,
              store_id: provider?.store_id ?? null,
              status: 'CREATED',
              payment_method: (payment['type'] === 'ON-DELIVERY' ? 'COD' : 'PREPAID') as any,
              payment_status: payment['status'] === 'PAID' ? 'PAID' : 'NOT_PAID',
              payment_transaction_ref: payment['params']?.['transaction_id'] ?? null,
              payment_json: JSON.stringify(payment),
              item_total: itemTotal.toFixed(2),
              delivery_charges: deliveryCharge.toFixed(2),
              packing_charges: packingCharge.toFixed(2),
              tax_total: taxTotal.toFixed(2),
              convenience_fee: convenienceFee.toFixed(2),
              discount_total: discountTotal.toFixed(2),
              order_total: total.toFixed(2),
              currency: order['quote']?.['price']?.['currency'] ?? 'INR',
              item_count: itemCount,
              customer_name: billing['name'] ?? null,
              customer_phone: billing['phone'] ?? null,
              customer_email: billing['email'] ?? null,
              billing_json: JSON.stringify(normalizeBilling(billing)),
              tracking_number: null,
              tracking_link: null,
              logistics_provider: null,
              cancel_reason_id: null,
              return_reason_id: null,
              raw_confirm_payload: JSON.stringify(req.body),
            },
            tx,
          );

          // Line items
          for (const item of normalizedItems) {
            const qty = parseInt(String(item?.quantity?.count ?? '1'), 10) || 1;
            const price =
              parseFloat(
                String(
                  breakup.find((b: any) => b?.['@ondc/org/item_id'] === item.id)?.item?.price
                    ?.value ?? '0',
                ),
              ) || 0;
            await orderModel.insertItem(
              {
                ondc_order_id: ondcOrderId,
                transaction_id: txnId,
                item_id: String(item.id ?? ''),
                product_id: parseInt(String(item.id ?? '').replace(/\D/g, '') || '0', 10),
                variant_id: null,
                provider_id: providerId,
                seller_id: provider?.seller_id ?? 0,
                quantity: qty,
                unit_price: price.toFixed(2),
                tax_percent: null,
                line_amount: (price * qty).toFixed(2),
                currency: 'INR',
                fulfillment_id: item?.fulfillment_id ?? null,
                raw_item_json: JSON.stringify(item),
              },
              tx,
            );
          }

          // Fulfillments
          for (const f of fulfillments) {
            await orderModel.upsertFulfillment(
              {
                ondc_order_id: ondcOrderId,
                transaction_id: txnId,
                fulfillment_id: String(f.id ?? 'F1'),
                fulfillment_type: String(f.type ?? 'Delivery'),
                fulfillment_role: 'primary_forward',
                state: 'Pending',
                contact_phone: f?.end?.contact?.phone ?? null,
                contact_email: f?.end?.contact?.email ?? null,
                tracking_url: null,
                awb_number: null,
                courier_name: null,
                agent_name: null,
                agent_phone: null,
                estimated_delivery: null,
                actual_delivery: null,
                meta_json: JSON.stringify(f),
              },
              tx,
            );
          }
        });
      };

      if (!existingOrder) {
        try {
          await persistOrder();
          existingOrder = await orderModel.findByOndcOrderId(ondcOrderId);
        } catch (err) {
          if (!isDuplicateOrderError(err)) throw err;
          existingOrder = await orderModel.findByOndcOrderId(ondcOrderId);
          ondcLogger.warn('confirm retry hit existing order; reusing persisted order', {
            ondcOrderId,
            txnId,
          });
        }
      }

      // overall_txns
      await overallTxnsModel.patch(txnId, {
        on_confirm: 1,
        order_amount: total > 0 ? total.toFixed(2) : null,
        payment_status: payment['status'] ?? null,
        payment_method: payment['type'] ?? null,
        item_count: itemCount > 0 ? itemCount : null,
      });

      // Build on_confirm
      const settlementDetails = [
        {
          settlement_counterparty: 'seller-app',
          settlement_phase: 'sale-amount',
          settlement_type: 'neft',
          beneficiary_name: String(sellerProfile?.business_name ?? store?.name ?? ''),
          upi_address: String(sellerProfile?.upi_id ?? ''),
          settlement_bank_account_no: String(sellerProfile?.bank_account_no ?? ''),
          settlement_ifsc_code: String(sellerProfile?.bank_ifsc ?? ''),
          bank_name: '',
          branch_name: '',
        },
      ];
      const confirmTags = [
        {
          code: 'bpp_terms',
          list: [
            { code: 'np_type', value: 'MSN' },
            { code: 'tax_number', value: String(sellerProfile?.gstin ?? '') },
            { code: 'provider_tax_number', value: String(sellerProfile?.pan ?? '') },
            { code: 'accept_bap_terms', value: 'Y' },
          ],
        },
        {
          code: 'bap_terms',
          list: [
            {
              code: 'static_terms',
              value: String(
                bapTerms?.static_terms_new ?? bapTerms?.static_terms ?? DEFAULT_STATIC_TERMS_URL,
              ),
            },
            { code: 'tax_number', value: String(billing?.tax_number ?? '') },
          ],
        },
      ];

      const inboundPaymentType = payment['type'];
      const inboundCollectedBy = payment['collected_by'];
      const inboundPaymentStatus = payment['status'];
      const inboundPaymentParams =
        payment['params'] && typeof payment['params'] === 'object' ? payment['params'] : {};
      const inboundPaymentUrl = payment['url'] ?? payment['uri'];
      const inboundTlMethod = payment['tl_method'];

      const {
        currency: inboundCurrency,
        transaction_id: inboundTransactionId,
        amount: inboundAmount,
        ...remainingPaymentParams
      } = inboundPaymentParams;

      const onConfirmOrder = {
        id: ondcOrderId,
        state: 'Accepted',
        provider: {
          id: providerId,
          locations: providerLocationIds.length ? providerLocationIds : [{ id: '' }],
        },
        items: normalizedItems,
        billing: normalizeBilling(billing, true),
        fulfillments: (fulfillments.length
          ? fulfillments
          : [{ id: fallbackFulfillmentId, type: 'Delivery' }]
        ).map((f: any) => ({
          id: String(f?.id ?? fallbackFulfillmentId),
          '@ondc/org/provider_name': providerName,
          state: { descriptor: { code: String(f?.state?.descriptor?.code ?? 'Pending') } },
          type: String(f?.type ?? 'Delivery'),
          tracking: false,
          '@ondc/org/TAT': firstTat,
          start: {
            location: {
              id: String(startLoc?.id ?? ''),
              descriptor: { name: providerName },
              gps:
                startLoc?.latitude != null && startLoc?.longitude != null
                  ? `${startLoc.latitude},${startLoc.longitude}`
                  : '',
              address: {
                // name: '',
                // building: '',
                locality: String(startLoc?.address_line2 ?? startLoc?.address_line1 ?? ''),
                city: String(startLoc?.city ?? ''),
                state: String(startLoc?.state ?? ''),
                // country: String(startLoc?.country ?? ''),
                area_code: String(startLoc?.pincode ?? ''),
              },
            },
            contact: {
              phone: String(store?.phone ?? ''),
              email: String(store?.email ?? ''),
            },
          },
          end: {
            location: {
              gps: String(f?.end?.location?.gps ?? ''),
              address: normalizeAddress(f?.end?.location?.address ?? {}, true),
            },
            person: { name: String(billing?.name ?? '') },
            contact: {
              phone: String(f?.end?.contact?.phone ?? billing?.phone ?? ''),
              email: String(f?.end?.contact?.email ?? billing?.email ?? ''),
            },
          },
        })),
        quote: {
          ...(order['quote'] ?? {}),
          breakup,
          ttl: order?.['quote']?.['ttl'] ?? computedQuote.ttl ?? 'P1D',
        },
        payment: {
          url: String(inboundPaymentUrl ?? ''),
          tl_method: String(inboundTlMethod ?? 'http/get'),
          params: {
            currency: String(inboundCurrency ?? 'INR'),
            transaction_id: String(inboundTransactionId ?? ''),
            amount: String(inboundAmount ?? (total > 0 ? total.toFixed(2) : '0.00')),
            ...Object.fromEntries(
              Object.entries(remainingPaymentParams).map(([key, value]) => [
                key,
                String(value ?? ''),
              ]),
            ),
          },
          status: String(inboundPaymentStatus ?? 'NOT-PAID'),
          type: String(inboundPaymentType ?? 'ON-ORDER'),
          collected_by: String(inboundCollectedBy ?? 'BAP'),
          '@ondc/org/buyer_app_finder_fee_type': String(
            payment['@ondc/org/buyer_app_finder_fee_type'] ?? 'percent',
          ),
          '@ondc/org/buyer_app_finder_fee_amount': String(
            payment['@ondc/org/buyer_app_finder_fee_amount'] ?? ondcEnv.buyerFinderFeeDefault,
          ),
          '@ondc/org/settlement_basis': String(payment['@ondc/org/settlement_basis'] ?? 'delivery'),
          '@ondc/org/settlement_window': String(payment['@ondc/org/settlement_window'] ?? 'P1D'),
          '@ondc/org/withholding_amount': String(payment['@ondc/org/withholding_amount'] ?? '0.00'),
          '@ondc/org/settlement_details': settlementDetails,
        },
        tags: confirmTags,
        created_at: nowIso(),
        updated_at: nowIso(),
      };

      const onConfirmPayload = buildOnConfirm(ctx, onConfirmOrder) as any;
      const callbackUrl = becknService.buildCallbackUrl(bapUri, 'on_confirm');
      const { statusCode, error: cbErr } = await becknService.sendCallback(
        callbackUrl,
        'on_confirm',
        onConfirmPayload,
        txnId,
      );

      const ackOk = statusCode !== undefined && statusCode >= 200 && statusCode < 300;

      // If BAP ACKed → confirm the order
      if (ackOk) {
        await orderModel.transitionStatus(
          ondcOrderId,
          'CREATED',
          'CONFIRMED',
          null,
          'buyer',
          'BAP ACKed on_confirm',
        );
      }

      await txnLogModel.insert({
        transaction_id: txnId,
        message_id: onConfirmPayload.context.message_id,
        action: 'on_confirm',
        direction: 'outbound',
        bap_id: ctx.bap_id,
        bpp_id: onConfirmPayload.context.bpp_id ?? null,
        domain: ctx.domain,
        http_status: statusCode ?? null,
        ack_status: ackOk ? 'ACK' : 'NACK',
        payload_json: JSON.stringify(onConfirmPayload),
        error_message: cbErr ?? null,
      });

      observabilityService.push('on_confirm', onConfirmPayload);
      ondcLogger.info('Order confirmed', { ondcOrderId, txnId, ackOk });
    } catch (err) {
      ondcLogger.error('confirm async error', { txnId, err });
    }
  });
}
