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

export const fulfillmentService = {
  async transitionOrderStatus(
    ondcOrderId: string,
    nextStatus:
      | 'PACKED'
      | 'AGENT_ASSIGNED'
      | 'ORDER_PICKED_UP'
      | 'OUT_FOR_DELIVERY'
      | 'DELIVERED'
      | 'RETURNED',
    fulfillmentState: OndcFulfillmentState,
    note: string,
  ): Promise<void> {
    const order = await orderModel.findByOndcOrderId(ondcOrderId);
    if (!order) return;

    await orderModel.transitionStatus(
      ondcOrderId,
      order.status,
      nextStatus,
      fulfillmentState,
      'seller',
      note,
      null,
    );

    try {
      await flow1AService.pushOnStatus(ondcOrderId, fulfillmentState);
    } catch (err) {
      ondcLogger.warn('Unable to push on_status after fulfillment transition', {
        ondcOrderId,
        nextStatus,
        fulfillmentState,
        err,
      });
    }
  },

  /** Mark an order as packed */
  async markPacked(ondcOrderId: string, fulfillmentId = 'F1'): Promise<void> {
    await fulfillmentModel.updateState(ondcOrderId, fulfillmentId, 'Packed');
    await this.transitionOrderStatus(ondcOrderId, 'PACKED', 'Packed', 'Order packed');
    ondcLogger.info('Order packed', { ondcOrderId });
  },

  /** Assign delivery agent before pickup */
  async markAgentAssigned(
    ondcOrderId: string,
    fulfillmentId = 'F1',
    agentName?: string,
    agentPhone?: string,
  ): Promise<void> {
    await fulfillmentModel.updateState(ondcOrderId, fulfillmentId, 'Agent-assigned', {
      agentName,
      agentPhone,
    });
    await this.transitionOrderStatus(
      ondcOrderId,
      'AGENT_ASSIGNED',
      'Agent-assigned',
      'Delivery agent assigned',
    );
    ondcLogger.info('Agent assigned', { ondcOrderId, agentName });
  },

  /** Mark order as picked up by courier, attach AWB */
  async markPickedUp(
    ondcOrderId: string,
    fulfillmentId = 'F1',
    awb: string,
    courier: string,
    trackingUrl?: string,
  ): Promise<void> {
    await fulfillmentModel.updateState(ondcOrderId, fulfillmentId, 'Order-picked-up', {
      awb,
      courier,
      ...(trackingUrl !== undefined ? { url: trackingUrl } : {}),
    });
    await this.transitionOrderStatus(
      ondcOrderId,
      'ORDER_PICKED_UP',
      'Order-picked-up',
      'Order picked up by courier',
    );
    ondcLogger.info('Order picked up', { ondcOrderId, awb, courier });
  },

  /** Mark order as out for delivery */
  async markOutForDelivery(
    ondcOrderId: string,
    fulfillmentId = 'F1',
    agentName?: string,
    agentPhone?: string,
  ): Promise<void> {
    await fulfillmentModel.updateState(ondcOrderId, fulfillmentId, 'Out-for-delivery', {
      agentName,
      agentPhone,
    });
    await this.transitionOrderStatus(
      ondcOrderId,
      'OUT_FOR_DELIVERY',
      'Out-for-delivery',
      'Order is out for delivery',
    );
    ondcLogger.info('Out for delivery', { ondcOrderId, agentName });
  },

  /** Mark order as delivered */
  async markDelivered(ondcOrderId: string, fulfillmentId = 'F1'): Promise<void> {
    await fulfillmentModel.updateState(ondcOrderId, fulfillmentId, 'Order-delivered', {
      actualDelivery: new Date(),
    });
    await this.transitionOrderStatus(
      ondcOrderId,
      'DELIVERED',
      'Order-delivered',
      'Order delivered',
    );
    ondcLogger.info('Order delivered', { ondcOrderId });
  },

  /** Initiate RTO (return to origin) */
  async initiateRto(ondcOrderId: string, fulfillmentId = 'F1'): Promise<void> {
    await fulfillmentModel.updateState(ondcOrderId, fulfillmentId, 'RTO-Initiated');
    ondcLogger.info('RTO initiated', { ondcOrderId });
  },

  /** Handle return initiation from buyer */
  async initiateReturn(ondcOrderId: string, fulfillmentId = 'F1'): Promise<void> {
    await fulfillmentModel.updateState(ondcOrderId, fulfillmentId, 'Return_Delivered', {
      actualDelivery: new Date(),
    });
    await this.transitionOrderStatus(ondcOrderId, 'RETURNED', 'Return_Delivered', 'Order returned');
    ondcLogger.info('Order returned', { ondcOrderId });
  },

  /** Get current fulfillment state for an order */
  async getState(ondcOrderId: string, fulfillmentId = 'F1'): Promise<OndcFulfillmentState | null> {
    const fulfillments = (await fulfillmentModel.findByOrderId(ondcOrderId)) ?? [];
    const f = fulfillments.find((ff) => ff.fulfillment_id === fulfillmentId);
    return f?.state ?? null;
  },
};
