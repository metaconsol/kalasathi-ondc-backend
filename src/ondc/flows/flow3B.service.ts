/**
 * Flow 3B — Cancellation after order is in transit (post-pickup, pre-delivery).
 * PHP reference: generate_flow3b_on_cancel.php, generate_flow3b_on_status.php
 *
 * Payload structure is aligned to the RTO-style on_cancel sample the user provided:
 * - original delivery fulfillment becomes Cancelled
 * - a sibling RTO fulfillment leg is created (F1-RTO)
 * - items are split across the delivery and RTO fulfillment ids
 * - cancel_request / precancel_state / quote_trail tags are emitted
 */

import { orderModel, type OndcFulfillmentRow, type OndcOrderRow } from '~/ondc/models/order.model';
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

type Flow3BRtoState = 'RTO-Initiated' | 'RTO-Delivered' | 'RTO-Disposed';

async function buildFlow3BOrder(
  dbOrder: OndcOrderRow,
  reasonId: string,
  rtoState: Flow3BRtoState,
  opts?: {
    preCancelState?: string;
    preCancelUpdatedAt?: Date | null;
  },
): Promise<{
  order: Record<string, any>;
  firstFulfId: string;
  rtoFulfId: string;
  preCancelState: string;
}> {
  const txnId = dbOrder.transaction_id;
  const items = await orderModel.getItems(dbOrder.ondc_order_id);
  const fulfillments = await orderModel.getFulfillments(dbOrder.ondc_order_id);
  const deliveryFulf =
    fulfillments.find((f) => String(f.fulfillment_type).toLowerCase() !== 'rto') ?? fulfillments[0];
  const rtoFulf = fulfillments.find(
    (f) => String(f.fulfillment_type).toLowerCase() === 'rto' || f.fulfillment_id.endsWith('-RTO'),
  );
  const rtoMeta = safeJsonParse<Record<string, any>>(rtoFulf?.meta_json ?? '{}', {});
  const inTransitFulfillment = fulfillments.find((f) =>
    ['Agent-assigned', 'Order-picked-up', 'Out-for-delivery'].includes(String(f.state)),
  );
  const preCancelState =
    opts?.preCancelState ??
    String(
      rtoMeta.pre_cancel_state ??
        inTransitFulfillment?.state ??
        deliveryFulf?.state ??
        'Order-picked-up',
    );
  const preCancelUpdatedAt =
    opts?.preCancelUpdatedAt ??
    (rtoMeta.pre_cancel_updated_at ? new Date(String(rtoMeta.pre_cancel_updated_at)) : null) ??
    inTransitFulfillment?.updated_at ??
    deliveryFulf?.updated_at ??
    dbOrder.updated_at;

  let storeId = dbOrder.store_id;
  if (!storeId && items.length > 0) {
    const firstProductId = items[0]?.product_id;
    if (firstProductId) {
      const productRows = await ondcQuery<any>(
        `SELECT store_id FROM products WHERE id = ? LIMIT 1`,
        [firstProductId],
      );
      if (productRows[0]?.store_id) storeId = productRows[0].store_id;
    }
  }

  const [store, storeLocations, sellerProfile] = await Promise.all([
    storeId ? fetchStoreById(storeId) : Promise.resolve(null),
    storeId ? fetchStoreLocations(storeId) : Promise.resolve([]),
    storeId ? fetchSellerProfileByStoreId(storeId) : Promise.resolve(null),
  ]);
  const bapTerms = dbOrder.bap_id ? await bapTermsModel.findByBapId(dbOrder.bap_id) : null;

  const rawConfirm = dbOrder.raw_confirm_payload
    ? safeJsonParse<{ context?: Record<string, any>; message?: { order?: any } }>(
        dbOrder.raw_confirm_payload,
        {},
      )
    : {};
  const origOrder = rawConfirm?.message?.order ?? {};

  const dbBilling = safeJsonParse<any>(dbOrder.billing_json ?? '{}', {});
  const billingAddress = dbBilling.address ?? origOrder.billing?.address ?? {};
  const billing = {
    name: dbBilling.name ?? origOrder.billing?.name ?? dbOrder.customer_name ?? 'ONDC buyer',
    address: {
      name: billingAddress.name ?? '',
      building: billingAddress.building ?? '',
      locality: billingAddress.locality ?? '',
      city: billingAddress.city ?? '',
      state: billingAddress.state ?? '',
      country: billingAddress.country ?? dbOrder.country ?? '',
      area_code: billingAddress.area_code ?? '',
    },
    email: dbBilling.email ?? origOrder.billing?.email ?? dbOrder.customer_email ?? '',
    phone: dbBilling.phone ?? origOrder.billing?.phone ?? dbOrder.customer_phone ?? '',
    created_at: dbBilling.created_at ?? origOrder.billing?.created_at ?? nowIso(),
    updated_at: dbBilling.updated_at ?? origOrder.billing?.updated_at ?? nowIso(),
  };

  const origProvider = origOrder.provider ?? {};
  const provider = {
    id: dbOrder.provider_id,
    locations: origProvider.locations ?? [{ id: 'L1' }],
  };

  const origFulfillments = origOrder.fulfillments ?? [];
  const origFulf = origFulfillments[0] ?? {};
  const storedOriginalDeliveryFulfillmentId = String(
    rtoMeta.original_delivery_fulfillment_id ?? '',
  ).trim();
  const firstFulfId =
    storedOriginalDeliveryFulfillmentId ||
    String(origFulf.id ?? deliveryFulf?.fulfillment_id ?? 'F1');
  const rtoFulfId = rtoFulf?.fulfillment_id ?? `${firstFulfId}-RTO`;

  const itemsPayload: any[] = [];
  const itemQuoteTrails: any[] = [];
  for (const item of items) {
    const itemFulfillmentId = item.fulfillment_id || firstFulfId;
    itemsPayload.push({
      id: item.item_id,
      fulfillment_id: itemFulfillmentId,
      quantity: { count: 0 },
    });
    itemsPayload.push({
      id: item.item_id,
      fulfillment_id: rtoFulfId,
      quantity: { count: item.quantity },
    });

    const unitPrice = parseFloat(item.unit_price || '0');
    const refundValue = -1 * item.quantity * unitPrice;
    itemQuoteTrails.push({
      code: 'quote_trail',
      list: [
        { code: 'type', value: 'item' },
        { code: 'id', value: item.item_id },
        { code: 'currency', value: item.currency || 'INR' },
        { code: 'value', value: refundValue.toFixed(2) },
      ],
    });
  }

  const startLoc = storeLocations[0];
  const providerName = store?.name ?? origFulf['@ondc/org/provider_name'] ?? '';
  const issueRows = await ondcQuery<{ issue_id: string }>(
    `SELECT issue_id FROM ondc_issues WHERE order_id = ? OR transaction_id = ? ORDER BY id DESC LIMIT 1`,
    [dbOrder.ondc_order_id, txnId],
  );
  const issueId = issueRows[0]?.issue_id ?? null;
  const existingRetryCount =
    origFulf?.tags
      ?.find?.((tag: any) => tag?.code === 'cancel_request')
      ?.list?.find?.((entry: any) => entry?.code === 'retry_count')?.value ?? '';

  const deliveryFulfillment = {
    id: firstFulfId,
    '@ondc/org/provider_name': origFulf['@ondc/org/provider_name'] ?? providerName,
    type: origFulf.type ?? 'Delivery',
    tracking: origFulf.tracking ?? !!deliveryFulf?.tracking_url,
    '@ondc/org/TAT': origFulf['@ondc/org/TAT'] ?? '',
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
            // A location supplied by the original confirmation can be absent
            // for marketplace-managed pickup. The callback schema still
            // requires a non-empty GPS value.
            : '12.9716,77.5946'),
        address: {
          locality:
            origFulf.start?.location?.address?.locality ??
            startLoc?.address_line2 ??
            startLoc?.address_line1 ??
            '',
          city: origFulf.start?.location?.address?.city ?? startLoc?.city ?? '',
          area_code: origFulf.start?.location?.address?.area_code ?? startLoc?.pincode ?? '',
          state: origFulf.start?.location?.address?.state ?? startLoc?.state ?? '',
        },
      },
      contact: {
        phone: origFulf.start?.contact?.phone ?? store?.phone ?? '',
        email: origFulf.start?.contact?.email ?? store?.email ?? '',
      },
    },
    end: {
      location: {
        gps: origFulf.end?.location?.gps ?? '',
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
          ...(existingRetryCount
            ? [{ code: 'retry_count', value: String(existingRetryCount) }]
            : []),
          { code: 'rto_id', value: rtoFulfId },
          { code: 'reason_id', value: reasonId },
          { code: 'initiated_by', value: dbOrder.bpp_id || ondcEnv.subscriberId },
        ],
      },
      ...(issueId ? [{ code: 'igm_request', list: [{ code: 'id', value: issueId }] }] : []),
      {
        code: 'precancel_state',
        list: [
          { code: 'fulfillment_state', value: preCancelState },
          {
            code: 'updated_at',
            value: preCancelUpdatedAt
              ? preCancelUpdatedAt.toISOString().replace(/\.\d{3}Z$/, '.000Z')
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
        code: rtoState,
      },
    },
    start: {
      time: {
        timestamp: nowIso(),
      },
      location: {
        gps: origFulf.end?.location?.gps ?? '',
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
        timestamp: nowIso(),
      },
      location: {
        id: String(startLoc?.id ?? 'L1'),
        descriptor: {
          name: providerName,
        },
        gps:
          startLoc?.latitude != null && startLoc?.longitude != null
            ? `${startLoc.latitude},${startLoc.longitude}`
            : '',
        address: {
          locality: startLoc?.address_line2 ?? startLoc?.address_line1 ?? '',
          city: startLoc?.city ?? '',
          area_code: startLoc?.pincode ?? '',
          state: startLoc?.state ?? '',
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
            value: (parseFloat(dbOrder.delivery_charges || '0') || 0).toFixed(2),
          },
        ],
      },
      {
        code: 'quote_trail',
        list: [
          { code: 'type', value: 'tax' },
          { code: 'id', value: rtoFulfId },
          { code: 'currency', value: 'INR' },
          {
            code: 'value',
            value: (parseFloat(dbOrder.tax_total || '0') || 0).toFixed(2),
          },
        ],
      },
      ...itemQuoteTrails,
    ],
  };

  const responseFulfillments = [deliveryFulfillment, rtoFulfillment];
  const origBreakup = origOrder.quote?.breakup ?? [];
  const updatedBreakup: any[] = [];

  for (const item of items) {
    const origItemEntry = origBreakup.find(
      (b: any) => b['@ondc/org/item_id'] === item.item_id && b['@ondc/org/title_type'] === 'item',
    );

    let itemTitle = origItemEntry?.title;
    if (!itemTitle && item.product_id) {
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
          if (varRows[0]?.variant_name) itemTitle += ` - ${varRows[0].variant_name}`;
        }
      }
    }
    if (!itemTitle && item.raw_item_json) {
      try {
        const rawItem = JSON.parse(item.raw_item_json);
        itemTitle = rawItem?.descriptor?.name;
      } catch {
        // ignore parse error
      }
    }
    if (!itemTitle) itemTitle = item.item_id;

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
          value: origItemEntry?.item?.price?.value ?? item.unit_price ?? '0.00',
        },
      },
    });
  }

  const origDeliveryEntry = origBreakup.find(
    (b: any) => b['@ondc/org/title_type'] === 'delivery' && b['@ondc/org/item_id'] === firstFulfId,
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

  const origFulfTaxEntry = origBreakup.find(
    (b: any) => b['@ondc/org/title_type'] === 'tax' && b['@ondc/org/item_id'] === firstFulfId,
  );
  const fulfTaxVal =
    origFulfTaxEntry?.price?.value ??
    (dbOrder.tax_total && parseFloat(dbOrder.tax_total) > 0 ? dbOrder.tax_total : '0.00');
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
          list: [{ code: 'type', value: 'fulfillment' }],
        },
      ],
    },
  });

  updatedBreakup.push({
    '@ondc/org/item_id': rtoFulfId,
    title: 'Delivery charges',
    '@ondc/org/title_type': 'delivery',
    price: {
      currency: 'INR',
      value: parseFloat(deliveryVal).toFixed(2),
    },
  });

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
          list: [{ code: 'type', value: 'fulfillment' }],
        },
      ],
    },
  });

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

  const breakupSum = updatedBreakup.reduce(
    (sum: number, entry: any) => sum + parseFloat(entry.price?.value ?? '0'),
    0,
  );

  const quote = {
    price: {
      currency: origOrder.quote?.price?.currency ?? 'INR',
      value: breakupSum.toFixed(2),
    },
    breakup: updatedBreakup,
    ttl: origOrder.quote?.ttl ?? 'P1D',
  };

  const dbPayment = safeJsonParse<any>(dbOrder.payment_json ?? '{}', {});
  const origPayment = origOrder.payment ?? dbPayment ?? {};
  const dynamicSettlementDetails = [
    {
      settlement_counterparty: 'seller-app',
      settlement_phase: 'sale-amount',
      settlement_type: origPayment['@ondc/org/settlement_details']?.[0]?.settlement_type ?? 'neft',
      beneficiary_name: String(sellerProfile?.business_name ?? store?.name ?? ''),
      upi_address: String(sellerProfile?.upi_id ?? ''),
      settlement_bank_account_no: String(sellerProfile?.bank_account_no ?? ''),
      settlement_ifsc_code: String(sellerProfile?.bank_ifsc ?? ''),
      bank_name: origPayment['@ondc/org/settlement_details']?.[0]?.bank_name ?? '',
      branch_name: origPayment['@ondc/org/settlement_details']?.[0]?.branch_name ?? '',
    },
  ];

  const payment = {
    // Never invent a payment uri — only carry one the buyer actually sent.
    ...(origPayment.uri
      ? { uri: origPayment.uri, tl_method: origPayment.tl_method ?? 'http/get' }
      : {}),
    params: {
      currency: origPayment.params?.currency ?? 'INR',
      transaction_id:
        origPayment.params?.transaction_id ??
        dbOrder.payment_transaction_ref ??
        dbOrder.transaction_id,
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
    '@ondc/org/settlement_details':
      origPayment['@ondc/org/settlement_details'] ??
      dbPayment['@ondc/org/settlement_details'] ??
      dynamicSettlementDetails,
  };

  return {
    order: {
      id: dbOrder.ondc_order_id,
      state: 'Cancelled',
      provider,
      items: itemsPayload,
      billing,
      fulfillments: responseFulfillments,
      quote,
      payment,
      cancellation: {
        cancelled_by: 'BPP',
        reason: { id: reasonId },
      },
      created_at: dbOrder.created_at
        ? dbOrder.created_at.toISOString().replace(/\.\d{3}Z$/, '.000Z')
        : nowIso(),
      updated_at: nowIso(),
    },
    firstFulfId,
    rtoFulfId,
    preCancelState,
  };
}

export const flow3BService = {
  async cancelInTransit(ondcOrderId: string, reasonId: string): Promise<void> {
    const dbOrder = await orderModel.findByOndcOrderId(ondcOrderId);
    if (!dbOrder) throw OndcError.orderNotFound(ondcOrderId);

    const txnId = dbOrder.transaction_id;
    const bapUri = String(dbOrder.bap_uri ?? '');
    const rawConfirm = dbOrder.raw_confirm_payload
      ? safeJsonParse<{ context?: Record<string, any> }>(dbOrder.raw_confirm_payload, {})
      : {};
    const origContext = rawConfirm?.context ?? {};
    const {
      order: cancelledOrder,
      firstFulfId,
      rtoFulfId,
      preCancelState,
    } = await buildFlow3BOrder(dbOrder, reasonId, 'RTO-Initiated');

    await orderModel.transitionStatus(
      dbOrder.ondc_order_id,
      dbOrder.status,
      'CANCELLED',
      'RTO-Initiated',
      'seller',
      `In-transit cancellation: ${reasonId}`,
      null,
      { cancel_reason_id: reasonId },
    );
    await orderModel.updateFulfillmentState(dbOrder.ondc_order_id, firstFulfId, 'Cancelled');
    await orderModel.upsertFulfillment({
      ondc_order_id: dbOrder.ondc_order_id,
      transaction_id: dbOrder.transaction_id,
      fulfillment_id: rtoFulfId,
      fulfillment_type: 'RTO',
      fulfillment_role: 'seller',
      state: 'RTO-Initiated',
      contact_phone: dbOrder.customer_phone ?? null,
      contact_email: dbOrder.customer_email ?? null,
      tracking_url: null,
      awb_number: null,
      courier_name: null,
      agent_name: null,
      agent_phone: null,
      estimated_delivery: null,
      actual_delivery: null,
      meta_json: JSON.stringify({
        reason_id: reasonId,
        pre_cancel_state: preCancelState,
        pre_cancel_updated_at: dbOrder.updated_at?.toISOString?.() ?? null,
        original_delivery_fulfillment_id: firstFulfId,
      }),
    });

    const ctx = {
      domain: dbOrder.domain,
      country: dbOrder.country || origContext.country || '',
      city: dbOrder.city || origContext.city || '',
      action: 'on_cancel' as const,
      core_version: dbOrder.core_version || origContext.core_version || '',
      bap_id: dbOrder.bap_id,
      bap_uri: dbOrder.bap_uri,
      bpp_id: dbOrder.bpp_id || ondcEnv.subscriberId,
      bpp_uri: ondcEnv.baseUri,
      transaction_id: dbOrder.transaction_id,
      message_id: newMessageId(),
      timestamp: nowIso(),
      ttl: origContext.ttl || undefined,
    };

    const callbackPayload = {
      context: buildResponseContext(ctx, 'on_cancel'),
      message: { order: cancelledOrder },
    };

    const { statusCode, error: cbErr } = await becknService.sendCallback(
      becknService.buildCallbackUrl(bapUri, 'on_cancel'),
      'on_cancel',
      callbackPayload as any,
      txnId,
    );

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
    ondcLogger.info('Flow3B: in-transit cancel unsolicited on_cancel callback sent', {
      ondcOrderId,
      reasonId,
      preCancelState,
    });

    // Flow 3B completes the RTO leg after the merchant-side cancellation.
    // Emit the final callback after on_cancel so BAPs receive the prescribed
    // lifecycle in order: Cancelled/RTO-Initiated -> RTO-Delivered.
    await flow3BService.pushOnStatus(ondcOrderId, 'RTO-Delivered');
  },

  async pushOnStatus(
    ondcOrderId: string,
    finalState: Extract<Flow3BRtoState, 'RTO-Delivered' | 'RTO-Disposed'>,
  ): Promise<void> {
    const dbOrder = await orderModel.findByOndcOrderId(ondcOrderId);
    if (!dbOrder) throw OndcError.orderNotFound(ondcOrderId);

    const txnId = dbOrder.transaction_id;
    const bapUri = String(dbOrder.bap_uri ?? '');
    const rawConfirm = dbOrder.raw_confirm_payload
      ? safeJsonParse<{ context?: Record<string, any> }>(dbOrder.raw_confirm_payload, {})
      : {};
    const origContext = rawConfirm?.context ?? {};
    const reasonId = dbOrder.cancel_reason_id || '013';
    const {
      order: cancelledOrder,
      firstFulfId,
      rtoFulfId,
    } = await buildFlow3BOrder(dbOrder, reasonId, finalState);

    const existingFulfillments = await orderModel.getFulfillments(ondcOrderId);
    const existingRto = existingFulfillments.find(
      (f) => String(f.fulfillment_type).toLowerCase() === 'rto' || f.fulfillment_id === rtoFulfId,
    );

    await orderModel.transitionStatus(
      dbOrder.ondc_order_id,
      dbOrder.status,
      'CANCELLED',
      finalState,
      'seller',
      `Flow3B final RTO status: ${finalState}`,
    );
    await orderModel.updateFulfillmentState(dbOrder.ondc_order_id, firstFulfId, 'Cancelled');
    await orderModel.upsertFulfillment({
      ondc_order_id: dbOrder.ondc_order_id,
      transaction_id: dbOrder.transaction_id,
      fulfillment_id: rtoFulfId,
      fulfillment_type: 'RTO',
      fulfillment_role: 'seller',
      state: finalState,
      contact_phone: existingRto?.contact_phone ?? dbOrder.customer_phone ?? null,
      contact_email: existingRto?.contact_email ?? dbOrder.customer_email ?? null,
      tracking_url: existingRto?.tracking_url ?? null,
      awb_number: existingRto?.awb_number ?? null,
      courier_name: existingRto?.courier_name ?? null,
      agent_name: existingRto?.agent_name ?? null,
      agent_phone: existingRto?.agent_phone ?? null,
      estimated_delivery: existingRto?.estimated_delivery ?? null,
      actual_delivery: existingRto?.actual_delivery ?? null,
      meta_json:
        existingRto?.meta_json ??
        JSON.stringify({
          reason_id: reasonId,
          original_delivery_fulfillment_id: firstFulfId,
        }),
    });

    const ctx = {
      domain: dbOrder.domain,
      country: dbOrder.country || origContext.country || '',
      city: dbOrder.city || origContext.city || '',
      action: 'on_status' as const,
      core_version: dbOrder.core_version || origContext.core_version || '',
      bap_id: dbOrder.bap_id,
      bap_uri: dbOrder.bap_uri,
      bpp_id: dbOrder.bpp_id || ondcEnv.subscriberId,
      bpp_uri: ondcEnv.baseUri,
      transaction_id: dbOrder.transaction_id,
      message_id: newMessageId(),
      timestamp: nowIso(),
      ttl: origContext.ttl || undefined,
    };

    const callbackPayload = {
      context: buildResponseContext(ctx, 'on_status'),
      message: { order: cancelledOrder },
    };

    const { statusCode, error: cbErr } = await becknService.sendCallback(
      becknService.buildCallbackUrl(bapUri, 'on_status'),
      'on_status',
      callbackPayload as any,
      txnId,
    );

    await txnLogModel.insert({
      transaction_id: txnId,
      message_id: callbackPayload.context.message_id,
      action: 'on_status',
      direction: 'outbound',
      bap_id: ctx.bap_id,
      bpp_id: callbackPayload.context.bpp_id ?? null,
      domain: ctx.domain,
      http_status: statusCode ?? null,
      ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
      payload_json: JSON.stringify(callbackPayload),
      error_message: cbErr ?? null,
    });

    observabilityService.push('on_status', callbackPayload);
    ondcLogger.info('Flow3B: final RTO unsolicited on_status callback sent', {
      ondcOrderId,
      finalState,
    });
  },
};
