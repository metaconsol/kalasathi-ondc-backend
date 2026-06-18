/**
 * Order Service — business logic for ONDC order lifecycle.
 * Handles confirm, status updates, cancellations.
 *
 * TODO: Integrate with fulfillment service for shipping updates,
 *       trigger payment service on confirm, notify sellers.
 */

import { orderModel } from '~/ondc/models/order.model';
import type { OndcOrderStatus as DbOrderStatus } from '~/ondc/models/order.model';
import { fulfillmentModel } from '~/ondc/models/fulfillment.model';
import { transactionModel } from '~/ondc/models/transaction.model';
import { adaptConfirmToOrderRow, adaptOrderRowToOndcOrder } from '~/ondc/adapters/order.adapter';
import { becknService } from './beckn.service';
import { observabilityService } from './observability.service';
import { buildResponseContext } from '~/ondc/utils/payload.builder';
import { ondcLogger } from '~/ondc/utils/logger.util';
import { OndcError } from '~/ondc/utils/error.handler';
import type { BecknContext } from '~/ondc/types/beckn.types';
import type { OndcOrder } from '~/ondc/types/order.types';
import type { ConfirmMessage } from '~/ondc/adapters/order.adapter';
import { buildDbBackedOnStatusOrder } from '~/ondc/utils/onStatusOrder.builder';

export const orderService = {
  /** Handle /confirm — create order and send /on_confirm callback */
  async handleConfirm(context: BecknContext, message: ConfirmMessage): Promise<void> {
    // provider_id = String(store.id), so store_id is directly parseable
    const storeId = parseInt(message.order.provider.id, 10) || null;
    const orderRow = adaptConfirmToOrderRow(context, message, 0, storeId);

    await orderModel.create(orderRow);
    await transactionModel.setStatus(context.transaction_id, 'COMPLETED');

    // Sync fulfillments
    const fulfillments: any[] = message.order.fulfillments ?? [];
    for (const f of fulfillments) {
      await fulfillmentModel.upsert({
        ondc_order_id: orderRow.ondc_order_id,
        fulfillment_id: f.id ?? 'F1',
        fulfillment_type: f.type ?? 'Delivery',
        state: 'Pending',
        tracking_url: null,
        awb_number: null,
        courier_name: null,
        agent_name: null,
        agent_phone: null,
        estimated_delivery: null,
        actual_delivery: null,
        fulfillment_json: JSON.stringify(f),
      });
    }

    const responseOrder: OndcOrder = {
      ...message.order,
      id: orderRow.ondc_order_id,
      state: 'Accepted',
    };

    const callbackPayload = {
      context: buildResponseContext(context, 'on_confirm'),
      message: { order: responseOrder },
    };

    const callbackUrl = becknService.buildCallbackUrl(context.bap_uri, 'on_confirm');
    await becknService.sendCallback(
      callbackUrl,
      'on_confirm',
      callbackPayload,
      context.transaction_id,
    );

    observabilityService.push('on_confirm', callbackPayload);

    ondcLogger.info('Order confirmed', {
      orderId: orderRow.ondc_order_id,
      transactionId: context.transaction_id,
    });
  },

  /** Handle /status — return current order status */
  async handleStatus(context: BecknContext, message: { order_id: string }): Promise<void> {
    const order = await orderModel.findByOndcOrderId(message.order_id);
    if (!order) throw OndcError.orderNotFound(message.order_id);

    const items = await orderModel.getItems(order.ondc_order_id);
    const fulfillments = await orderModel.getFulfillments(order.ondc_order_id);
    const ondcOrder = await buildDbBackedOnStatusOrder(order, items, fulfillments);
    const callbackPayload = {
      context: buildResponseContext(context, 'on_status'),
      message: { order: ondcOrder },
    };

    const callbackUrl = becknService.buildCallbackUrl(context.bap_uri, 'on_status');
    await becknService.sendCallback(
      callbackUrl,
      'on_status',
      callbackPayload,
      context.transaction_id,
    );

    observabilityService.push('on_status', callbackPayload);
  },

  /** Transition order to a new status and send /on_status */
  async pushStatusUpdate(
    ondcOrderId: string,
    toStatus: DbOrderStatus,
    fulfillmentState: string | null,
    triggeredBy: string,
  ): Promise<void> {
    const order = await orderModel.findByOndcOrderId(ondcOrderId);
    if (!order) throw OndcError.orderNotFound(ondcOrderId);

    await orderModel.transitionStatus(
      ondcOrderId,
      order.status,
      toStatus,
      fulfillmentState,
      triggeredBy,
      null,
    );

    // TODO: build proper /on_status payload with updated fulfillment state and send to BAP
    ondcLogger.info('Status updated', {
      ondcOrderId,
      from: order.status,
      to: toStatus,
      fulfillmentState,
    });
  },

  /** Handle /cancel */
  async handleCancel(
    context: BecknContext,
    message: { order_id: string; cancellation_reason_id: string },
  ): Promise<void> {
    const order = await orderModel.findByOndcOrderId(message.order_id);
    if (!order) throw OndcError.orderNotFound(message.order_id);

    await orderModel.transitionStatus(
      message.order_id,
      order.status,
      'CANCELLED',
      'Cancelled',
      'buyer',
      JSON.stringify({ reason_id: message.cancellation_reason_id }),
    );

    const ondcOrder = adaptOrderRowToOndcOrder({ ...order, status: 'CANCELLED' });
    const callbackPayload = {
      context: buildResponseContext(context, 'on_cancel'),
      message: { order: { ...ondcOrder, state: 'Cancelled' } },
    };

    const callbackUrl = becknService.buildCallbackUrl(context.bap_uri, 'on_cancel');
    await becknService.sendCallback(
      callbackUrl,
      'on_cancel',
      callbackPayload,
      context.transaction_id,
    );

    observabilityService.push('on_cancel', callbackPayload);
  },
};
