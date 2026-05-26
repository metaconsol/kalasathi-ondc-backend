/**
 * Flow 3B — Cancellation after order is in transit (post-pickup, pre-delivery).
 * PHP reference: generate_flow3b_on_cancel.php, generate_flow3b_on_status.php
 * TODO: Implement with cancellation fee calculation.
 */

import { ondcLogger } from '~/ondc/utils/logger.util';

export const flow3BService = {
  async cancelInTransit(ondcOrderId: string, reasonId: string): Promise<void> {
    // TODO: Similar to flow3A but with cancellation_fee applied
    ondcLogger.info('Flow3B: cancel in transit (TODO)', { ondcOrderId, reasonId });
  },
};
