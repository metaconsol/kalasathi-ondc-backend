/**
 * Beckn Service — handles sending outgoing Beckn callbacks (on_search, on_select, etc.)
 * to BAP callback URLs with proper ONDC Authorization headers.
 */

import axios from 'axios';
import { signRequest } from '~/ondc/utils/signature.util';
import { ondcLogger, logNetworkCall } from '~/ondc/utils/logger.util';
import { txnLogModel } from '~/ondc/models/log.model';
import { ondcNetwork } from '~/ondc/config/network.config';
import type { OndcApiResponse } from '~/ondc/types/api.types';
import { withRetry } from '~/ondc/utils/helpers';

export const becknService = {
  /** Send an outgoing callback to a BAP callback URL.
   *  Returns { statusCode, error } — never throws; callers decide what to do on failure. */
  async sendCallback(
    callbackUrl: string,
    action: string,
    payload: OndcApiResponse,
    transactionId: string,
  ): Promise<{ statusCode: number | undefined; error: string | undefined }> {
    const bodyJson = JSON.stringify(payload);
    const authHeader = signRequest(bodyJson);

    logNetworkCall('outbound', action, transactionId, payload);

    try {
      let lastStatus = 0;
      await withRetry(
        async () => {
          const response = await axios.post(callbackUrl, payload, {
            headers: { 'Content-Type': 'application/json', Authorization: authHeader },
            timeout: ondcNetwork.timeouts.callback,
          });
          lastStatus = response.status;
        },
        3,
        500,
      );
      return { statusCode: lastStatus, error: undefined };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const statusCode = (err as any)?.response?.status as number | undefined;
      ondcLogger.error('Callback send failed', { callbackUrl, action, transactionId, err: errMsg });
      return { statusCode, error: errMsg };
    }
  },

  /** Build the BAP callback URL for a given action */
  buildCallbackUrl(bapUri: string, action: string): string {
    return `${bapUri.replace(/\/$/, '')}/${action}`;
  },
};
