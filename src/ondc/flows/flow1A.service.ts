/**
 * Flow 1A — Unsolicited /on_status for order state transitions.
 * Triggered by seller when: order is packed, shipped, out-for-delivery, delivered.
 *
 * PHP reference: generate_flow1a_on_status.php, flow1B_cod_status.php
 * TODO: Call this from fulfillmentService after each state change.
 */

import { orderModel } from '~/ondc/models/order.model';
import { becknService } from '~/ondc/services/beckn.service';
import { observabilityService } from '~/ondc/services/observability.service';
import { buildResponseContext } from '~/ondc/utils/payload.builder';
import { txnLogModel } from '~/ondc/models/log.model';
import { ondcLogger } from '~/ondc/utils/logger.util';
import { buildOnStatusOrder } from '~/ondc/adapters/order.adapter';
import { OndcError } from '~/ondc/utils/error.handler';
import type { OndcFulfillmentState } from '~/ondc/types/order.types';
import { newMessageId } from '~/ondc/utils/payload.builder';

export const flow1AService = {
  /**
   * Push a COMPLETE unsolicited /on_status to the BAP. The fulfillment state must
   * already be persisted in the DB (callers update it before calling this); the
   * order payload is rebuilt fully from the DB so quote/items/billing/payment match
   * on_confirm and the fulfillment state/agent/tracking reflect the live order.
   */
  async pushOnStatus(ondcOrderId: string, fulfillmentState: OndcFulfillmentState): Promise<void> {
    const order = await orderModel.findByOndcOrderId(ondcOrderId);
    if (!order) throw OndcError.orderNotFound(ondcOrderId);

    const liveFulfillments = await orderModel.getFulfillments(ondcOrderId);
    const onStatusOrder = await buildOnStatusOrder(order, liveFulfillments);

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
      message_id: newMessageId(),
      timestamp: new Date().toISOString(),
    };
    const responseContext = buildResponseContext(callbackContext, 'on_status');

    const callbackPayload = {
      context: responseContext,
      message: { order: onStatusOrder },
    };

    const callbackUrl = becknService.buildCallbackUrl(order.bap_uri, 'on_status');
    const { statusCode, error: cbErr } = await becknService.sendCallback(
      callbackUrl,
      'on_status',
      callbackPayload as any,
      order.transaction_id,
    );

    await txnLogModel.insert({
      transaction_id: order.transaction_id,
      message_id: (responseContext as any).message_id,
      action: 'on_status',
      direction: 'outbound',
      bap_id: order.bap_id,
      bpp_id: (responseContext as any).bpp_id ?? null,
      domain: order.domain,
      http_status: statusCode ?? null,
      ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
      payload_json: JSON.stringify(callbackPayload),
      error_message: cbErr ?? null,
    });

    observabilityService.push('on_status', callbackPayload);

    ondcLogger.info('Flow1A on_status sent', { ondcOrderId, fulfillmentState });
  },
};
