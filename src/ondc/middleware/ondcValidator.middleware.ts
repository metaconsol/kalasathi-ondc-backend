/**
 * Validates that incoming Beckn requests have a valid context structure.
 * Acts as a lightweight gate before controllers — full Zod schema validation
 * per action can be added here.
 *
 * TODO: Add per-action Zod schemas (search, select, init, confirm, etc.)
 */

import type { Request, Response, NextFunction } from 'express';
import { buildNack, buildResponseContext } from '~/ondc/utils/payload.builder';
import type { BecknContext, BecknError } from '~/ondc/types/beckn.types';
import type { OndcApiResponse } from '~/ondc/types/api.types';
import { SUPPORTED_CORE_VERSIONS } from '~/ondc/config/constants';
import { becknService } from '~/ondc/services/beckn.service';
import { ondcLogger } from '~/ondc/utils/logger.util';

const REQUIRED_CONTEXT_FIELDS: (keyof BecknContext)[] = [
  'domain',
  'country',
  'city',
  'action',
  'core_version',
  'bap_id',
  'bap_uri',
  'transaction_id',
  'message_id',
  'timestamp',
];

function isIgmRoute(action: string): boolean {
  return action === 'issue' || action === 'issue_status';
}

function isIgmV2Context(ctx: Record<string, unknown>): boolean {
  const action = String(ctx.action ?? '').trim();
  if (!isIgmRoute(action)) return false;
  const version = String(ctx.version ?? ctx.core_version ?? '').trim();
  return version.startsWith('2') || !!ctx.location;
}

function hasIgmV2Location(ctx: Record<string, unknown>): boolean {
  const location = (ctx.location ?? {}) as Record<string, unknown>;
  const country = (location.country ?? {}) as Record<string, unknown>;
  const city = (location.city ?? {}) as Record<string, unknown>;
  return (
    typeof country.code === 'string' &&
    country.code.trim() !== '' &&
    typeof city.code === 'string' &&
    city.code.trim() !== ''
  );
}

function isBlank(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim().length === 0);
}

export function ondcContextValidator(req: Request, res: Response, next: NextFunction): void {
  const body = req.body as { context?: Partial<BecknContext>; message?: unknown };

  if (!body.context) {
    res.status(400).json({ error: 'Missing context in request body' });
    return;
  }

  const ctx = body.context as Partial<BecknContext>;

  // Trim string values in context
  for (const [key, value] of Object.entries(ctx)) {
    if (typeof value === 'string') {
      (ctx as Record<string, unknown>)[key] = value.trim();
    }
  }

  let validationError: {
    type: BecknError['type'];
    code: string;
    path?: string;
    message: string;
  } | null = null;

  const igmV2Context = isIgmV2Context(ctx as Record<string, unknown>);

  // 1. Validate required context fields
  if (igmV2Context) {
    const version = String(
      (ctx as Record<string, unknown>).version ?? ctx.core_version ?? '',
    ).trim();
    const commonFields = [
      'domain',
      'action',
      'bap_id',
      'bap_uri',
      'transaction_id',
      'message_id',
      'timestamp',
    ];
    for (const field of commonFields) {
      if (isBlank((ctx as Record<string, unknown>)[field])) {
        validationError = {
          type: 'CONTEXT-ERROR',
          code: '20000',
          path: `context.${field}`,
          message: `Missing required field: context.${field}`,
        };
        break;
      }
    }
    if (!validationError) {
      const hasRetailGeo = !isBlank(ctx.country) && !isBlank(ctx.city);
      const hasLocationGeo = hasIgmV2Location(ctx as Record<string, unknown>);
      if (!hasRetailGeo && !hasLocationGeo) {
        validationError = {
          type: 'CONTEXT-ERROR',
          code: '20000',
          path: 'context.location',
          message:
            'Missing required issue v2 location fields: context.location.country.code and context.location.city.code',
        };
      } else if (!version) {
        validationError = {
          type: 'CONTEXT-ERROR',
          code: '20000',
          path: 'context.version',
          message: 'Missing required field: context.version',
        };
      }
    }
  } else {
    for (const field of REQUIRED_CONTEXT_FIELDS) {
      if (isBlank(ctx[field])) {
        validationError = {
          type: 'CONTEXT-ERROR',
          code: '20000',
          path: `context.${field}`,
          message: `Missing required field: context.${field}`,
        };
        break;
      }
    }
  }

  // 2. Validate core version
  if (!validationError) {
    if (igmV2Context) {
      const version = String(
        (ctx as Record<string, unknown>).version ?? ctx.core_version ?? '',
      ).trim();
      if (!version.startsWith('2')) {
        validationError = {
          type: 'CONTEXT-ERROR',
          code: '20000',
          message: `Unsupported issue v2 version: ${version || 'undefined'}. Expected 2.0.0`,
        };
      }
    } else if (
      !ctx.core_version ||
      !SUPPORTED_CORE_VERSIONS.includes(
        ctx.core_version as (typeof SUPPORTED_CORE_VERSIONS)[number],
      )
    ) {
      validationError = {
        type: 'CONTEXT-ERROR',
        code: '20000',
        message: `Unsupported core_version: ${ctx.core_version}. Expected one of: ${SUPPORTED_CORE_VERSIONS.join(', ')}`,
      };
    }
  }

  // 3. Validate Domain (Only ONDC:RET10, ONDC:RET12, ONDC:RET16 are allowed)
  if (!validationError) {
    const domainRaw = String(ctx.domain ?? '')
      .toUpperCase()
      .trim();
    const isValidDomain =
      domainRaw.includes('RET10') || domainRaw.includes('RET12') || domainRaw.includes('RET16');

    if (!isValidDomain) {
      validationError = {
        type: 'CONTEXT-ERROR',
        code: '20000',
        message: `Unsupported domain: ${ctx.domain}`,
      };
    }
  }

  // 4. Validate message body presence
  if (!validationError && !body.message) {
    validationError = {
      type: 'CONTEXT-ERROR',
      code: '20000',
      message: 'Missing message in request body',
    };
  }

  // If there is a validation error, return NACK synchronously AND send callback asynchronously
  if (validationError) {
    const fakeCtx = { ...ctx, action: ctx.action ?? 'unknown' } as BecknContext;
    const syncNack = buildNack(fakeCtx, validationError);

    // Synchronous NACK response
    res.status(200).json(syncNack);

    // Asynchronous Outbound NACK Callback
    const bapUri = String(ctx.bap_uri ?? '').trim();
    const action = String(ctx.action ?? '').trim();

    if (bapUri && action) {
      const callbackAction = `on_${action}` as any;
      const callbackUrl = becknService.buildCallbackUrl(bapUri, callbackAction);
      const callbackContext = buildResponseContext(fakeCtx, callbackAction);
      const callbackPayload: OndcApiResponse<Record<string, never>> = {
        context: callbackContext,
        message: {},
        error: validationError,
      };

      setImmediate(async () => {
        try {
          await becknService.sendCallback(
            callbackUrl,
            callbackAction,
            callbackPayload,
            ctx.transaction_id ?? '',
          );
        } catch (err) {
          ondcLogger.error('NACK callback send failed', { err });
        }
      });
    }
    return;
  }

  next();
}
