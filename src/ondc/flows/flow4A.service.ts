/**
 * Flow 4A — Return flow: buyer initiates return.
 * PHP reference: generate_flow4a_on_status.php, generate_flow4a_return_update.php, Flow4A_update.php
 * TODO: Implement full return lifecycle with /on_update and /on_status callbacks.
 */

import { orderModel } from '~/ondc/models/order.model';
import { becknService } from '~/ondc/services/beckn.service';
import { observabilityService } from '~/ondc/services/observability.service';
import { buildResponseContext, buildOnUpdate, newMessageId } from '~/ondc/utils/payload.builder';
import { txnLogModel } from '~/ondc/models/log.model';
import { ondcLogger } from '~/ondc/utils/logger.util';
import { buildOnStatusOrder } from '~/ondc/adapters/order.adapter';
import { OndcError } from '~/ondc/utils/error.handler';
import type { OndcFulfillmentState } from '~/ondc/types/order.types';

export const flow4AService = {
  async initiateReturn(ondcOrderId: string, returnItems: unknown[]): Promise<void> {
    // TODO: Update fulfillment to Return_Initiated, send /on_update to BAP
    ondcLogger.info('Flow4A: return initiated (TODO)', { ondcOrderId, returnItems });
  },

  async returnPickedUp(ondcOrderId: string): Promise<void> {
    // TODO: Update to Return_Picked, send /on_status
    ondcLogger.info('Flow4A: return picked up (TODO)', { ondcOrderId });
  },

  async returnDelivered(ondcOrderId: string): Promise<void> {
    // TODO: Update to Return_Delivered, trigger refund
    ondcLogger.info('Flow4A: return delivered (TODO)', { ondcOrderId });
  },

  /**
   * Push an unsolicited /on_update to the BAP.
   * Used for unsolicited return state updates (Return_Initiated, Return_Approved, Return_Picked, Return_Delivered).
   */
  async pushOnUpdate(ondcOrderId: string, fulfillmentState: OndcFulfillmentState): Promise<void> {
    const order = await orderModel.findByOndcOrderId(ondcOrderId);
    if (!order) throw OndcError.orderNotFound(ondcOrderId);

    const liveFulfillments = await orderModel.getFulfillments(ondcOrderId);
    const onUpdateOrder = await buildOnStatusOrder(order, liveFulfillments);

    const callbackContext = {
      domain: order.domain,
      country: 'IND',
      city: order.city ?? '',
      action: 'on_update' as const,
      core_version: order.core_version ?? '1.2.0',
      bap_id: order.bap_id,
      bap_uri: order.bap_uri,
      bpp_id: '',
      bpp_uri: '',
      transaction_id: order.transaction_id,
      message_id: newMessageId(),
      timestamp: new Date().toISOString(),
      // Contract v1.2.5 callback examples carry ttl PT30S; include it on
      // unsolicited pushes too (solicited replies inherit it by mirroring).
      ttl: 'PT30S',
    };
    const responseContext = buildResponseContext(callbackContext as any, 'on_update');

    const callbackPayload = buildOnUpdate(callbackContext as any, onUpdateOrder);

    const callbackUrl = becknService.buildCallbackUrl(order.bap_uri, 'on_update');
    const { statusCode, error: cbErr } = await becknService.sendCallback(
      callbackUrl,
      'on_update',
      callbackPayload as any,
      order.transaction_id,
    );

    await txnLogModel.insert({
      transaction_id: order.transaction_id,
      message_id: (responseContext as any).message_id,
      action: 'on_update',
      direction: 'outbound',
      bap_id: order.bap_id,
      bpp_id: (responseContext as any).bpp_id ?? null,
      domain: order.domain,
      http_status: statusCode ?? null,
      ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
      payload_json: JSON.stringify(callbackPayload),
      error_message: cbErr ?? null,
    });

    observabilityService.push('on_update', callbackPayload as Record<string, unknown>);

    ondcLogger.info('Flow4A on_update sent', { ondcOrderId, fulfillmentState });
  },
};
