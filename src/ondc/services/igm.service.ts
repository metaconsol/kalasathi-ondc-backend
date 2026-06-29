/**
 * IGM (Issue & Grievance Management) Service — ONDC IGM flow.
 *
 * Inbound (from buyer NP):  /issue, /issue_status
 * Outbound (we push):       /on_issue, /on_issue_status
 *
 * Everything is persisted into `ondc_customer_ticket` (chat in actions_json) so
 * the admin Tickets page shows the full transcript.
 *
 * ⚠️ ONDC ships no IGM JSON-schema in the 1.2.5 log-validation-utility, so the
 * exact respondent_action codes below are the one thing to confirm against your
 * Pramaan IGM run — they're all isolated in RESPONDENT_ACTION for easy tweaking.
 */

import { randomUUID } from 'crypto';
import { customerTicketModel, type TicketMessage } from '~/ondc/models/customer_ticket.model';
import { becknService } from './beckn.service';
import { observabilityService } from './observability.service';
import { buildResponseContext } from '~/ondc/utils/payload.builder';
import { txnLogModel } from '~/ondc/models/log.model';
import { SELLER_PROFILE } from '~/ondc/config/constants';
import { ondcEnv } from '~/config/ondc.config';
import { ondcLogger } from '~/ondc/utils/logger.util';
import type { BecknContext } from '~/ondc/types/beckn.types';

/** ONDC IGM respondent_action codes — CONFIRM against Pramaan IGM 2.0.0. */
const RESPONDENT_ACTION = {
  PROCESSING: 'PROCESSING',
  INFO_REQUEST: 'GET_INFO', // "need more info" from the seller
  RESOLUTION_PROPOSED: 'RESOLUTION_PROPOSED',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
} as const;

const nowIso = () => new Date().toISOString();

function respondentOrg() {
  return {
    org: { name: `${ondcEnv.subscriberId}::ONDC:RET12` },
    contact: {
      phone: SELLER_PROFILE.SUPPORT_PHONE || '9886098860',
      email: SELLER_PROFILE.SUPPORT_EMAIL || 'support@odopmartmp.com',
    },
    person: { name: SELLER_PROFILE.SUPPORT_NAME || SELLER_PROFILE.BRAND_NAME || 'Support' },
  };
}

/** Pull image URLs + file attachments out of an issue description / action. */
function extractAttachments(node: any): {
  images: string[];
  attachments: Array<{ name: string; url?: string }>;
} {
  const images: string[] = [];
  const attachments: Array<{ name: string; url?: string }> = [];
  const imgs = node?.images ?? node?.description?.images ?? [];
  for (const i of Array.isArray(imgs) ? imgs : []) {
    if (typeof i === 'string') images.push(i);
    else if (i?.url) images.push(i.url);
  }
  const add = node?.additional_desc ?? node?.description?.additional_desc;
  if (add?.url) attachments.push({ name: add.content_type || 'attachment', url: add.url });
  return { images, attachments };
}

/** Rebuild the ONDC respondent_actions list from stored SELLER messages. */
function buildRespondentActions(messages: TicketMessage[]): any[] {
  return messages
    .filter((m) => m.actor === 'SELLER' && m.action_code)
    .map((m) => ({
      respondent_action: m.action_code,
      short_desc: m.message,
      updated_at: m.created_at,
      updated_by: respondentOrg(),
      cascaded_level: 1,
    }));
}

type TicketRow = NonNullable<Awaited<ReturnType<typeof customerTicketModel.getById>>>;

async function pushOnIssue(
  row: TicketRow,
  extra: { resolution?: unknown; resolutionProvider?: unknown } = {},
): Promise<void> {
  if (!row.bap_uri) {
    ondcLogger.warn('IGM: no bap_uri on ticket; cannot push on_issue', { ticketId: row.ticket_id });
    return;
  }
  const messages = customerTicketModel.parseMessages(row);
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
    message_id: '',
    timestamp: '',
  };
  const responseContext = buildResponseContext(ctxBase, 'on_issue');
  const payload = {
    context: responseContext,
    message: {
      issue: {
        id: row.ticket_id,
        issue_actions: { respondent_actions: buildRespondentActions(messages) },
        ...(extra.resolution ? { resolution: extra.resolution } : {}),
        ...(extra.resolutionProvider ? { resolution_provider: extra.resolutionProvider } : {}),
        created_at: row.created_at ?? nowIso(),
        updated_at: nowIso(),
      },
    },
  };
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

export const igmService = {
  /** Inbound /issue — buyer raises / updates an issue. */
  async handleIssue(context: BecknContext, message: Record<string, any>): Promise<void> {
    const issue = (message['issue'] ?? {}) as Record<string, any>;
    const issueId = String(issue['id'] ?? randomUUID());
    const complainant = issue['complainant_info'] ?? {};
    const desc = issue['description'] ?? {};
    const { images, attachments } = extractAttachments(issue);

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
        igm_status_raw: 'OPEN',
        issue_category_code: issue['category'] ?? null,
        issue_category_label: issue['category'] ?? null,
        customer_name: complainant?.person?.name ?? null,
        customer_phone: complainant?.contact?.phone ?? null,
        customer_email: complainant?.contact?.email ?? null,
        reason_name: desc['short_desc'] ?? null,
        reason_short_desc: desc['short_desc'] ?? null,
        bap_id: context.bap_id,
        bap_uri: context.bap_uri,
        bpp_id: context.bpp_id ?? null,
        country: context.country ?? 'IND',
        city: context.city ?? null,
        core_version: context.core_version ?? null,
        descriptor_attachments_json: JSON.stringify({ images, attachments }),
        messages: [openMsg],
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
        const att = extractAttachments(latest ?? issue);
        await customerTicketModel.appendMessage({ id: row.id }, {
          id: randomUUID(),
          actor: 'CONSUMER',
          sender_role: 'CONSUMER',
          sender_name: complainant?.person?.name ?? 'Customer',
          message: latest?.short_desc || `Buyer action: ${code}`,
          images: att.images,
          attachments: att.attachments,
          source: 'buyer app',
          action_code: code,
          created_at: nowIso(),
          _key: key,
        } as TicketMessage);
        if (code === 'CLOSE') await customerTicketModel.setStatus(row.id, 'CLOSED', 'CLOSED');
      }
    }

    if (row) {
      const fresh = await customerTicketModel.getById(row.id);
      if (fresh) await pushOnIssue(fresh);
    }
    ondcLogger.info('IGM issue handled', { issueId, txn: context.transaction_id });
  },

  /** Inbound /issue_status — buyer asks for the current status. */
  async handleIssueStatus(context: BecknContext, message: { issue_id: string }): Promise<void> {
    const row = await customerTicketModel.findByTicketId(message.issue_id);
    if (!row) {
      ondcLogger.warn('IGM: issue_status for unknown issue', { issueId: message.issue_id });
      return;
    }
    const messages = customerTicketModel.parseMessages(row);
    const responseContext = buildResponseContext(
      { ...context, action: 'on_issue_status' } as any,
      'on_issue_status',
    );
    const payload = {
      context: responseContext,
      message: {
        issue: {
          id: row.ticket_id,
          issue_actions: { respondent_actions: buildRespondentActions(messages) },
          ...(row.selected_resolution_code
            ? {
                resolution: {
                  short_desc: 'Resolution provided',
                  action_triggered: row.selected_resolution_code,
                },
                resolution_provider: {
                  respondent_info: { type: 'INTERFACING', organization: respondentOrg() },
                },
              }
            : {}),
          created_at: row.created_at ?? nowIso(),
          updated_at: nowIso(),
        },
      },
    };
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
  },

  /**
   * Seller-initiated IGM action from the admin Tickets UI — appends the seller
   * message and pushes /on_issue to the buyer NP.
   */
  async sellerAction(
    ticketId: number,
    kind: 'message' | 'processing' | 'info_request' | 'resolution_options' | 'resolve' | 'close',
    body: { message?: string; note?: string; resolution_note?: string; status?: string },
  ): Promise<void> {
    const row = await customerTicketModel.getById(ticketId);
    if (!row) throw new Error(`IGM ticket ${ticketId} not found`);

    let actionCode: string | undefined;
    let displayStatus: string | undefined;
    let resolution: Record<string, unknown> | undefined;
    const text = body.message ?? body.resolution_note ?? body.note ?? '';

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
        actionCode = RESPONDENT_ACTION.RESOLUTION_PROPOSED;
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
        actionCode = RESPONDENT_ACTION.CLOSED;
        displayStatus = 'CLOSED';
        break;
      case 'message':
      default:
        actionCode = undefined;
        break;
    }

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

    const fresh = await customerTicketModel.getById(row.id);
    if (fresh) {
      await pushOnIssue(
        fresh,
        resolution
          ? {
              resolution,
              resolutionProvider: {
                respondent_info: { type: 'INTERFACING', organization: respondentOrg() },
              },
            }
          : {},
      );
    }
    ondcLogger.info('IGM seller action', { ticketId, kind });
  },

  /** Back-compat: resolve via issue_id string. */
  async resolveIssue(issueId: string, resolution: { short_desc: string }): Promise<void> {
    const row = await customerTicketModel.findByTicketId(issueId);
    if (row) await this.sellerAction(row.id, 'resolve', { resolution_note: resolution.short_desc });
  },
};
