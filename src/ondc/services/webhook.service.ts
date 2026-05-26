/**
 * Webhook Service — processes incoming callbacks from ONDC network/BAP.
 * (Not to be confused with outgoing callbacks we send — that's becknService)
 *
 * Currently a placeholder for future webhook processing needs.
 * TODO: Add webhook event queuing, idempotency checks.
 */

import { ondcLogger } from '~/ondc/utils/logger.util';

export const webhookService = {
  /** Generic handler for any inbound callback we receive */
  async process(action: string, payload: unknown): Promise<void> {
    ondcLogger.info('Webhook received', { action, payload });
    // TODO: Route to appropriate handler based on action
    // e.g. on_receiver_recon → settlementService.processReceiverRecon
  },
};
