/**
 * Flow 4B — Return flow: return rejected by seller.
 * PHP reference: generate_flow4b_return_update.php, Flow4B_update.php
 * TODO: Implement return rejection with reason.
 */

import { ondcLogger } from '~/ondc/utils/logger.util';

export const flow4BService = {
  async rejectReturn(ondcOrderId: string, reason: string): Promise<void> {
    // TODO: Update fulfillment to Return_Rejected, send /on_update to BAP
    ondcLogger.info('Flow4B: return rejected (TODO)', { ondcOrderId, reason });
  },
};
