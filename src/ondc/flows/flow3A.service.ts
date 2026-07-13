/**
 * Flow 3A — Seller-initiated cancellation.
 *  - cancelByseller        → FULL cancel  (Pramaan Flow 3C): unsolicited on_cancel
 *  - partialCancelByseller → PARTIAL cancel (Pramaan Flow 3A): on_update only
 * PHP reference: generate_flow3a_on_cancel.php / _on_status.php / _on_update.php
 */

import { orderModel } from '~/ondc/models/order.model';
import { becknService } from '~/ondc/services/beckn.service';
import { observabilityService } from '~/ondc/services/observability.service';
import {
  buildResponseContext,
  buildOnUpdate,
  nowIso,
  newMessageId,
} from '~/ondc/utils/payload.builder';
import { txnLogModel } from '~/ondc/models/log.model';
import { buildOnStatusOrder } from '~/ondc/adapters/order.adapter';
import { ondcExec } from '~/lib/ondcSql';
import { ondcEnv } from '~/config/ondc.config';
import { OndcError } from '~/ondc/utils/error.handler';
import { ondcLogger } from '~/ondc/utils/logger.util';

interface CancelLineItem {
  id: string;
  quantity: number;
}

function sellerContext(order: {
  domain: string;
  city: string | null;
  core_version: string | null;
  bap_id: string;
  bap_uri: string;
  transaction_id: string;
}) {
  return {
    domain: order.domain,
    country: 'IND',
    city: order.city ?? '',
    action: 'on_status' as const, // overridden by buildResponseContext's 2nd arg
    core_version: order.core_version ?? '1.2.0',
    bap_id: order.bap_id,
    bap_uri: order.bap_uri,
    bpp_id: '',
    bpp_uri: '',
    transaction_id: order.transaction_id,
    message_id: newMessageId(),
    timestamp: '',
  };
}

/**
 * Recompute an ONDC quote after a partial cancellation: reduce each item's
 * breakup line to its remaining quantity (value = unit_price * remaining) and
 * recompute the grand total from every breakup line. Non-item lines (delivery,
 * tax, packing, …) are preserved so the order stays internally consistent — the
 * quote in /on_update + /on_status MUST match the reduced item quantities or
 * Pramaan rejects the callback.
 */
function recomputeQuoteForRemaining(
  quote: Record<string, any> | undefined,
  remainingById: Map<string, number>,
): Record<string, any> | undefined {
  if (!quote || !Array.isArray(quote['breakup'])) return quote;
  const currency = quote['price']?.currency ?? 'INR';
  const breakup = quote['breakup'].map((b: any) => {
    const itemId = b['@ondc/org/item_id'];
    if (b['@ondc/org/title_type'] === 'item' && itemId && remainingById.has(itemId)) {
      const remaining = remainingById.get(itemId) ?? 0;
      const origCount = Number(b['@ondc/org/item_quantity']?.count ?? 1) || 1;
      const unit =
        parseFloat(b['item']?.price?.value ?? '') ||
        parseFloat(b['price']?.value ?? '0') / origCount;
      const lineValue = (unit * remaining).toFixed(2);
      return {
        ...b,
        '@ondc/org/item_quantity': { ...(b['@ondc/org/item_quantity'] ?? {}), count: remaining },
        price: { ...(b['price'] ?? {}), currency, value: lineValue },
      };
    }
    return b;
  });
  const total = breakup.reduce(
    (sum: number, b: any) => sum + (parseFloat(b['price']?.value ?? '0') || 0),
    0,
  );
  return {
    ...quote,
    breakup,
    price: { ...(quote['price'] ?? {}), currency, value: total.toFixed(2) },
  };
}

export const flow3AService = {
  /**
   * Merchant-initiated FULL order cancellation (Pramaan Flow 3C) — sends an
   * unsolicited /on_cancel to the BAP with the complete order (quote/items/billing/
   * payment from on_confirm) plus the cancellation block and Cancelled fulfillment.
   */
  async cancelByseller(ondcOrderId: string, reasonId: string): Promise<void> {
    const order = await orderModel.findByOndcOrderId(ondcOrderId);
    if (!order) throw OndcError.orderNotFound(ondcOrderId);

    await orderModel.transitionStatus(
      ondcOrderId,
      order.status,
      'CANCELLED',
      'Cancelled',
      'seller',
      JSON.stringify({ reason_id: reasonId }),
      null,
      { cancel_reason_id: reasonId },
    );

    const liveFulfillments = await orderModel.getFulfillments(ondcOrderId);
    for (const f of liveFulfillments) {
      await orderModel.updateFulfillmentState(ondcOrderId, f.fulfillment_id, 'Cancelled');
    }
    const refreshed = await orderModel.getFulfillments(ondcOrderId);
    const baseOrder = await buildOnStatusOrder(
      { ...order, status: 'CANCELLED' as const },
      refreshed,
    );

    const cancelledOrder = {
      ...baseOrder,
      state: 'Cancelled',
      cancellation: {
        cancelled_by: order.bpp_id || ondcEnv.subscriberId,
        reason: { id: reasonId },
      },
    };

    const responseContext = buildResponseContext(sellerContext(order), 'on_cancel');
    const callbackPayload = { context: responseContext, message: { order: cancelledOrder } };

    const { statusCode, error: cbErr } = await becknService.sendCallback(
      becknService.buildCallbackUrl(order.bap_uri, 'on_cancel'),
      'on_cancel',
      callbackPayload as any,
      order.transaction_id,
    );

    await txnLogModel.insert({
      transaction_id: order.transaction_id,
      message_id: (responseContext as any).message_id,
      action: 'on_cancel',
      direction: 'outbound',
      bap_id: order.bap_id,
      bpp_id: (responseContext as any).bpp_id ?? null,
      domain: order.domain,
      http_status: statusCode ?? null,
      ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
      payload_json: JSON.stringify(callbackPayload),
      error_message: cbErr ?? null,
    });

    observabilityService.push('on_cancel', callbackPayload);
    ondcLogger.info('Flow3A: seller FULL cancel (on_cancel)', { ondcOrderId, reasonId });
  },

  /**
   * Merchant-initiated PARTIAL cancellation (Pramaan Flow 3A) — cancels some item
   * quantities. Sends only /on_update so the buyer NP can drive the intermediate
   * settlement step before the seller continues with later unsolicited /on_status
   * callbacks from the fulfillment controls.
   */
  async partialCancelByseller(
    ondcOrderId: string,
    cancelItems: CancelLineItem[],
    reasonId: string,
  ): Promise<void> {
    const order = await orderModel.findByOndcOrderId(ondcOrderId);
    if (!order) throw OndcError.orderNotFound(ondcOrderId);

    const items = await orderModel.getItems(ondcOrderId);
    const liveFulfillments = await orderModel.getFulfillments(ondcOrderId);
    const base = (await buildOnStatusOrder(order, liveFulfillments)) as Record<string, any>;
    const baseItems = (base['items'] as any[]) ?? [];

    const cancelMap = new Map(cancelItems.map((c) => [c.id, Math.max(0, c.quantity)]));
    const unitById = new Map(items.map((it) => [it.item_id, parseFloat(it.unit_price || '0')]));
    const currencyById = new Map(items.map((it) => [it.item_id, it.currency || 'INR']));
    const orderedQtyById = new Map<string, number>();
    for (const it of items) orderedQtyById.set(it.item_id, it.quantity);
    for (const bi of baseItems) {
      if (!orderedQtyById.has(bi.id)) orderedQtyById.set(bi.id, Number(bi.quantity?.count ?? 0));
    }

    const cancelFulfId = 'C1';
    const itemsPayload: any[] = [];
    const quoteTrail: any[] = [];
    const remainingById = new Map<string, number>();

    // Walk the confirm-time items (full structure: id, descriptor, price, …) so the
    // updated order keeps a valid item shape; only the quantities change.
    for (const bi of baseItems) {
      const itemId = bi.id;
      const ordered = orderedQtyById.get(itemId) ?? Number(bi.quantity?.count ?? 0);
      const cancelQty = Math.min(cancelMap.get(itemId) ?? 0, ordered);
      const remaining = ordered - cancelQty;
      remainingById.set(itemId, remaining);

      // Remaining quantity stays on the delivery fulfillment.
      itemsPayload.push({ ...bi, quantity: { ...(bi.quantity ?? {}), count: remaining } });

      if (cancelQty > 0) {
        // Cancelled quantity moves to the Cancel fulfillment.
        itemsPayload.push({
          ...bi,
          fulfillment_id: cancelFulfId,
          quantity: { ...(bi.quantity ?? {}), count: cancelQty },
        });
        const unit = unitById.get(itemId) ?? 0;
        quoteTrail.push(
          { code: 'type', value: 'item' },
          { code: 'id', value: itemId },
          { code: 'currency', value: currencyById.get(itemId) ?? 'INR' },
          { code: 'value', value: (-1 * cancelQty * unit).toFixed(2) },
        );
      }
    }

    // Quote MUST reflect the reduced quantities, or Pramaan rejects the callback.
    const newQuote = recomputeQuoteForRemaining(
      base['quote'] as Record<string, any>,
      remainingById,
    );

    const fulfillmentTemplate =
      ((base['fulfillments'] as any[]) ?? []).find(
        (f: any) => f?.type !== 'Cancel' && f?.type !== 'RTO',
      ) ?? {};
    const cancelFulfillment = {
      ...fulfillmentTemplate,
      id: cancelFulfId,
      type: 'Cancel',
      '@ondc/org/provider_name': fulfillmentTemplate['@ondc/org/provider_name'] ?? 'ODOP Provider',
      tracking:
        typeof fulfillmentTemplate.tracking === 'boolean' ? fulfillmentTemplate.tracking : false,
      '@ondc/org/TAT': fulfillmentTemplate['@ondc/org/TAT'] ?? 'PT60M',
      state: { descriptor: { code: 'Cancelled' }, updated_at: nowIso() },
      start: fulfillmentTemplate.start,
      end: fulfillmentTemplate.end,
      tags: [{ code: 'quote_trail', list: quoteTrail }],
    };

    const updatedOrder = {
      ...base,
      items: itemsPayload,
      ...(newQuote ? { quote: newQuote } : {}),
      fulfillments: [...((base['fulfillments'] as any[]) ?? []), cancelFulfillment],
      updated_at: nowIso(),
    };

    // Record the partial-cancel action(s) so they are auditable / reusable.
    const { randomUUID } = await import('crypto');
    for (const c of cancelItems) {
      await ondcExec(
        `INSERT INTO ondc_order_actions
           (transaction_id, ondc_order_id, action_type, action_id, flow_type,
            item_id, item_name, quantity, reason_id, status)
         VALUES (?,?,?,?,?, ?,?,?,?,?)`,
        [
          order.transaction_id,
          ondcOrderId,
          'partial_cancel',
          randomUUID(),
          '3a',
          c.id,
          null,
          c.quantity,
          reasonId,
          'initiated',
        ],
      );
    }

    // 1) on_update — remaining qty on delivery + cancelled qty on the Cancel
    //    fulfillment, with the quote recomputed to the new (reduced) total.
    // buildOnUpdate wraps { context: buildResponseContext(ctx,'on_update'), message:{ order } }
    const onUpdatePayload = buildOnUpdate(sellerContext(order) as any, updatedOrder) as any;

    const upRes = await becknService.sendCallback(
      becknService.buildCallbackUrl(order.bap_uri, 'on_update'),
      'on_update',
      onUpdatePayload,
      order.transaction_id,
    );

    await txnLogModel.insert({
      transaction_id: order.transaction_id,
      message_id: onUpdatePayload.context.message_id,
      action: 'on_update',
      direction: 'outbound',
      bap_id: order.bap_id,
      bpp_id: onUpdatePayload.context.bpp_id ?? null,
      domain: order.domain,
      http_status: upRes.statusCode ?? null,
      ack_status: upRes.statusCode && upRes.statusCode < 300 ? 'ACK' : 'NACK',
      payload_json: JSON.stringify(onUpdatePayload),
      error_message: upRes.error ?? null,
    });

    observabilityService.push('on_update', onUpdatePayload);
    ondcLogger.info('Flow3A: seller PARTIAL cancel (on_update)', { ondcOrderId, reasonId });
  },
};
