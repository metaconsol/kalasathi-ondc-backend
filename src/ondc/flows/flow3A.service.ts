/**
 * Flow 3A — Seller-initiated cancellation (before pickup).
 * PHP reference: generate_flow3a_on_cancel.php, generate_flow3a_on_status.php, generate_flow3a_on_update.php
 * TODO: Implement seller-initiated cancel with reason and refund trigger.
 */

import { orderModel } from '~/ondc/models/order.model';
import { becknService } from '~/ondc/services/beckn.service';
import { buildResponseContext } from '~/ondc/utils/payload.builder';
import { adaptOrderRowToOndcOrder } from '~/ondc/adapters/order.adapter';
import { OndcError } from '~/ondc/utils/error.handler';
import { ondcLogger } from '~/ondc/utils/logger.util';

export const flow3AService = {
  /** Seller cancels order before it is picked up */
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
    );

    const ondcOrder = adaptOrderRowToOndcOrder({ ...order, status: 'CANCELLED' });
    const ctx = {
      domain: order.domain,
      country: 'IND',
      city: order.city ?? '',
      action: 'on_cancel' as const,
      core_version: order.core_version ?? '1.2.0',
      bap_id: order.bap_id,
      bap_uri: order.bap_uri,
      bpp_id: '',
      bpp_uri: '',
      transaction_id: order.transaction_id,
      message_id: '',
      timestamp: '',
    };

    const callbackPayload = {
      context: buildResponseContext(ctx, 'on_cancel'),
      message: { order: { ...ondcOrder, state: 'Cancelled' } },
    };

    const callbackUrl = becknService.buildCallbackUrl(order.bap_uri, 'on_cancel');
    await becknService.sendCallback(
      callbackUrl,
      'on_cancel',
      callbackPayload as any,
      order.transaction_id,
    );

    ondcLogger.info('Flow3A: seller cancelled order', { ondcOrderId, reasonId });
  },
};
