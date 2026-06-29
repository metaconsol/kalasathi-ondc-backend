/**
 * Flow 7 — Cancellation: Out of stock / item unavailable.
 * PHP reference: Flow7_cancel.php
 * The BPP cancels the order because the item went OOS after confirm.
 */

import { orderModel } from '~/ondc/models/order.model';
import { becknService } from '~/ondc/services/beckn.service';
import { buildResponseContext, newMessageId } from '~/ondc/utils/payload.builder';
import { adaptOrderRowToOndcOrder } from '~/ondc/adapters/order.adapter';
import { OndcError } from '~/ondc/utils/error.handler';
import { ondcLogger } from '~/ondc/utils/logger.util';
import { OOS } from '~/ondc/config/constants';

export const flow7Service = {
  async cancelOutOfStock(ondcOrderId: string): Promise<void> {
    const order = await orderModel.findByOndcOrderId(ondcOrderId);
    if (!order) throw OndcError.orderNotFound(ondcOrderId);

    await orderModel.transitionStatus(
      ondcOrderId,
      order.status,
      'CANCELLED',
      'Cancelled',
      'seller',
      JSON.stringify({ reason: 'out_of_stock' }),
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
      message_id: newMessageId(),
      timestamp: '',
    };

    const callbackPayload = {
      context: buildResponseContext(ctx, 'on_cancel'),
      message: { order: { ...ondcOrder, state: 'Cancelled' } },
      error: { type: OOS.TYPE, code: OOS.CODE, message: OOS.MSG },
    };

    const callbackUrl = becknService.buildCallbackUrl(order.bap_uri, 'on_cancel');
    await becknService.sendCallback(
      callbackUrl,
      'on_cancel',
      callbackPayload as any,
      order.transaction_id,
    );

    ondcLogger.info('Flow7: OOS cancel sent', { ondcOrderId });
  },
};
