/**
 * IGM (Issue & Grievance Management) Service — ONDC IGM 2.0 + 1.x.
 *
 * Pramaan Flow 6B (REFUND) — IGM 2.0.0 ring progression:
 *   20% OPEN + PROCESSING  →  40% INFO_REQUESTED  →  60% INFO_PROVIDED
 *   →  80% RESOLUTION_PROPOSED + resolutions[]  →  100% RESOLUTION_ACCEPTED / RESOLVED
 *   →  on_issue_status 100%  →  buyer CLOSE
 *
 * Flow 6a (IGM 1.0) unchanged — issue_actions.respondent_actions.
 */

import { randomUUID } from 'crypto';
import { customerTicketModel, type TicketMessage } from '~/ondc/models/customer_ticket.model';
import { becknService } from './beckn.service';
import { observabilityService } from './observability.service';
import { buildResponseContext, newMessageId } from '~/ondc/utils/payload.builder';
import { txnLogModel } from '~/ondc/models/log.model';
import { SELLER_PROFILE } from '~/ondc/config/constants';
import { ondcEnv } from '~/config/ondc.config';
import { ondcLogger } from '~/ondc/utils/logger.util';
import type { BecknContext } from '~/ondc/types/beckn.types';
import {
  appendIgmV2Action,
  buildIgmV1RespondentActions,
  buildIgmV2IssueStatusMessage,
  buildIgmV2OnIssueMessage,
  buildResolutionOptions,
  ensureSellerActor,
  extractIgmAttachments,
  extractIgmImages,
  extractTicketMirrorFields,
  formatResolutionOptionsChat,
  isIgmV2Issue,
  itemRefIdFromIssue,
  mergeInboundIgmIssue,
  orderIdFromRefs,
  parseIgmIssue,
  providerIdFromRefs,
  resolutionCodeFromAcceptedAction,
  respondentOrg,
  type IgmIssue,
} from '~/ondc/utils/igm.builder';

const RESPONDENT_ACTION = {
  PROCESSING: 'PROCESSING',
  INFO_REQUEST: 'NEED-MORE-INFO',
  RESOLVED: 'RESOLVED',
} as const;

const nowIso = () => new Date().toISOString();

type TicketRow = NonNullable<Awaited<ReturnType<typeof customerTicketModel.getById>>>;

function isIgmV2Row(row: TicketRow): boolean {
  if (row.core_version?.startsWith('2')) return true;
  const issue = parseIgmIssue(row);
  return issue ? isIgmV2Issue(issue) : false;
}

function chatFromIgmAction(
  action: any,
  actor: TicketMessage['actor'],
  name?: string,
): TicketMessage {
  const code = action.descriptor?.code;
  let message = action.descriptor?.short_desc || code || 'Action';
  const images: string[] = [];
  const attachments: Array<{ name: string; url?: string }> = [];

  if (code === 'INFO_PROVIDED') {
    message = 'Info provided from buyer app';
    const imgs = action.descriptor?.images ?? [];
    for (const i of Array.isArray(imgs) ? imgs : []) {
      if (typeof i === 'string') images.push(i);
      else if (i?.url) images.push(i.url);
    }
    const media = action.descriptor?.media ?? [];
    for (const m of Array.isArray(media) ? media : []) {
      if (m?.url) attachments.push({ name: m.content_type || 'application/pdf', url: m.url });
    }
  }
  if (code === 'RESOLUTION_ACCEPTED') {
    message = `RESOLUTION_ACCEPTED\nSelected: ${action.descriptor?.short_desc || 'resolution'}`;
  }

  return {
    id: randomUUID(),
    actor,
    sender_role: actor,
    sender_name: name ?? action.actor_details?.name,
    message,
    images,
    attachments,
    action_code: code,
    created_at: action.updated_at || nowIso(),
  };
}

async function pushOnIssue(
  row: TicketRow,
  extra: { resolution?: unknown; resolutionProvider?: unknown } = {},
): Promise<void> {
  if (!row.bap_uri) {
    ondcLogger.warn('IGM: no bap_uri on ticket; cannot push on_issue', { ticketId: row.ticket_id });
    return;
  }

  const ctxBase = {
    domain: row.domain || 'ONDC:RET12',
    country: row.country || 'IND',
    city: row.city || '*',
    action: 'on_issue' as const,
    core_version: row.core_version || '1.2.0',
    bap_id: row.bap_id || '',
    bap_uri: row.bap_uri || '',
    bpp_id: '',
    bpp_uri: '',
    transaction_id: row.txn_id,
    message_id: newMessageId(),
    timestamp: '',
    ttl: row.ttl || 'PT30S',
  };
  const responseContext = buildResponseContext(ctxBase, 'on_issue');

  let message: Record<string, unknown>;
  if (isIgmV2Row(row)) {
    const issue = parseIgmIssue(row);
    if (!issue) {
      ondcLogger.warn('IGM 2.0: missing payload_json', { ticketId: row.ticket_id });
      return;
    }
    message = buildIgmV2OnIssueMessage(issue);
  } else {
    const messages = customerTicketModel.parseMessages(row);
    message = {
      issue: {
        id: row.ticket_id,
        issue_actions: { respondent_actions: buildIgmV1RespondentActions(messages, row.domain) },
        ...(extra.resolution ? { resolution: extra.resolution } : {}),
        ...(extra.resolutionProvider ? { resolution_provider: extra.resolutionProvider } : {}),
        created_at: row.created_at ?? nowIso(),
        updated_at: nowIso(),
      },
    };
  }

  const payload = { context: responseContext, message };
  const { statusCode, error } = await becknService.sendCallback(
    becknService.buildCallbackUrl(row.bap_uri, 'on_issue'),
    'on_issue',
    payload as any,
    row.txn_id,
  );
  await txnLogModel.insert({
    transaction_id: row.txn_id,
    message_id: (responseContext as any).message_id,
    action: 'on_issue',
    direction: 'outbound',
    bap_id: row.bap_id,
    bpp_id: (responseContext as any).bpp_id ?? null,
    domain: row.domain,
    http_status: statusCode ?? null,
    ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
    payload_json: JSON.stringify(payload),
    error_message: error ?? null,
  });
  observabilityService.push('on_issue', payload);
}

async function handleIgmV2Issue(
  context: BecknContext,
  issue: IgmIssue,
  complainant: Record<string, any>,
  desc: Record<string, any>,
): Promise<void> {
  const issueId = String(issue['id'] ?? randomUUID());
  const images = extractIgmImages(issue, desc);
  const attachments = extractIgmAttachments(issue, desc);
  const domain = context.domain || 'ONDC:RET12';
  const descriptor = issue['descriptor'] ?? {
    code: issue['category'] ?? 'ITEM',
    short_desc: desc['short_desc'] ?? '',
    long_desc: desc['long_desc'] ?? '',
  };

  let row = await customerTicketModel.findByTicketId(issueId);

  if (!row) {
    const issueState: IgmIssue = structuredClone(issue);
    issueState['id'] = issueId;
    issueState['descriptor'] = descriptor;
    if (!issueState['created_at']) issueState['created_at'] = nowIso();
    if (!issueState['updated_at']) issueState['updated_at'] = issueState['created_at'];
    if (!issueState['level']) issueState['level'] = 'ISSUE';

    const sellerActorId = ensureSellerActor(issueState, domain);
    appendIgmV2Action(issueState, {
      code: 'PROCESSING',
      short_desc: 'Complaint is being processed',
      action_by: sellerActorId,
    });

    const openMsg: TicketMessage = {
      id: randomUUID(),
      actor: 'CONSUMER',
      sender_role: 'CONSUMER',
      sender_name: complainant?.person?.name ?? 'Customer',
      message: descriptor.short_desc || desc['short_desc'] || desc['long_desc'] || 'Issue raised',
      images,
      attachments,
      source: 'buyer app',
      action_code: 'OPEN',
      created_at: issueState['created_at'] as string,
    };

    await customerTicketModel.create({
      ticket_id: issueId,
      txn_id: context.transaction_id,
      order_id: orderIdFromRefs(issueState) ?? issue['order_details']?.['id'] ?? null,
      provider_id: providerIdFromRefs(issueState),
      domain,
      display_status: 'PROCESSING',
      customer_name: complainant?.person?.name ?? null,
      customer_phone: complainant?.contact?.phone ?? null,
      customer_email: complainant?.contact?.email ?? null,
      bap_id: context.bap_id,
      bap_uri: context.bap_uri,
      bpp_id: context.bpp_id ?? ondcEnv.subscriberId,
      bpp_uri: context.bpp_uri ?? null,
      country: context.country ?? 'IND',
      city: context.city ?? null,
      core_version: context.core_version ?? '2.0.0',
      ttl: context.ttl ?? null,
      descriptor_json: JSON.stringify(descriptor),
      descriptor_attachments_json: JSON.stringify({ images, attachments }),
      payload_json: JSON.stringify(issueState),
      refs_json: JSON.stringify(issueState['refs'] ?? []),
      actors_json: JSON.stringify(issueState['actors'] ?? []),
      messages: [openMsg],
      mirror: extractTicketMirrorFields(issueState, context.ttl ? { ttl: context.ttl } : undefined),
    });
    row = await customerTicketModel.findByTicketId(issueId);
    if (row) {
      const procAction = (issueState['actions'] as any[]).at(-1);
      await customerTicketModel.appendMessage(
        { id: row.id },
        chatFromIgmAction(procAction, 'SELLER', SELLER_PROFILE.BRAND_NAME || 'Support'),
        { displayStatus: 'PROCESSING', igmStatusRaw: 'PROCESSING' },
      );
      await customerTicketModel.saveIgmIssueState(row.id, issueState, {
        displayStatus: 'PROCESSING',
        igmStatusRaw: 'PROCESSING',
      });
    }
  } else {
    const stored = parseIgmIssue(row);
    if (!stored) return;
    const merged = mergeInboundIgmIssue(stored, issue);
    const sellerActorId = ensureSellerActor(merged, domain);
    const prevLen = (stored['actions'] as any[])?.length ?? 0;
    const newActions = (merged['actions'] as any[]).slice(prevLen);

    for (const action of newActions) {
      const isSeller = action.action_by === sellerActorId;
      const actorName = isSeller
        ? SELLER_PROFILE.BRAND_NAME || 'Support'
        : (complainant?.person?.name ?? row.customer_name ?? 'Buyer');
      await customerTicketModel.appendMessage(
        { id: row.id },
        chatFromIgmAction(action, isSeller ? 'SELLER' : 'CONSUMER', actorName),
      );
    }

    const lastCode = newActions.at(-1)?.descriptor?.code;
    let status = row.display_status;
    if (lastCode === 'CLOSED') status = 'CLOSED';
    else if (lastCode === 'RESOLVED') status = 'RESOLVED';
    else if (lastCode === 'INFO_PROVIDED' || lastCode === 'RESOLUTION_ACCEPTED')
      status = 'PROCESSING';

    const acceptedCode = resolutionCodeFromAcceptedAction(merged);
    if (acceptedCode) {
      await customerTicketModel.setSelectedResolution(row.id, acceptedCode, acceptedCode);
    }

    await customerTicketModel.saveIgmIssueState(row.id, merged, {
      displayStatus: status,
      igmStatusRaw: status,
      ...(merged['resolutions'] ? { resolutions: merged['resolutions'] as unknown[] } : {}),
    });
  }

  if (row) {
    const fresh = await customerTicketModel.getById(row.id);
    if (fresh) await pushOnIssue(fresh);
  }
}

async function handleIgmV1Issue(
  context: BecknContext,
  issue: IgmIssue,
  complainant: Record<string, any>,
  desc: Record<string, any>,
): Promise<void> {
  const issueId = String(issue['id'] ?? randomUUID());
  const images = extractIgmImages(issue, desc);
  const attachments = extractIgmAttachments(issue, desc);

  let row = await customerTicketModel.findByTicketId(issueId);

  if (!row) {
    const openMsg: TicketMessage = {
      id: randomUUID(),
      actor: 'CONSUMER',
      sender_role: 'CONSUMER',
      sender_name: complainant?.person?.name ?? 'Customer',
      message: desc['short_desc'] || desc['long_desc'] || 'Issue raised',
      images,
      attachments,
      source: 'buyer app',
      action_code: 'OPEN',
      created_at: nowIso(),
    };
    await customerTicketModel.create({
      ticket_id: issueId,
      txn_id: context.transaction_id,
      order_id: issue['order_details']?.['id'] ?? null,
      domain: context.domain,
      display_status: 'OPEN',
      customer_name: complainant?.person?.name ?? null,
      customer_phone: complainant?.contact?.phone ?? null,
      customer_email: complainant?.contact?.email ?? null,
      bap_id: context.bap_id,
      bap_uri: context.bap_uri,
      bpp_id: context.bpp_id ?? null,
      bpp_uri: context.bpp_uri ?? null,
      country: context.country ?? 'IND',
      city: context.city ?? null,
      core_version: context.core_version ?? null,
      ttl: context.ttl ?? null,
      descriptor_json: JSON.stringify(desc),
      descriptor_attachments_json: JSON.stringify({ images, attachments }),
      payload_json: JSON.stringify(issue),
      messages: [openMsg],
      mirror: extractTicketMirrorFields(issue, context.ttl ? { ttl: context.ttl } : undefined),
    });
    row = await customerTicketModel.findByTicketId(issueId);
    if (row) {
      await customerTicketModel.appendMessage(
        { id: row.id },
        {
          id: randomUUID(),
          actor: 'SELLER',
          sender_role: 'SELLER',
          sender_name: SELLER_PROFILE.BRAND_NAME || 'Support',
          message: 'Complaint is being processed',
          action_code: RESPONDENT_ACTION.PROCESSING,
          created_at: nowIso(),
        },
        { displayStatus: 'PROCESSING', igmStatusRaw: 'PROCESSING' },
      );
    }
  } else {
    const actions: any[] = issue['issue_actions']?.['complainant_actions'] ?? [];
    const latest = actions[actions.length - 1];
    const code = String(latest?.complainant_action ?? 'INFO_PROVIDED');
    const key = `${code}|${latest?.updated_at ?? ''}`;
    const existing = customerTicketModel.parseMessages(row);
    if (!existing.some((m) => (m as any)._key === key)) {
      await customerTicketModel.appendMessage({ id: row.id }, {
        id: randomUUID(),
        actor: 'CONSUMER',
        sender_role: 'CONSUMER',
        sender_name: complainant?.person?.name ?? 'Customer',
        message: latest?.short_desc || `Buyer action: ${code}`,
        images: extractIgmImages(latest ?? issue, desc),
        attachments: extractIgmAttachments(latest ?? issue, desc),
        source: 'buyer app',
        action_code: code,
        created_at: nowIso(),
        _key: key,
      } as TicketMessage);
      if (code === 'CLOSE') await customerTicketModel.setStatus(row.id, 'CLOSED', 'CLOSED');
    }
    const storedPayload = row.payload_json ? JSON.parse(row.payload_json) : issue;
    const mergedIssue = { ...storedPayload, ...issue };
    await customerTicketModel.saveIgmIssueState(row.id, mergedIssue, {
      displayStatus: code === 'CLOSE' ? 'CLOSED' : row.display_status,
      ...(code === 'CLOSE' ? { igmStatusRaw: 'CLOSED' } : {}),
    });
  }

  if (row) {
    const fresh = await customerTicketModel.getById(row.id);
    if (fresh) await pushOnIssue(fresh);
  }
}

function consumerFromIssue(issue: IgmIssue): Record<string, any> {
  const consumer = (issue['actors'] as any[] | undefined)?.find((a) => a.type === 'CONSUMER');
  return consumer?.info ?? issue['complainant_info'] ?? {};
}

export const igmService = {
  async handleIssue(context: BecknContext, message: Record<string, any>): Promise<void> {
    const issue = (message['issue'] ?? {}) as IgmIssue;
    const v2 = isIgmV2Issue(issue);
    const complainant = v2 ? consumerFromIssue(issue) : (issue['complainant_info'] ?? {});
    const desc = (issue['descriptor'] ?? issue['description'] ?? {}) as Record<string, any>;

    if (v2) {
      await handleIgmV2Issue(context, issue, complainant, desc);
    } else {
      await handleIgmV1Issue(context, issue, complainant, desc);
    }
    ondcLogger.info('IGM issue handled', {
      issueId: issue['id'],
      txn: context.transaction_id,
      v2: isIgmV2Issue(issue),
    });
  },

  async handleIssueStatus(context: BecknContext, message: { issue_id: string }): Promise<void> {
    const row = await customerTicketModel.findByTicketId(message.issue_id);
    if (!row) {
      ondcLogger.warn('IGM: issue_status for unknown issue', { issueId: message.issue_id });
      return;
    }

    await customerTicketModel.appendMessage(
      { id: row.id },
      {
        id: randomUUID(),
        actor: 'CONSUMER',
        sender_role: 'CONSUMER',
        sender_name: row.customer_name ?? 'Buyer',
        message: 'Buyer requested issue status update',
        action_code: 'ISSUE_STATUS',
        source: 'buyer app',
        created_at: nowIso(),
      },
    );

    const responseContext = buildResponseContext(
      { ...context, action: 'on_issue_status' } as any,
      'on_issue_status',
    );

    let msg: Record<string, unknown>;
    if (isIgmV2Row(row)) {
      const issue = parseIgmIssue(row);
      if (!issue) return;
      const issueOut: Record<string, unknown> = { ...issue, updated_at: nowIso() };
      if (row.display_status === 'RESOLVED' || issue['status'] === 'RESOLVED') {
        issueOut['resolution'] = issue['resolution'] ?? {
          short_desc: 'Resolution Completed',
          action_triggered: row.selected_resolution_code || 'REFUND',
        };
      }
      msg = buildIgmV2IssueStatusMessage(issueOut);
    } else {
      const messages = customerTicketModel.parseMessages(row);
      msg = {
        issue: {
          id: row.ticket_id,
          issue_actions: { respondent_actions: buildIgmV1RespondentActions(messages, row.domain) },
          ...(row.selected_resolution_code
            ? {
                resolution: {
                  short_desc: 'Resolution provided',
                  action_triggered: row.selected_resolution_code,
                },
                resolution_provider: {
                  respondent_info: { type: 'INTERFACING', organization: respondentOrg(row.domain) },
                },
              }
            : {}),
          created_at: row.created_at ?? nowIso(),
          updated_at: nowIso(),
        },
      };
    }

    const payload = { context: responseContext, message: msg };
    const { statusCode, error } = await becknService.sendCallback(
      becknService.buildCallbackUrl(
        String(context.bap_uri ?? row.bap_uri ?? ''),
        'on_issue_status',
      ),
      'on_issue_status',
      payload as any,
      context.transaction_id,
    );
    await txnLogModel.insert({
      transaction_id: context.transaction_id,
      message_id: (responseContext as any).message_id,
      action: 'on_issue_status',
      direction: 'outbound',
      bap_id: context.bap_id,
      bpp_id: (responseContext as any).bpp_id ?? null,
      domain: context.domain,
      http_status: statusCode ?? null,
      ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
      payload_json: JSON.stringify(payload),
      error_message: error ?? null,
    });
    observabilityService.push('on_issue_status', payload);

    if (isIgmV2Row(row)) {
      const fresh = await customerTicketModel.getById(row.id);
      if (fresh) {
        const issue = parseIgmIssue(fresh);
        if (issue) {
          const sellerActorId = ensureSellerActor(issue, fresh.domain);
          appendIgmV2Action(issue, {
            code: 'PROCESSING',
            short_desc: `Issue status: ${fresh.display_status}`,
            action_by: sellerActorId,
          });
          await customerTicketModel.saveIgmIssueState(fresh.id, issue);
          await customerTicketModel.appendMessage(
            { id: fresh.id },
            {
              id: randomUUID(),
              actor: 'SELLER',
              sender_role: 'SELLER',
              sender_name: SELLER_PROFILE.BRAND_NAME || 'Support',
              message: `Issue status: ${fresh.display_status}`,
              action_code: 'PROCESSING',
              created_at: nowIso(),
            },
          );
        }
      }
    }
  },

  async sellerAction(
    ticketId: number,
    kind: 'message' | 'processing' | 'info_request' | 'resolution_options' | 'resolve' | 'close',
    body: {
      message?: string;
      note?: string;
      resolution_note?: string;
      status?: string;
      refund_amount?: string;
    },
  ): Promise<void> {
    const row = await customerTicketModel.getById(ticketId);
    if (!row) throw new Error(`IGM ticket ${ticketId} not found`);

    const text = body.message ?? body.resolution_note ?? body.note ?? '';

    if (isIgmV2Row(row)) {
      const issue = parseIgmIssue(row);
      if (!issue) throw new Error('IGM 2.0 issue state missing');
      const domain = row.domain || 'ONDC:RET12';
      const sellerActorId = ensureSellerActor(issue, domain);
      let displayStatus = row.display_status;
      let resolutions: IgmIssue[] | undefined;
      let chatText = text;

      switch (kind) {
        case 'info_request':
          appendIgmV2Action(issue, {
            code: 'INFO_REQUESTED',
            short_desc: text || 'Please provide additional information',
            action_by: sellerActorId,
            name: `INFO${String((issue['actions'] as any[]).filter((a) => a.descriptor?.code === 'INFO_REQUESTED').length + 1).padStart(3, '0')}`,
          });
          displayStatus = 'PROCESSING';
          break;
        case 'resolution_options': {
          const itemRef = itemRefIdFromIssue(issue);
          resolutions = buildResolutionOptions(sellerActorId, itemRef, body.refund_amount);
          issue['resolutions'] = resolutions;
          const parentId = resolutions[0]!.id as string;
          appendIgmV2Action(issue, {
            code: 'RESOLUTION_PROPOSED',
            short_desc: text || 'Resolution options proposed',
            action_by: sellerActorId,
            ref_id: parentId,
            ref_type: 'RESOLUTIONS',
          });
          chatText = formatResolutionOptionsChat();
          displayStatus = 'PROCESSING';
          break;
        }
        case 'resolve': {
          const code = row.selected_resolution_code || 'REFUND';
          appendIgmV2Action(issue, {
            code: 'RESOLVED',
            short_desc: text || 'Resolution Completed',
            action_by: sellerActorId,
          });
          issue['resolution'] = {
            short_desc: text || 'Resolution Completed',
            long_desc: text || 'Resolution Completed',
            action_triggered: code,
          };
          chatText = text
            ? `${text}\nResolution: ${code}`
            : `Resolution Completed\nResolution: ${code}`;
          displayStatus = 'RESOLVED';
          break;
        }
        case 'close':
          appendIgmV2Action(issue, {
            code: 'CLOSED',
            short_desc: text || 'Issue closed',
            action_by: sellerActorId,
          });
          displayStatus = 'CLOSED';
          break;
        case 'processing':
          appendIgmV2Action(issue, {
            code: 'PROCESSING',
            short_desc: text || 'Complaint is being processed',
            action_by: sellerActorId,
          });
          displayStatus = 'PROCESSING';
          break;
        case 'message':
        default:
          if (text) {
            appendIgmV2Action(issue, {
              code: 'PROCESSING',
              short_desc: text,
              action_by: sellerActorId,
            });
          }
          break;
      }

      const lastAction = (issue['actions'] as any[]).at(-1);
      if (lastAction && (kind !== 'message' || text)) {
        await customerTicketModel.appendMessage(
          { id: row.id },
          {
            id: randomUUID(),
            actor: 'SELLER',
            sender_role: 'SELLER',
            sender_name: SELLER_PROFILE.BRAND_NAME || 'Support',
            message: chatText || lastAction.descriptor?.short_desc || kind,
            action_code: lastAction.descriptor?.code,
            created_at: lastAction.updated_at,
          },
          { displayStatus, igmStatusRaw: displayStatus },
        );
      }

      await customerTicketModel.saveIgmIssueState(row.id, issue, {
        displayStatus,
        igmStatusRaw: displayStatus,
        ...(resolutions ? { resolutions } : {}),
      });
    } else {
      let actionCode: string | undefined;
      let displayStatus: string | undefined;
      let resolution: Record<string, unknown> | undefined;

      switch (kind) {
        case 'processing':
          actionCode = RESPONDENT_ACTION.PROCESSING;
          displayStatus = 'PROCESSING';
          break;
        case 'info_request':
          actionCode = RESPONDENT_ACTION.INFO_REQUEST;
          displayStatus = 'PROCESSING';
          break;
        case 'resolution_options':
          actionCode = RESPONDENT_ACTION.PROCESSING;
          displayStatus = 'PROCESSING';
          break;
        case 'resolve':
          actionCode = RESPONDENT_ACTION.RESOLVED;
          displayStatus = 'RESOLVED';
          resolution = {
            short_desc: text || 'Issue resolved',
            long_desc: text || 'Issue resolved',
            action_triggered: row.selected_resolution_code || 'REFUND',
          };
          break;
        case 'close':
          displayStatus = 'CLOSED';
          break;
        default:
          break;
      }

      if (text || actionCode) {
        await customerTicketModel.appendMessage(
          { id: row.id },
          {
            id: randomUUID(),
            actor: 'SELLER',
            sender_role: 'SELLER',
            sender_name: SELLER_PROFILE.BRAND_NAME || 'Support',
            message: text,
            ...(actionCode ? { action_code: actionCode } : {}),
            created_at: nowIso(),
          },
          displayStatus ? { displayStatus, igmStatusRaw: displayStatus } : {},
        );
      }

      const fresh = await customerTicketModel.getById(row.id);
      if (fresh) {
        await pushOnIssue(
          fresh,
          resolution
            ? {
                resolution,
                resolutionProvider: {
                  respondent_info: { type: 'INTERFACING', organization: respondentOrg(row.domain) },
                },
              }
            : {},
        );
      }
      ondcLogger.info('IGM seller action', { ticketId, kind });
      return;
    }

    const fresh = await customerTicketModel.getById(ticketId);
    if (fresh) await pushOnIssue(fresh);
    ondcLogger.info('IGM seller action', { ticketId, kind, v2: true });
  },

  async resolveIssue(issueId: string, resolution: { short_desc: string }): Promise<void> {
    const row = await customerTicketModel.findByTicketId(issueId);
    if (row) await this.sellerAction(row.id, 'resolve', { resolution_note: resolution.short_desc });
  },
};
