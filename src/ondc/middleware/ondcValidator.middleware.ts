/**
 * Validates that incoming Beckn requests have a valid context structure.
 * Acts as a lightweight gate before controllers — full Zod schema validation
 * per action can be added here.
 *
 * TODO: Add per-action Zod schemas (search, select, init, confirm, etc.)
 */

import type { Request, Response, NextFunction } from 'express';
import { buildNack } from '~/ondc/utils/payload.builder';
import type { BecknContext } from '~/ondc/types/beckn.types';
import { BECKN_CORE_VERSION } from '~/ondc/config/constants';

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

export function ondcContextValidator(req: Request, res: Response, next: NextFunction): void {
  const body = req.body as { context?: Partial<BecknContext>; message?: unknown };

  if (!body.context) {
    res.status(400).json({ error: 'Missing context in request body' });
    return;
  }

  const ctx = body.context as Partial<BecknContext>;

  for (const field of REQUIRED_CONTEXT_FIELDS) {
    if (!ctx[field]) {
      const fakeCtx = { ...ctx, action: ctx.action ?? 'unknown' } as BecknContext;
      res.status(400).json(
        buildNack(fakeCtx, {
          type: 'CONTEXT-ERROR',
          code: '20000',
          path: `context.${field}`,
          message: `Missing required field: context.${field}`,
        }),
      );
      return;
    }
  }

  if (ctx.core_version !== BECKN_CORE_VERSION) {
    res.status(400).json(
      buildNack(ctx as BecknContext, {
        type: 'CONTEXT-ERROR',
        code: '20000',
        message: `Unsupported core_version: ${ctx.core_version}. Expected: ${BECKN_CORE_VERSION}`,
      }),
    );
    return;
  }

  if (!body.message) {
    res.status(400).json(
      buildNack(ctx as BecknContext, {
        type: 'CONTEXT-ERROR',
        code: '20000',
        message: 'Missing message in request body',
      }),
    );
    return;
  }

  next();
}
