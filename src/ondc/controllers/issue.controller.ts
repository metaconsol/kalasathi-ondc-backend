/** IGM Issue Controller */

import type { Request, Response } from 'express';
import { buildAck } from '~/ondc/utils/payload.builder';
import { igmService } from '~/ondc/services/igm.service';
import { handleUnexpected } from '~/ondc/utils/error.handler';
import type { BecknContext } from '~/ondc/types/beckn.types';

export async function handleIssue(req: Request, res: Response): Promise<void> {
  const { context, message } = req.body as { context: BecknContext; message: Record<string, any> };
  res.json(buildAck(context));
  setImmediate(async () => {
    try {
      await igmService.handleIssue(context, message);
    } catch (err) {
      handleUnexpected(err, `issue:${context.transaction_id}`);
    }
  });
}

export async function handleIssueStatus(req: Request, res: Response): Promise<void> {
  const { context, message } = req.body as { context: BecknContext; message: { issue_id: string } };
  res.json(buildAck(context));
  setImmediate(async () => {
    try {
      await igmService.handleIssueStatus(context, message);
    } catch (err) {
      handleUnexpected(err, `issue_status:${context.transaction_id}`);
    }
  });
}
