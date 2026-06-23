/**
 * Flow 1A — Unsolicited /on_status for order state transitions.
 * Triggered by seller when: order is packed, shipped, out-for-delivery, delivered.
 *
 * PHP reference: generate_flow1a_on_status.php, flow1B_cod_status.php
 * TODO: Call this from fulfillmentService after each state change.
 */

import { orderModel } from '~/ondc/models/order.model';
import { fulfillmentModel } from '~/ondc/models/fulfillment.model';
import { becknService } from '~/ondc/services/beckn.service';
import { observabilityService } from '~/ondc/services/observability.service';
import { buildResponseContext } from '~/ondc/utils/payload.builder';
import { ondcLogger } from '~/ondc/utils/logger.util';
import { adaptOrderRowToOndcOrder } from '~/ondc/adapters/order.adapter';
import { OndcError } from '~/ondc/utils/error.handler';
import type { OndcFulfillmentState } from '~/ondc/types/order.types';

export const flow1AService = {
  /** Push /on_status update to BAP */
  async pushOnStatus(ondcOrderId: string, fulfillmentState: OndcFulfillmentState): Promise<void> {
    const order = await orderModel.findByOndcOrderId(ondcOrderId);
    if (!order) throw OndcError.orderNotFound(ondcOrderId);

    const fulfillments = await fulfillmentModel.findByOrderId(ondcOrderId);
    const ondcOrder = adaptOrderRowToOndcOrder(order);

    // Inject updated fulfillment state
    const updatedFulfillments = ondcOrder.fulfillments.map((f, i) => ({
      ...f,
      state: {
        descriptor: { code: fulfillmentState },
        updated_at: new Date().toISOString(),
      },
      tracking: !!fulfillments[i]?.tracking_url,
    }));

    const callbackContext = {
      domain: order.domain,
      country: 'IND',
      city: order.city ?? '',
      action: 'on_status' as const,
      core_version: order.core_version ?? '1.2.0',
      bap_id: order.bap_id,
      bap_uri: order.bap_uri,
      bpp_id: '',
      bpp_uri: '',
      transaction_id: order.transaction_id,
      message_id: '',
      timestamp: new Date().toISOString(),
    };
    const responseContext = buildResponseContext(callbackContext, 'on_status');

    const callbackPayload = {
      context: responseContext,
      message: {
        order: { ...ondcOrder, fulfillments: updatedFulfillments },
      },
    };

    const callbackUrl = becknService.buildCallbackUrl(order.bap_uri, 'on_status');
    await becknService.sendCallback(
      callbackUrl,
      'on_status',
      callbackPayload as any,
      order.transaction_id,
    );

    observabilityService.push('on_status', callbackPayload);

    ondcLogger.info('Flow1A on_status sent', { ondcOrderId, fulfillmentState });
  },
};
