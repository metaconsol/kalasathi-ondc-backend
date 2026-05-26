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

export const fulfillmentService = {
  /** Mark an order as packed */
  async markPacked(ondcOrderId: string, fulfillmentId = 'F1'): Promise<void> {
    await fulfillmentModel.updateState(ondcOrderId, fulfillmentId, 'Packed');
    await orderModel.updateStatus(ondcOrderId, 'PACKED');
    ondcLogger.info('Order packed', { ondcOrderId });
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
    ondcLogger.info('Order picked up', { ondcOrderId, awb, courier });
  },

  /** Mark order as out for delivery */
  async markOutForDelivery(
    ondcOrderId: string,
    fulfillmentId = 'F1',
    agentName?: string,
    agentPhone?: string,
  ): Promise<void> {
    await fulfillmentModel.updateState(ondcOrderId, fulfillmentId, 'Out-for-delivery');
    ondcLogger.info('Out for delivery', { ondcOrderId, agentName });
  },

  /** Mark order as delivered */
  async markDelivered(ondcOrderId: string, fulfillmentId = 'F1'): Promise<void> {
    await fulfillmentModel.updateState(ondcOrderId, fulfillmentId, 'Order-delivered');
    await orderModel.updateStatus(ondcOrderId, 'DELIVERED');
    ondcLogger.info('Order delivered', { ondcOrderId });
  },

  /** Initiate RTO (return to origin) */
  async initiateRto(ondcOrderId: string, fulfillmentId = 'F1'): Promise<void> {
    await fulfillmentModel.updateState(ondcOrderId, fulfillmentId, 'RTO-Initiated');
    ondcLogger.info('RTO initiated', { ondcOrderId });
  },

  /** Handle return initiation from buyer */
  async initiateReturn(ondcOrderId: string, fulfillmentId = 'F1'): Promise<void> {
    await fulfillmentModel.updateState(ondcOrderId, fulfillmentId, 'Return_Initiated');
    ondcLogger.info('Return initiated', { ondcOrderId });
  },

  /** Get current fulfillment state for an order */
  async getState(ondcOrderId: string, fulfillmentId = 'F1'): Promise<OndcFulfillmentState | null> {
    const fulfillments = await fulfillmentModel.findByOrderId(ondcOrderId);
    const f = fulfillments.find((ff) => ff.fulfillment_id === fulfillmentId);
    return f?.state ?? null;
  },
};
