/** Admin Issues Controller */

import type { Request, Response } from 'express';
import { ApiResponse } from '~/lib/response';
import { issueModel } from '~/ondc/models/issue.model';
import type { IssueStatus } from '~/ondc/models/issue.model';

export async function listOndcIssues(req: Request, res: Response): Promise<void> {
  const { status, limit = '50', offset = '0' } = req.query as Record<string, string>;
  const isSeller = req.user?.role === 'SELLER';
  const sellerId = isSeller ? req.user?.id : undefined;
  const issues = await issueModel.list({
    ...(status ? { status: status as IssueStatus } : {}),
    ...(sellerId !== undefined ? { sellerId } : {}),
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
  });
  ApiResponse.success(res, 'ONDC issues', issues);
}
