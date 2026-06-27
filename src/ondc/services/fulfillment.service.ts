/**
 * Fulfillment Service — manages shipping/delivery states for ONDC orders.
 * Integrates with courier APIs and triggers unsolicited /on_status flows.
 *
 * TODO: Integrate with shipping partner (Shiprocket, Delhivery, etc.)
 */

import { fulfillmentModel } from '~/ondc/models/fulfillment.model';
import { orderModel } from '~/ondc/models/order.model';
import { ondcLogger } from '~/ondc/utils/logger.util';
import type { OndcFulfillmentState } from '~/ondc/types/order.types';
import { flow1AService } from '~/ondc/flows/flow1A.service';
import { flow3CService } from '~/ondc/flows/flow3C.service';

export const fulfillmentService = {
  /** Mark an order as packed */
  async markPacked(ondcOrderId: string, fulfillmentId = 'F1'): Promise<void> {
    await fulfillmentModel.updateState(ondcOrderId, fulfillmentId, 'Packed');
    const order = await orderModel.findByOndcOrderId(ondcOrderId);
    await orderModel.transitionStatus(
      ondcOrderId,
      order?.status ?? null,
      'PACKED',
      'Packed',
      'seller',
      'Order packed by seller',
    );
    ondcLogger.info('Order packed', { ondcOrderId });
    await flow1AService.pushOnStatus(ondcOrderId, 'Packed');
  },

  /** Mark order as agent assigned */
  async markAgentAssigned(ondcOrderId: string, fulfillmentId = 'F1'): Promise<void> {
    await fulfillmentModel.updateState(ondcOrderId, fulfillmentId, 'Agent-assigned');
    const order = await orderModel.findByOndcOrderId(ondcOrderId);
    await orderModel.transitionStatus(
      ondcOrderId,
      order?.status ?? null,
      'AGENT_ASSIGNED',
      'Agent-assigned',
      'seller',
      'Delivery agent assigned',
    );
    ondcLogger.info('Agent assigned', { ondcOrderId });
    await flow1AService.pushOnStatus(ondcOrderId, 'Agent-assigned');
  },

  /** Mark order as picked up by courier, attach AWB */
  async markPickedUp(
    ondcOrderId: string,
    fulfillmentId = 'F1',
    awb?: string,
    courier?: string,
    trackingUrl?: string,
  ): Promise<void> {
    await fulfillmentModel.updateState(ondcOrderId, fulfillmentId, 'Order-picked-up', {
      ...(awb ? { awb } : {}),
      ...(courier ? { courier } : {}),
      ...(trackingUrl ? { url: trackingUrl } : {}),
    });
    const order = await orderModel.findByOndcOrderId(ondcOrderId);
    await orderModel.transitionStatus(
      ondcOrderId,
      order?.status ?? null,
      'ORDER_PICKED_UP',
      'Order-picked-up',
      'seller',
      'Order picked up by courier',
    );
    ondcLogger.info('Order picked up', { ondcOrderId, awb, courier });
    await flow1AService.pushOnStatus(ondcOrderId, 'Order-picked-up');
  },

  /** Mark order as out for delivery */
  async markOutForDelivery(
    ondcOrderId: string,
    fulfillmentId = 'F1',
    agentName?: string,
    agentPhone?: string,
  ): Promise<void> {
    await fulfillmentModel.updateState(ondcOrderId, fulfillmentId, 'Out-for-delivery');
    const order = await orderModel.findByOndcOrderId(ondcOrderId);
    await orderModel.transitionStatus(
      ondcOrderId,
      order?.status ?? null,
      'OUT_FOR_DELIVERY',
      'Out-for-delivery',
      'seller',
      'Order out for delivery',
    );
    ondcLogger.info('Out for delivery', { ondcOrderId, agentName });
    await flow1AService.pushOnStatus(ondcOrderId, 'Out-for-delivery');
  },

  /** Mark order as delivered */
  async markDelivered(ondcOrderId: string, fulfillmentId = 'F1'): Promise<void> {
    await fulfillmentModel.updateState(ondcOrderId, fulfillmentId, 'Order-delivered');
    const order = await orderModel.findByOndcOrderId(ondcOrderId);
    await orderModel.transitionStatus(
      ondcOrderId,
      order?.status ?? null,
      'DELIVERED',
      'Order-delivered',
      'seller',
      'Order delivered to customer',
    );
    ondcLogger.info('Order delivered', { ondcOrderId });
    await flow1AService.pushOnStatus(ondcOrderId, 'Order-delivered');
  },

  /** Initiate RTO (return to origin) */
  async initiateRto(ondcOrderId: string, fulfillmentId = 'F1'): Promise<void> {
    await fulfillmentModel.updateState(ondcOrderId, fulfillmentId, 'RTO-Initiated');
    const order = await orderModel.findByOndcOrderId(ondcOrderId);
    await orderModel.transitionStatus(
      ondcOrderId,
      order?.status ?? null,
      'CANCELLED',
      'RTO-Initiated',
      'seller',
      'RTO initiated',
    );
    ondcLogger.info('RTO initiated', { ondcOrderId });
    // Flow 3B (RTO): unsolicited on_cancel (RTO) followed by on_status.
    await flow3CService.cancelRto(ondcOrderId);
    await flow1AService.pushOnStatus(ondcOrderId, 'RTO-Initiated');
  },

  /** Handle return initiation from buyer */
  async initiateReturn(ondcOrderId: string, fulfillmentId = 'F1'): Promise<void> {
    await fulfillmentModel.updateState(ondcOrderId, fulfillmentId, 'Return_Initiated');
    const order = await orderModel.findByOndcOrderId(ondcOrderId);
    await orderModel.transitionStatus(
      ondcOrderId,
      order?.status ?? null,
      'RETURNED',
      'Return_Initiated',
      'seller',
      'Return initiated',
    );
    ondcLogger.info('Return initiated', { ondcOrderId });
    await flow1AService.pushOnStatus(ondcOrderId, 'Return_Initiated');
  },

  /** Get current fulfillment state for an order */
  async getState(ondcOrderId: string, fulfillmentId = 'F1'): Promise<OndcFulfillmentState | null> {
    const fulfillments = (await fulfillmentModel.findByOrderId(ondcOrderId)) ?? [];
    const f = fulfillments.find((ff) => ff.fulfillment_id === fulfillmentId);
    return f?.state ?? null;
  },
};
