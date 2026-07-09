/**
 * POST /api/v1/ondc/select
 *
 * Validates items, computes quote using buildQuote (proper ONDC structure
 * with per-item available/maximum counts), and sends /on_select.
 */

import type { Request, Response } from 'express';
import { buildAck, buildOnSelect } from '~/ondc/utils/payload.builder';
import { becknService } from '~/ondc/services/beckn.service';
import { observabilityService } from '~/ondc/services/observability.service';
import { resolveOndcCatalogRow } from '~/ondc/adapters/product.adapter';
import { checkProductServiceability } from '~/ondc/services/serviceability.service';
import { estimateDeliveryCharge } from '~/ondc/services/delhivery.service';
import { fetchStoreById, fetchStoreLocations } from '~/ondc/adapters/seller.adapter';
import { transactionModel } from '~/ondc/models/transaction.model';
import { txnLogModel } from '~/ondc/models/log.model';
import { overallTxnsModel } from '~/ondc/models/overall_txns.model';
import { buildQuote, type QuoteLineInput } from '~/ondc/utils/catalog.builders';
import { ondcLogger } from '~/ondc/utils/logger.util';
import type { BecknContext, BecknError } from '~/ondc/types/beckn.types';

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

function deriveFulfillmentCategory(tat: string): string {
  const mins = /^PT(\d+)M$/.exec(tat);
  if (mins) return 'Immediate Delivery';
  const hours = /^PT(\d+)H$/.exec(tat);
  if (hours && Number(hours[1]) <= 2) return 'Immediate Delivery';
  return 'Standard Delivery';
}

export async function handleSelect(req: Request, res: Response): Promise<void> {
  const { context: ctx, message } = req.body as {
    context: BecknContext;
    message: {
      order: {
        provider: any;
        items: Array<{ id: string; quantity: { count: number }; fulfillment_id?: string }>;
        fulfillments?: any[];
      };
    };
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
        status: 'SELECT',
      });
      await overallTxnsModel.upsert(txnId);

      // Buyer's delivery pincode from the Delivery fulfillment's end location —
      // used for per-product serviceability (products.availability_mode / pincodes).
      const deliveryFulfillment =
        (order.fulfillments ?? []).find((f: any) => (f?.type ?? 'Delivery') === 'Delivery') ??
        order.fulfillments?.[0];
      const buyerPincode =
        String(deliveryFulfillment?.end?.location?.address?.area_code ?? '').trim() || null;

      // Validate items & build quote lines
      const validatedItems: any[] = [];
      const serviceCheckItems: Array<{ itemId: string; productId: number }> = [];
      const shippingItems: Array<{ productId: number; quantity: number }> = [];
      const lines: QuoteLineInput[] = [];
      const itemErrors: string[] = [];
      const requestErrors: string[] = [];
      let firstItemId = '';
      let firstItemName = '';
      let itemCount = 0;
      const fallbackFulfillmentId = String(order.fulfillments?.[0]?.id ?? 'F1');
      let selectedFulfillmentId = fallbackFulfillmentId;
      let resolvedStoreId: number | null =
        Number.isFinite(Number(order.provider?.id)) && Number(order.provider?.id) > 0
          ? Number(order.provider.id)
          : null;
      let firstRow: Awaited<ReturnType<typeof resolveOndcCatalogRow>> | null = null;

      if (!order.provider?.id) {
        requestErrors.push('Missing order.provider.id');
      }

      if (!Array.isArray(order.items) || order.items.length === 0) {
        requestErrors.push('Missing order.items');
      }

      for (const reqItem of order.items ?? []) {
        const qty = Number(reqItem?.quantity?.count);
        if (!reqItem?.id) {
          itemErrors.push('Missing item id');
          continue;
        }
        if (!Number.isFinite(qty) || qty <= 0) {
          itemErrors.push(`Invalid quantity for item ${reqItem.id}`);
          continue;
        }

        const row = await resolveOndcCatalogRow(reqItem.id);
        if (!row) {
          itemErrors.push(`Unavailable item ${reqItem.id}`);
          continue;
        }
        if (resolvedStoreId !== null && row.store_id !== resolvedStoreId) {
          itemErrors.push(`Item ${reqItem.id} does not belong to provider ${order.provider.id}`);
          continue;
        }
        resolvedStoreId = row.store_id;

        itemCount += qty;

        if (!firstItemId) {
          firstItemId = reqItem.id;
          firstItemName = row.name;
          firstRow = row;
        }

        const fulfillmentId = String(reqItem.fulfillment_id ?? fallbackFulfillmentId);
        selectedFulfillmentId = fulfillmentId;
        const stockAvailable = row.stock > 0 ? 99 : 0;
        const stockMaximum = row.stock;

        if (row.stock <= 0) {
          itemErrors.push('Item is currently out of stock');
        }

        lines.push({
          itemId: reqItem.id,
          itemName: row.name,
          unitPrice: row.price,
          quantity: row.stock <= 0 ? 0 : qty,
          stockAvailable,
          stockMaximum,
          taxPercent: row.gst_percent,
        });

        validatedItems.push({
          id: reqItem.id,
          fulfillment_id: fulfillmentId,
        });
        serviceCheckItems.push({ itemId: reqItem.id, productId: row.product_id });
        shippingItems.push({ productId: row.product_id, quantity: qty });
      }

      // Per-product serviceability to the buyer's delivery pincode (mirrors the
      // storefront check). Drives the fulfillment Serviceable/Non-serviceable state.
      // Fail OPEN on a DB error here: a transient query failure must not silently
      // drop the entire on_select (the outer catch has no callback-on-error path,
      // so the buyer would otherwise see nothing until TTL expiry).
      const serviceResults = await Promise.all(
        serviceCheckItems.map(async (it) => {
          try {
            const result = await checkProductServiceability(it.productId, buyerPincode);
            ondcLogger.info('Serviceability check', {
              txnId,
              itemId: it.itemId,
              productId: it.productId,
              buyerPincode,
              ...result,
            });
            return { ...it, result };
          } catch (err) {
            ondcLogger.error('Serviceability check failed — failing open (serviceable)', {
              txnId,
              itemId: it.itemId,
              productId: it.productId,
              err,
            });
            return { ...it, result: { serviceable: true, availabilityMode: 'UNKNOWN' as const } };
          }
        }),
      );
      const nonServiceable = serviceResults.filter((r) => !r.result.serviceable);
      const fulfillmentStateCode = nonServiceable.length > 0 ? 'Non-serviceable' : 'Serviceable';
      const serviceabilityErrors = nonServiceable.map(
        (r) =>
          `Item ${r.itemId} not deliverable${buyerPincode ? ` to ${buyerPincode}` : ''}` +
          ` (${r.result.reason ?? 'not serviceable'})`,
      );
      // 40002 if the only reason is stock; 30009 (location not serviceable) otherwise.
      const hasNonStockServiceFailure = nonServiceable.some(
        (r) => r.result.reason !== 'out_of_stock',
      );

      // Real Delhivery freight to the buyer's pincode (fail-open → 0 when the
      // courier is disabled/unreachable, so /on_select never blocks). Only the
      // item prices + this delivery charge appear in the quote — no tax /
      // packing / convenience-fee lines.
      const deliveryCharge =
        (await estimateDeliveryCharge({
          storeId: resolvedStoreId,
          items: shippingItems,
          buyerPincode,
          paymentType: 'Pre-paid',
        })) ?? 0;
      const quote = buildQuote(lines, selectedFulfillmentId, deliveryCharge, {
        includeZeroBreakups: true,
      });

      const store = resolvedStoreId ? await fetchStoreById(resolvedStoreId) : null;
      const storeLocations = resolvedStoreId ? await fetchStoreLocations(resolvedStoreId) : [];
      const providerLocationIds = storeLocations.map((loc) => ({ id: String(loc.id) }));
      const providerId = resolvedStoreId
        ? String(resolvedStoreId)
        : String(order.provider?.id ?? '');
      const fulfillmentTAT = buildTimeToShip(
        firstRow?.time_to_ship_value,
        firstRow?.time_to_ship_unit,
      );
      const fulfillmentCategory = deriveFulfillmentCategory(fulfillmentTAT);
      const providerName = store?.name ?? '';

      const selectOrder = {
        provider: {
          id: providerId,
          ...(providerLocationIds.length ? { locations: providerLocationIds } : {}),
        },
        items: validatedItems,
        fulfillments: (order.fulfillments ?? [{ id: selectedFulfillmentId, type: 'Delivery' }]).map(
          (f: any) => ({
            id: f?.id ?? selectedFulfillmentId,
            type: f?.type ?? 'Delivery',
            '@ondc/org/provider_name': providerName,
            tracking: false,
            '@ondc/org/category': fulfillmentCategory,
            '@ondc/org/TAT': fulfillmentTAT,
            state: { descriptor: { code: fulfillmentStateCode } },
          }),
        ),
        quote,
      };

      if (!validatedItems.length) {
        requestErrors.push('No serviceable items found in order');
      }

      const domainItemIssues = [...itemErrors, ...serviceabilityErrors];
      const outboundError: BecknError | undefined =
        requestErrors.length || domainItemIssues.length
          ? {
              type: requestErrors.length ? 'CORE-ERROR' : 'DOMAIN-ERROR',
              // 30000 request error; 30009 location not serviceable; else 40002 stock.
              code: requestErrors.length ? '30000' : hasNonStockServiceFailure ? '30009' : '40002',
              message: [...requestErrors, ...domainItemIssues].join('; '),
            }
          : undefined;

      await overallTxnsModel.patch(txnId, {
        on_select: 1,
        product_id: firstItemId || null,
        product_name: firstItemName || null,
        item_count: itemCount || null,
      });

      const payload = buildOnSelect(ctx, selectOrder, outboundError) as any;
      const { statusCode, error: cbErr } = await becknService.sendCallback(
        becknService.buildCallbackUrl(bapUri, 'on_select'),
        'on_select',
        payload,
        txnId,
      );

      await txnLogModel.insert({
        transaction_id: txnId,
        message_id: payload.context.message_id,
        action: 'on_select',
        direction: 'outbound',
        bap_id: ctx.bap_id,
        bpp_id: payload.context.bpp_id ?? null,
        domain: ctx.domain,
        http_status: statusCode ?? null,
        ack_status: outboundError ? 'NACK' : statusCode && statusCode < 300 ? 'ACK' : 'NACK',
        payload_json: JSON.stringify(payload),
        error_message: cbErr ?? outboundError?.message ?? null,
      });

      observabilityService.push('on_select', payload);
    } catch (err) {
      ondcLogger.error('select async error', { txnId, err });
    }
  });
}
