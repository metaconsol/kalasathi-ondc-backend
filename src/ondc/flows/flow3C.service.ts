/**
 * Flow 3C — Cancellation after delivery attempt failed / RTO.
 * PHP reference: generate_flow3c_on_cancel.php
 */

import { orderModel } from '~/ondc/models/order.model';
import { becknService } from '~/ondc/services/beckn.service';
import {
  buildResponseContext,
  nowIso,
  safeJsonParse,
  newMessageId,
} from '~/ondc/utils/payload.builder';
import { OndcError } from '~/ondc/utils/error.handler';
import { ondcLogger } from '~/ondc/utils/logger.util';
import {
  fetchStoreById,
  fetchStoreLocations,
  fetchSellerProfileByStoreId,
} from '~/ondc/adapters/seller.adapter';
import { bapTermsModel } from '~/ondc/models/bap_terms.model';
import { ondcEnv } from '~/config/ondc.config';
import { ondcQuery } from '~/lib/ondcSql';
import { txnLogModel } from '~/ondc/models/log.model';
import { observabilityService } from '~/ondc/services/observability.service';

export const flow3CService = {
  /** Trigger RTO-initiated cancellation and send unsolicited on_cancel to BAP */
  async cancelRto(ondcOrderId: string): Promise<void> {
    const dbOrder = await orderModel.findByOndcOrderId(ondcOrderId);
    if (!dbOrder) {
      throw OndcError.orderNotFound(ondcOrderId);
    }

    const txnId = dbOrder.transaction_id;
    const bapUri = String(dbOrder.bap_uri ?? '');
    const reasonId = '003'; // Buyer unavailable at delivery address

    // 1. Transition Order Status in DB
    await orderModel.transitionStatus(
      dbOrder.ondc_order_id,
      dbOrder.status,
      'CANCELLED',
      'Cancelled',
      'seller',
      `RTO Initiated: ${reasonId}`,
      null,
    );

    // 2. Fetch items and fulfillments from order model
    const items = await orderModel.getItems(dbOrder.ondc_order_id);
    const fulfillments = await orderModel.getFulfillments(dbOrder.ondc_order_id);
    let storeId = dbOrder.store_id;
    if (!storeId && items.length > 0) {
      const firstProductId = items[0]?.product_id;
      if (firstProductId) {
        const productRows = await ondcQuery<any>(
          `SELECT store_id FROM products WHERE id = ? LIMIT 1`,
          [firstProductId],
        );
        if (productRows[0]?.store_id) {
          storeId = productRows[0].store_id;
        }
      }
    }
    const [store, storeLocations, sellerProfile] = await Promise.all([
      storeId ? fetchStoreById(storeId) : Promise.resolve(null),
      storeId ? fetchStoreLocations(storeId) : Promise.resolve([]),
      storeId ? fetchSellerProfileByStoreId(storeId) : Promise.resolve(null),
    ]);
    const bapTerms = dbOrder.bap_id ? await bapTermsModel.findByBapId(dbOrder.bap_id) : null;

    // Parse raw confirm payload if it exists
    const rawConfirm = dbOrder.raw_confirm_payload
      ? safeJsonParse<{ message?: { order?: any } }>(dbOrder.raw_confirm_payload, {})
      : {};
    const origOrder = rawConfirm?.message?.order ?? {};

    // Parse billing
    const dbBilling = safeJsonParse<any>(dbOrder.billing_json ?? '{}', {});
    const billingAddress = dbBilling.address ?? origOrder.billing?.address ?? {};
    const billing = {
      name: dbBilling.name ?? origOrder.billing?.name ?? dbOrder.customer_name ?? 'ONDC buyer',
      address: {
        name: billingAddress.name ?? 'my house or door or floor #',
        building: billingAddress.building ?? 'my building name or house #',
        locality: billingAddress.locality ?? 'my street name',
        city: billingAddress.city ?? 'Bengaluru',
        state: billingAddress.state ?? 'Karnataka',
        country: billingAddress.country ?? 'IND',
        area_code: billingAddress.area_code ?? '560037',
      },
      email:
        dbBilling.email ??
        origOrder.billing?.email ??
        dbOrder.customer_email ??
        'nobody@nomail.com',
      phone: dbBilling.phone ?? origOrder.billing?.phone ?? dbOrder.customer_phone ?? '9886098860',
      created_at:
        dbBilling.created_at ?? origOrder.billing?.created_at ?? '2025-01-08T09:00:00.000Z',
      updated_at:
        dbBilling.updated_at ?? origOrder.billing?.updated_at ?? '2025-01-08T09:00:00.000Z',
    };

    // Provider
    const origProvider = origOrder.provider ?? {};
    const provider = {
      id: dbOrder.provider_id,
      locations: origProvider.locations ?? [{ id: 'L1' }],
    };

    // Items double entries:
    const itemsPayload = [];
    const quoteTrails = [];
    for (const item of items) {
      const itemFulfillmentId = item.fulfillment_id || 'F1';
      itemsPayload.push({
        id: item.item_id,
        fulfillment_id: itemFulfillmentId,
        quantity: { count: 0 },
      });
      itemsPayload.push({
        id: item.item_id,
        fulfillment_id: `${itemFulfillmentId}-RTO`,
        quantity: { count: item.quantity },
      });

      // Compute quote trail refund value
      const unitPrice = parseFloat(item.unit_price || '0');
      const refundValue = -1 * item.quantity * unitPrice;
      quoteTrails.push({
        code: 'quote_trail',
        list: [
          { code: 'type', value: 'item' },
          { code: 'id', value: item.item_id },
          { code: 'currency', value: item.currency || 'INR' },
          { code: 'value', value: refundValue.toFixed(2) },
        ],
      });
    }

    // Fulfillments
    const origFulfillments = origOrder.fulfillments ?? [];
    const origFulf = origFulfillments[0] ?? {};
    const firstFulfId = origFulf.id ?? fulfillments[0]?.fulfillment_id ?? 'F1';
    const rtoFulfId = `${firstFulfId}-RTO`;

    const startLoc = storeLocations[0];
    const providerName = store?.name ?? 'LSP or Provider Name';

    const deliveryFulfillment = {
      id: firstFulfId,
      '@ondc/org/provider_name': origFulf['@ondc/org/provider_name'] ?? providerName,
      type: origFulf.type ?? 'Delivery',
      tracking: false,
      '@ondc/org/TAT': origFulf['@ondc/org/TAT'] ?? 'PT60M',
      state: {
        descriptor: {
          code: 'Cancelled',
        },
      },
      start: {
        location: {
          id: origFulf.start?.location?.id ?? String(startLoc?.id ?? 'L1'),
          descriptor: {
            name: origFulf.start?.location?.descriptor?.name ?? providerName,
          },
          gps:
            origFulf.start?.location?.gps ??
            (startLoc?.latitude != null && startLoc?.longitude != null
              ? `${startLoc.latitude},${startLoc.longitude}`
              : '12.9563,77.6368'),
          address: {
            locality:
              origFulf.start?.location?.address?.locality ??
              startLoc?.address_line2 ??
              startLoc?.address_line1 ??
              'Jayanagar',
            city: origFulf.start?.location?.address?.city ?? startLoc?.city ?? 'Bengaluru',
            area_code:
              origFulf.start?.location?.address?.area_code ?? startLoc?.pincode ?? '560076',
            state: origFulf.start?.location?.address?.state ?? startLoc?.state ?? 'KA',
          },
        },
        contact: {
          phone: origFulf.start?.contact?.phone ?? store?.phone ?? '9886098860',
          email: origFulf.start?.contact?.email ?? store?.email ?? 'nobody@nomail.com',
        },
      },
      end: {
        location: {
          gps: origFulf.end?.location?.gps ?? '12.4535,77.9283',
          address: {
            name: origFulf.end?.location?.address?.name ?? billing.address.name,
            building: origFulf.end?.location?.address?.building ?? billing.address.building,
            locality: origFulf.end?.location?.address?.locality ?? billing.address.locality,
            city: origFulf.end?.location?.address?.city ?? billing.address.city,
            state: origFulf.end?.location?.address?.state ?? billing.address.state,
            country: origFulf.end?.location?.address?.country ?? billing.address.country,
            area_code: origFulf.end?.location?.address?.area_code ?? billing.address.area_code,
          },
        },
        person: {
          name: origFulf.end?.person?.name ?? billing.name,
        },
        contact: {
          phone: origFulf.end?.contact?.phone ?? billing.phone,
          email: origFulf.end?.contact?.email ?? billing.email,
        },
      },
      tags: [
        {
          code: 'cancel_request',
          list: [
            { code: 'retry_count', value: '1' },
            { code: 'rto_id', value: rtoFulfId },
            { code: 'reason_id', value: reasonId },
            { code: 'initiated_by', value: dbOrder.bpp_id || ondcEnv.subscriberId },
          ],
        },
        {
          code: 'igm_request',
          list: [{ code: 'id', value: 'Issue1' }],
        },
        {
          code: 'precancel_state',
          list: [
            { code: 'fulfillment_state', value: 'Order-picked-up' },
            {
              code: 'updated_at',
              value: dbOrder.updated_at
                ? dbOrder.updated_at.toISOString().replace(/\.\d{3}Z$/, '.000Z')
                : nowIso(),
            },
          ],
        },
      ],
    };

    const rtoFulfillment = {
      id: rtoFulfId,
      type: 'RTO',
      state: {
        descriptor: {
          code: 'RTO-Initiated',
        },
      },
      start: {
        time: {
          timestamp: dbOrder.updated_at
            ? dbOrder.updated_at.toISOString().replace(/\.\d{3}Z$/, '.000Z')
            : nowIso(),
        },
        location: {
          gps: origFulf.end?.location?.gps ?? '12.4535,77.9283',
          address: {
            name: origFulf.end?.location?.address?.name ?? billing.address.name,
            building: origFulf.end?.location?.address?.building ?? billing.address.building,
            locality: origFulf.end?.location?.address?.locality ?? billing.address.locality,
            city: origFulf.end?.location?.address?.city ?? billing.address.city,
            state: origFulf.end?.location?.address?.state ?? billing.address.state,
            country: origFulf.end?.location?.address?.country ?? billing.address.country,
            area_code: origFulf.end?.location?.address?.area_code ?? billing.address.area_code,
          },
        },
      },
      end: {
        time: {
          timestamp: dbOrder.updated_at
            ? dbOrder.updated_at.toISOString().replace(/\.\d{3}Z$/, '.000Z')
            : nowIso(),
        },
        location: {
          id: String(startLoc?.id ?? 'L1'),
          descriptor: {
            name: providerName,
          },
          gps:
            startLoc?.latitude != null && startLoc?.longitude != null
              ? `${startLoc.latitude},${startLoc.longitude}`
              : '12.9563,77.6368',
          address: {
            locality: startLoc?.address_line2 ?? startLoc?.address_line1 ?? 'Jayanagar',
            city: startLoc?.city ?? 'Bengaluru',
            area_code: startLoc?.pincode ?? '560076',
            state: startLoc?.state ?? 'KA',
          },
        },
      },
      tags: [
        {
          code: 'quote_trail',
          list: [
            { code: 'type', value: 'delivery' },
            { code: 'id', value: rtoFulfId },
            { code: 'currency', value: 'INR' },
            {
              code: 'value',
              value: (parseFloat(dbOrder.delivery_charges || '0') || 0.0).toFixed(2),
            },
          ],
        },
        {
          code: 'quote_trail',
          list: [
            { code: 'type', value: 'tax' },
            { code: 'id', value: rtoFulfId },
            { code: 'currency', value: 'INR' },
            { code: 'value', value: '0.00' }, // Default tax RTO
          ],
        },
        ...quoteTrails,
      ],
    };

    const responseFulfillments = [deliveryFulfillment, rtoFulfillment];

    // Quote breakup
    const origBreakup = origOrder.quote?.breakup ?? [];
    const updatedBreakup: any[] = [];

    // 1. Add/Map Item entries
    for (const item of items) {
      const origItemEntry = origBreakup.find(
        (b: any) => b['@ondc/org/item_id'] === item.item_id && b['@ondc/org/title_type'] === 'item',
      );

      let itemTitle = origItemEntry?.title;
      if (!itemTitle) {
        if (item.product_id) {
          const prodRows = await ondcQuery<any>(
            `SELECT product_name FROM products WHERE id = ? LIMIT 1`,
            [item.product_id],
          );
          if (prodRows[0]?.product_name) {
            itemTitle = prodRows[0].product_name;
            if (item.variant_id) {
              const varRows = await ondcQuery<any>(
                `SELECT variant_name FROM product_variants WHERE id = ? LIMIT 1`,
                [item.variant_id],
              );
              if (varRows[0]?.variant_name) {
                itemTitle += ` - ${varRows[0].variant_name}`;
              }
            }
          }
        }
      }
      if (!itemTitle && item.raw_item_json) {
        try {
          const rawItem = JSON.parse(item.raw_item_json);
          itemTitle = rawItem?.descriptor?.name;
        } catch (e) {
          // ignore parse error
        }
      }

      if (!itemTitle) {
        itemTitle = item.item_id; // Fallback to item_id if absolutely no title is found in DB
      }

      updatedBreakup.push({
        '@ondc/org/item_id': item.item_id,
        '@ondc/org/item_quantity': { count: 0 },
        title: itemTitle,
        '@ondc/org/title_type': 'item',
        price: {
          currency: origItemEntry?.price?.currency ?? 'INR',
          value: '0.00',
        },
        item: {
          price: {
            currency: origItemEntry?.price?.currency ?? 'INR',
            value: origItemEntry?.item?.price?.value ?? item.unit_price ?? '170.00',
          },
        },
      });
    }

    // 2. Add Delivery Charges (F1)
    const origDeliveryEntry = origBreakup.find(
      (b: any) =>
        b['@ondc/org/title_type'] === 'delivery' && b['@ondc/org/item_id'] === firstFulfId,
    );
    const deliveryVal =
      origDeliveryEntry?.price?.value ??
      (dbOrder.delivery_charges && parseFloat(dbOrder.delivery_charges) > 0
        ? dbOrder.delivery_charges
        : '0.00');
    updatedBreakup.push({
      '@ondc/org/item_id': firstFulfId,
      title: origDeliveryEntry?.title ?? 'Delivery charges',
      '@ondc/org/title_type': 'delivery',
      price: {
        currency: origDeliveryEntry?.price?.currency ?? 'INR',
        value: parseFloat(deliveryVal).toFixed(2),
      },
    });

    // 3. Add Tax (F1)
    const origFulfTaxEntry = origBreakup.find(
      (b: any) => b['@ondc/org/title_type'] === 'tax' && b['@ondc/org/item_id'] === firstFulfId,
    );
    const fulfTaxVal = origFulfTaxEntry?.price?.value ?? '0.00';
    updatedBreakup.push({
      '@ondc/org/item_id': firstFulfId,
      title: origFulfTaxEntry?.title ?? 'Tax',
      '@ondc/org/title_type': 'tax',
      price: {
        currency: origFulfTaxEntry?.price?.currency ?? 'INR',
        value: parseFloat(fulfTaxVal).toFixed(2),
      },
      item: {
        tags: [
          {
            code: 'quote',
            list: [
              {
                code: 'type',
                value: 'fulfillment',
              },
            ],
          },
        ],
      },
    });

    // 4. Add Delivery Charges (F1-RTO)
    updatedBreakup.push({
      '@ondc/org/item_id': rtoFulfId,
      title: 'Delivery charges',
      '@ondc/org/title_type': 'delivery',
      price: {
        currency: 'INR',
        value: parseFloat(deliveryVal).toFixed(2),
      },
    });

    // 5. Add Tax (F1-RTO)
    updatedBreakup.push({
      '@ondc/org/item_id': rtoFulfId,
      title: 'Tax',
      '@ondc/org/title_type': 'tax',
      price: {
        currency: 'INR',
        value: parseFloat(fulfTaxVal).toFixed(2),
      },
      item: {
        tags: [
          {
            code: 'quote',
            list: [
              {
                code: 'type',
                value: 'fulfillment',
              },
            ],
          },
        ],
      },
    });

    // 6. Add Packing Charges
    const origPackingEntry = origBreakup.find((b: any) => b['@ondc/org/title_type'] === 'packing');
    const packingVal =
      origPackingEntry?.price?.value ??
      (dbOrder.packing_charges && parseFloat(dbOrder.packing_charges) > 0
        ? dbOrder.packing_charges
        : '0.00');
    updatedBreakup.push({
      '@ondc/org/item_id': firstFulfId,
      title: origPackingEntry?.title ?? 'Packing charges',
      '@ondc/org/title_type': 'packing',
      price: {
        currency: origPackingEntry?.price?.currency ?? 'INR',
        value: parseFloat(packingVal).toFixed(2),
      },
    });

    // 7. Add Tax (Item)
    for (const item of items) {
      const origItemTaxEntry = origBreakup.find(
        (b: any) => b['@ondc/org/title_type'] === 'tax' && b['@ondc/org/item_id'] === item.item_id,
      );
      const itemTaxVal = origItemTaxEntry?.price?.value ?? '0.00';
      updatedBreakup.push({
        '@ondc/org/item_id': item.item_id,
        title: origItemTaxEntry?.title ?? 'Tax',
        '@ondc/org/title_type': 'tax',
        price: {
          currency: origItemTaxEntry?.price?.currency ?? 'INR',
          value: parseFloat(itemTaxVal).toFixed(2),
        },
      });
    }

    // Sum breakup values for quote price total
    const breakupSum = updatedBreakup.reduce((sum: number, entry: any) => {
      return sum + parseFloat(entry.price?.value ?? '0');
    }, 0);

    const quote = {
      price: {
        currency: origOrder.quote?.price?.currency ?? 'INR',
        value: breakupSum.toFixed(2),
      },
      breakup: updatedBreakup,
      ttl: origOrder.quote?.ttl ?? 'P1D',
    };

    // Payment
    const dbPayment = safeJsonParse<any>(dbOrder.payment_json ?? '{}', {});
    const origPayment = origOrder.payment ?? dbPayment ?? {};

    const payment = {
      uri: origPayment.uri ?? 'https://ondc.transaction.com/payment',
      tl_method: origPayment.tl_method ?? 'http/get',
      params: {
        currency: origPayment.params?.currency ?? 'INR',
        transaction_id:
          origPayment.params?.transaction_id ?? dbOrder.payment_transaction_ref ?? '3937',
        amount: origPayment.params?.amount ?? dbOrder.order_total ?? '0.00',
      },
      status: origPayment.status ?? 'PAID',
      type: origPayment.type ?? 'ON-ORDER',
      collected_by: origPayment.collected_by ?? 'BAP',
      '@ondc/org/buyer_app_finder_fee_type':
        origPayment['@ondc/org/buyer_app_finder_fee_type'] ??
        dbPayment['@ondc/org/buyer_app_finder_fee_type'] ??
        'percent',
      '@ondc/org/buyer_app_finder_fee_amount':
        origPayment['@ondc/org/buyer_app_finder_fee_amount'] ??
        dbPayment['@ondc/org/buyer_app_finder_fee_amount'] ??
        bapTerms?.bff_percent ??
        String(ondcEnv.buyerFinderFeeDefault),
      '@ondc/org/settlement_details': origPayment['@ondc/org/settlement_details'] ??
        dbPayment['@ondc/org/settlement_details'] ?? [
          {
            settlement_counterparty: 'seller-app',
            settlement_phase: 'sale-amount',
            settlement_type: 'neft',
            beneficiary_name: String(sellerProfile?.business_name ?? store?.name ?? 'ODOP Mart'),
            upi_address: String(sellerProfile?.upi_id ?? ''),
            settlement_bank_account_no: String(sellerProfile?.bank_account_no ?? ''),
            settlement_ifsc_code: String(sellerProfile?.bank_ifsc ?? ''),
            bank_name: String(sellerProfile?.bank_name ?? ''),
            branch_name: String(sellerProfile?.branch_name ?? ''),
          },
        ],
    };

    const cancelledOrder = {
      id: dbOrder.ondc_order_id,
      state: 'Cancelled',
      provider,
      items: itemsPayload,
      billing,
      fulfillments: responseFulfillments,
      quote,
      payment,
      created_at: dbOrder.created_at
        ? dbOrder.created_at.toISOString().replace(/\.\d{3}Z$/, '.000Z')
        : nowIso(),
      updated_at: nowIso(),
    };

    // Unsolicited callback setup
    const ctx = {
      domain: dbOrder.domain,
      country: dbOrder.country || 'IND',
      city: dbOrder.city || 'std:080',
      action: 'on_cancel' as const,
      core_version: '1.2.5',
      bap_id: dbOrder.bap_id,
      bap_uri: dbOrder.bap_uri,
      bpp_id: dbOrder.bpp_id || ondcEnv.subscriberId,
      bpp_uri: ondcEnv.baseUri,
      transaction_id: dbOrder.transaction_id,
      message_id: newMessageId(),
      timestamp: nowIso(),
      ttl: 'PT30S',
    };

    const callbackPayload = {
      context: buildResponseContext(ctx, 'on_cancel'),
      message: { order: cancelledOrder },
    };

    const callbackUrl = becknService.buildCallbackUrl(bapUri, 'on_cancel');
    const { statusCode, error: cbErr } = await becknService.sendCallback(
      callbackUrl,
      'on_cancel',
      callbackPayload as any,
      txnId,
    );

    // Save outbound transaction log
    await txnLogModel.insert({
      transaction_id: txnId,
      message_id: callbackPayload.context.message_id,
      action: 'on_cancel',
      direction: 'outbound',
      bap_id: ctx.bap_id,
      bpp_id: callbackPayload.context.bpp_id ?? null,
      domain: ctx.domain,
      http_status: statusCode ?? null,
      ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
      payload_json: JSON.stringify(callbackPayload),
      error_message: cbErr ?? null,
    });

    observabilityService.push('on_cancel', callbackPayload);
    ondcLogger.info('Flow3C: RTO unsolicited on_cancel callback sent', { ondcOrderId });

    try {
      const { writeFileSync, existsSync, mkdirSync } = await import('fs');
      const { join } = await import('path');
      const logDir = join(process.cwd(), 'logs', 'ondc');
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }
      writeFileSync(join(logDir, 'RTOcancell.log'), JSON.stringify(callbackPayload, null, 2));
    } catch (e) {
      ondcLogger.error('Failed to write RTOcancell.log', { error: e });
    }
  },
};
