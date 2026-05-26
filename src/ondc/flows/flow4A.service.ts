/**
 * Flow 4A — Return flow: buyer initiates return.
 * PHP reference: generate_flow4a_on_status.php, generate_flow4a_return_update.php, Flow4A_update.php
 * TODO: Implement full return lifecycle with /on_update and /on_status callbacks.
 */

import { ondcLogger } from '~/ondc/utils/logger.util';

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
};
