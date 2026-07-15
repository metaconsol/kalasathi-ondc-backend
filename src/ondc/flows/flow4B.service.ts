/**
 * Flow 4B — Return flow: return rejected by seller.
 * PHP reference: generate_flow4b_return_update.php, Flow4B_update.php
 */

import { fulfillmentModel } from '~/ondc/models/fulfillment.model';
import { orderModel } from '~/ondc/models/order.model';
import { flow4AService } from '~/ondc/flows/flow4A.service';
import { ondcLogger } from '~/ondc/utils/logger.util';
import { OndcError } from '~/ondc/utils/error.handler';

export const flow4BService = {
  /** Reject a buyer return and notify the BAP through an unsolicited /on_update. */
  async rejectReturn(
    ondcOrderId: string,
    reason: string,
    fulfillmentId = 'F1',
    fulfillmentType?: string,
  ): Promise<void> {
    const order = await orderModel.findByOndcOrderId(ondcOrderId);
    if (!order) throw OndcError.orderNotFound(ondcOrderId);

    await fulfillmentModel.updateState(ondcOrderId, fulfillmentId, 'Return_Rejected', {
      ...(fulfillmentType ? { fulfillmentType } : {}),
    });
    await orderModel.transitionStatus(
      ondcOrderId,
      order.status,
      'RETURNED',
      'Return_Rejected',
      'seller',
      `Return rejected: ${reason}`,
    );
    await flow4AService.pushOnUpdate(ondcOrderId, 'Return_Rejected');
    ondcLogger.info('Flow4B: return rejected and on_update sent', {
      ondcOrderId,
      fulfillmentId,
      fulfillmentType,
      reason,
    });
  },
};
