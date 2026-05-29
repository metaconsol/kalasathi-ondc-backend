/**
 * Beckn Service — handles sending outgoing Beckn callbacks (on_search, on_select, etc.)
 * to BAP callback URLs with proper ONDC Authorization headers.
 */

import axios from 'axios';
import { signRequest } from '~/ondc/utils/signature.util';
import { ondcLogger, logBecknOutgoing } from '~/ondc/utils/logger.util';
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
    const messageId = (payload as any)?.context?.message_id ?? 'unknown';
    const startTime = Date.now();

    try {
      let lastStatus = 0;
      let lastResponseBody: unknown;

      await withRetry(
        async () => {
          const response = await axios.post(callbackUrl, payload, {
            headers: { 'Content-Type': 'application/json', Authorization: authHeader },
            timeout: ondcNetwork.timeouts.callback,
          });
          lastStatus = response.status;
          lastResponseBody = response.data;
        },
        3,
        500,
      );

      logBecknOutgoing({
        action,
        transactionId,
        messageId,
        url: callbackUrl,
        body: payload,
        httpStatus: lastStatus,
        responseBody: lastResponseBody,
        elapsedMs: Date.now() - startTime,
      });

      return { statusCode: lastStatus, error: undefined };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const statusCode = (err as any)?.response?.status as number | undefined;
      const responseBody = (err as any)?.response?.data;

      logBecknOutgoing({
        action,
        transactionId,
        messageId,
        url: callbackUrl,
        body: payload,
        ...(statusCode !== undefined && { httpStatus: statusCode }),
        responseBody,
        error: errMsg,
        elapsedMs: Date.now() - startTime,
      });

      ondcLogger.error('Callback send failed', { callbackUrl, action, transactionId, err: errMsg });
      return { statusCode, error: errMsg };
    }
  },

  /** Build the BAP callback URL for a given action */
  buildCallbackUrl(bapUri: string, action: string): string {
    return `${bapUri.replace(/\/$/, '')}/${action}`;
  },
};
