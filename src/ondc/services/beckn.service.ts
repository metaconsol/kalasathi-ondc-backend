/**
 * Beckn Service — handles sending outgoing Beckn callbacks (on_search, on_select, etc.)
 * to BAP callback URLs with proper ONDC Authorization headers.
 */

import axios from 'axios';
import { signRequest, bodyDigest } from '~/ondc/utils/signature.util';
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
    extraHeaders?: Record<string, string>,
  ): Promise<{ statusCode: number | undefined; error: string | undefined }> {
    const bodyJson = JSON.stringify(payload);
    const digest = bodyDigest(bodyJson);
    const authHeader = signRequest(bodyJson);
    const messageId = (payload as any)?.context?.message_id ?? 'unknown';
    const startTime = Date.now();

    const requestHeaders = {
      'Content-Type': 'application/json',
      Digest: digest,
      Authorization: authHeader,
      ...extraHeaders,
    };

    try {
      let lastStatus = 0;
      let lastResponseBody: unknown;
      let lastResponseHeaders: Record<string, string> = {};

      await withRetry(
        async () => {
          const response = await axios.post(callbackUrl, payload, {
            headers: requestHeaders,
            timeout: ondcNetwork.timeouts.callback,
          });
          lastStatus = response.status;
          lastResponseBody = response.data;
          lastResponseHeaders = response.headers as Record<string, string>;
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
        requestHeaders,
        httpStatus: lastStatus,
        responseBody: lastResponseBody,
        responseHeaders: lastResponseHeaders,
        elapsedMs: Date.now() - startTime,
      });

      return { statusCode: lastStatus, error: undefined };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const statusCode = (err as any)?.response?.status as number | undefined;
      const responseBody = (err as any)?.response?.data;
      const responseHeaders = (err as any)?.response?.headers as Record<string, string> | undefined;

      logBecknOutgoing({
        action,
        transactionId,
        messageId,
        url: callbackUrl,
        body: payload,
        requestHeaders,
        ...(statusCode !== undefined && { httpStatus: statusCode }),
        responseBody,
        ...(responseHeaders && { responseHeaders }),
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
