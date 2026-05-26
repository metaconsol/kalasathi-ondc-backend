/**
 * Pushes anonymized transaction logs to the ONDC Observability API.
 * Fire-and-forget — never blocks the protocol flow.
 * Mirrors PHP push_log_to_observability() from lib.php.
 */

import axios from 'axios';
import { ondcEnv } from '~/config/ondc.config';
import { ondcLogger } from '~/ondc/utils/logger.util';
import { sanitizePii } from '~/ondc/utils/helpers';

export const observabilityService = {
  push(action: string, payload: Record<string, unknown>): void {
    if (!ondcEnv.observabilityToken) return;

    const sanitized = sanitizePii(payload);
    const body = { type: action, data: sanitized };

    axios
      .post(ondcEnv.observabilityUrl, body, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ondcEnv.observabilityToken}`,
        },
        timeout: 1_500,
      })
      .then(({ status }) => {
        ondcLogger.debug('Observability push success', { action, status });
      })
      .catch((err) => {
        ondcLogger.warn('Observability push failed (non-critical)', {
          action,
          err: err instanceof Error ? err.message : String(err),
        });
      });
  },
};
