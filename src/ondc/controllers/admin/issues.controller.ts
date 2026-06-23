/** Admin Issues Controller */

import type { Request, Response } from 'express';
import { ApiResponse, AppError } from '~/lib/response';
import { issueModel } from '~/ondc/models/issue.model';
import type {
  IssueDisplayStatus,
  IssueStatus,
  OndcIssueAction,
  OndcIssueRow,
} from '~/ondc/models/issue.model';

const toCanonicalStatus = (status: string): IssueStatus => {
  switch (status) {
    case 'OPEN':
      return 'OPEN';
    case 'PROCESSING':
    case 'IN_PROGRESS':
    case 'WAITING_CUSTOMER':
      return 'PROCESSING';
    case 'RESOLVED':
      return 'RESOLVED';
    case 'CLOSED':
    case 'REJECTED':
      return 'CLOSED';
    default:
      throw new AppError(`Unsupported issue status: ${status}`, 400);
  }
};

const parseResolution = (value: string | null) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const getDisplayStatus = (issue: OndcIssueRow): IssueDisplayStatus => {
  const actions = issueModel.parseActions(issue.actions_json);
  const statusAction = [...actions]
    .reverse()
    .find((entry) => entry.type === 'status' && entry.status);
  if (statusAction?.status) return statusAction.status;
  if (issue.status === 'PROCESSING') return 'PROCESSING';
  return issue.status;
};

const buildMessages = (actions: OndcIssueAction[], issue: OndcIssueRow) => {
  const base = [
    {
      id: `created-${issue.id}`,
      sender_role: 'BUYER',
      message: issue.long_desc || issue.short_desc,
      created_at: issue.created_at,
    },
  ];

  const actionMessages = actions
    .filter((entry) =>
      ['message', 'info_request', 'resolution_options', 'resolved', 'closed'].includes(entry.type),
    )
    .map((entry, index) => ({
      id: `${entry.type}-${index}`,
      sender_role: entry.actor_role,
      message: entry.message ?? entry.note ?? '',
      created_at: entry.created_at,
    }));

  return [...base, ...actionMessages];
};

const buildHistory = (actions: OndcIssueAction[], issue: OndcIssueRow) => {
  const createdEntry = {
    id: `history-created-${issue.id}`,
    status: 'OPEN',
    note: 'Issue created',
    created_at: issue.created_at,
  };

  const actionHistory = actions
    .filter(
      (entry) => entry.type === 'status' || entry.type === 'resolved' || entry.type === 'closed',
    )
    .map((entry, index) => ({
      id: `history-${index}`,
      status:
        entry.type === 'resolved'
          ? 'RESOLVED'
          : entry.type === 'closed'
            ? 'CLOSED'
            : (entry.status ?? getDisplayStatus(issue)),
      note: entry.note ?? entry.message ?? null,
      created_at: entry.created_at,
    }));

  return [createdEntry, ...actionHistory];
};

const presentIssue = (issue: OndcIssueRow) => {
  const actions = issueModel.parseActions(issue.actions_json);
  const displayStatus = getDisplayStatus(issue);
  const lastAction = actions[actions.length - 1] ?? null;

  return {
    id: issue.id,
    ticket_id: issue.issue_id,
    ticket_no: issue.issue_id,
    order_id: issue.order_id,
    order_no: issue.order_id,
    transaction_id: issue.transaction_id,
    customer_name: issue.bap_id,
    customer_phone: '',
    issue_category_code: issue.category,
    issue_category_label: issue.category,
    reason_name: issue.short_desc,
    short_desc: issue.short_desc,
    long_desc: issue.long_desc,
    priority: 'MEDIUM',
    status: displayStatus,
    display_status: displayStatus,
    last_action_code: lastAction?.type ?? null,
    resolution: parseResolution(issue.resolution_json),
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    history: buildHistory(actions, issue),
    messages: buildMessages(actions, issue),
    raw: issue,
  };
};

async function getScopedIssue(req: Request, id: number) {
  const isSeller = req.user?.role === 'SELLER';
  const sellerId = isSeller ? req.user?.id : undefined;
  const issue = await issueModel.findById(id, sellerId);
  if (!issue) throw new AppError('ONDC issue not found', 404);
  return issue;
}

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
  ApiResponse.success(res, 'ONDC issues', issues.map(presentIssue));
}

export async function getOndcIssue(req: Request, res: Response): Promise<void> {
  const issue = await getScopedIssue(req, Number(req.params['id']));
  ApiResponse.success(res, 'ONDC issue details', presentIssue(issue));
}

export async function addOndcIssueMessage(req: Request, res: Response): Promise<void> {
  const issue = await getScopedIssue(req, Number(req.params['id']));
  const { message, type = 'message' } = req.body as {
    message?: string;
    type?: OndcIssueAction['type'];
  };
  if (!message || message.trim() === '') throw new AppError('Message is required', 400);

  await issueModel.appendAction(issue.issue_id, {
    type,
    actor: String(req.user?.id ?? 'admin'),
    actor_role: String(req.user?.role ?? 'ADMIN'),
    message: message.trim(),
    created_at: new Date().toISOString(),
  });

  const updated = await getScopedIssue(req, Number(req.params['id']));
  ApiResponse.success(res, 'ONDC issue message added', presentIssue(updated));
}

export async function updateOndcIssueStatus(req: Request, res: Response): Promise<void> {
  const issue = await getScopedIssue(req, Number(req.params['id']));
  const { status, note } = req.body as { status?: IssueDisplayStatus; note?: string | null };
  if (!status) throw new AppError('Status is required', 400);

  await issueModel.updateStatus(issue.issue_id, toCanonicalStatus(status));
  await issueModel.appendAction(issue.issue_id, {
    type: 'status',
    actor: String(req.user?.id ?? 'admin'),
    actor_role: String(req.user?.role ?? 'ADMIN'),
    status,
    note: note?.trim() || null,
    created_at: new Date().toISOString(),
  });

  const updated = await getScopedIssue(req, Number(req.params['id']));
  ApiResponse.success(res, 'ONDC issue status updated', presentIssue(updated));
}

export async function resolveOndcIssue(req: Request, res: Response): Promise<void> {
  const issue = await getScopedIssue(req, Number(req.params['id']));
  const { resolution_note } = req.body as { resolution_note?: string };
  const resolutionText = resolution_note?.trim() || 'Issue resolved.';

  await issueModel.updateStatus(
    issue.issue_id,
    'RESOLVED',
    JSON.stringify({ short_desc: resolutionText, long_desc: resolutionText }),
  );
  await issueModel.appendAction(issue.issue_id, {
    type: 'resolved',
    actor: String(req.user?.id ?? 'admin'),
    actor_role: String(req.user?.role ?? 'ADMIN'),
    status: 'RESOLVED',
    note: resolutionText,
    created_at: new Date().toISOString(),
  });

  const updated = await getScopedIssue(req, Number(req.params['id']));
  ApiResponse.success(res, 'ONDC issue resolved', presentIssue(updated));
}

export async function closeOndcIssue(req: Request, res: Response): Promise<void> {
  const issue = await getScopedIssue(req, Number(req.params['id']));
  const { note } = req.body as { note?: string | null };
  const closeNote = note?.trim() || 'Issue closed.';

  await issueModel.updateStatus(issue.issue_id, 'CLOSED');
  await issueModel.appendAction(issue.issue_id, {
    type: 'closed',
    actor: String(req.user?.id ?? 'admin'),
    actor_role: String(req.user?.role ?? 'ADMIN'),
    status: 'CLOSED',
    note: closeNote,
    created_at: new Date().toISOString(),
  });

  const updated = await getScopedIssue(req, Number(req.params['id']));
  ApiResponse.success(res, 'ONDC issue closed', presentIssue(updated));
}
