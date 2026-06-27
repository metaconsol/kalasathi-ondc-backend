/**
 * Flow 3A — Seller-initiated cancellation.
 *  - cancelByseller        → FULL cancel  (Pramaan Flow 3C): unsolicited on_cancel
 *  - partialCancelByseller → PARTIAL cancel (Pramaan Flow 3A): on_update + on_status
 * PHP reference: generate_flow3a_on_cancel.php / _on_status.php / _on_update.php
 */

import { orderModel } from '~/ondc/models/order.model';
import { becknService } from '~/ondc/services/beckn.service';
import { observabilityService } from '~/ondc/services/observability.service';
import { buildResponseContext, buildOnUpdate, nowIso } from '~/ondc/utils/payload.builder';
import { txnLogModel } from '~/ondc/models/log.model';
import { buildOnStatusOrder } from '~/ondc/adapters/order.adapter';
import { flow1AService } from '~/ondc/flows/flow1A.service';
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
    message_id: '',
    timestamp: '',
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
   * quantities. Sends /on_update (remaining qty on the delivery fulfillment, the
   * cancelled qty on a Cancel fulfillment with a quote_trail) followed by /on_status.
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

    const cancelMap = new Map(cancelItems.map((c) => [c.id, Math.max(0, c.quantity)]));
    const cancelFulfId = 'C1';
    const itemsPayload: any[] = [];
    const quoteTrail: any[] = [];

    for (const it of items) {
      const cancelQty = Math.min(cancelMap.get(it.item_id) ?? 0, it.quantity);
      const remaining = it.quantity - cancelQty;
      itemsPayload.push({
        id: it.item_id,
        fulfillment_id: it.fulfillment_id || 'F1',
        quantity: { count: remaining },
      });
      if (cancelQty > 0) {
        itemsPayload.push({
          id: it.item_id,
          fulfillment_id: cancelFulfId,
          quantity: { count: cancelQty },
        });
        const unit = parseFloat(it.unit_price || '0');
        quoteTrail.push(
          { code: 'type', value: 'item' },
          { code: 'id', value: it.item_id },
          { code: 'currency', value: it.currency || 'INR' },
          { code: 'value', value: (-1 * cancelQty * unit).toFixed(2) },
        );
      }
    }

    const cancelFulfillment = {
      id: cancelFulfId,
      type: 'Cancel',
      state: { descriptor: { code: 'Cancelled' } },
      tags: [{ code: 'quote_trail', list: quoteTrail }],
    };

    const updatedOrder = {
      ...base,
      items: itemsPayload,
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

    // buildOnUpdate wraps { context: buildResponseContext(ctx,'on_update'), message:{ order } }
    const onUpdatePayload = buildOnUpdate(sellerContext(order) as any, updatedOrder) as any;

    const { statusCode, error: cbErr } = await becknService.sendCallback(
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
      http_status: statusCode ?? null,
      ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
      payload_json: JSON.stringify(onUpdatePayload),
      error_message: cbErr ?? null,
    });

    observabilityService.push('on_update', onUpdatePayload);
    ondcLogger.info('Flow3A: seller PARTIAL cancel (on_update)', { ondcOrderId, reasonId });

    // Follow up with on_status so the buyer NP sees the updated order state.
    const currentState = (liveFulfillments[0]?.state as any) ?? 'Pending';
    await flow1AService.pushOnStatus(ondcOrderId, currentState);
  },
};
