/**
 * ONDC IGM payload builders — IGM 2.0.0 (Pramaan Flow 6B+) and IGM 1.x fallback.
 *
 * Flow 6B expects IGM 2.0: message.update_target + issue.actions[] with
 * descriptor.code (INFO_REQUESTED, RESOLUTION_PROPOSED, …) and issue.resolutions[]
 * for refund/replacement/cancel/no-action options.
 */

import { randomUUID } from 'crypto';
import { ondcEnv } from '~/config/ondc.config';
import { SELLER_PROFILE } from '~/ondc/config/constants';

export type IgmIssue = Record<string, any>;

const nowIso = () => new Date().toISOString();

export function isIgmV2Issue(issue: IgmIssue): boolean {
  return Array.isArray(issue['actions']) || Array.isArray(issue['refs']);
}

export function orderIdFromRefs(issue: IgmIssue): string | null {
  const ref = (issue['refs'] as any[] | undefined)?.find((r) => r.ref_type === 'ORDER');
  return ref?.ref_id ? String(ref.ref_id) : null;
}

export function itemRefIdFromIssue(issue: IgmIssue): string {
  const item = (issue['refs'] as any[] | undefined)?.find((r) => r.ref_type === 'ITEM');
  return item?.ref_id ? String(item.ref_id) : 'I1';
}

export function providerIdFromRefs(issue: IgmIssue): string | null {
  const ref = (issue['refs'] as any[] | undefined)?.find((r) => r.ref_type === 'PROVIDER');
  return ref?.ref_id ? String(ref.ref_id) : null;
}

/** Normalize images from IGM 1.x description or IGM 2.x descriptor.images. */
export function extractIgmImages(issue: IgmIssue, desc?: Record<string, any>): string[] {
  const images: string[] = [];
  const sources = [
    ...(Array.isArray(issue['descriptor']?.images) ? issue['descriptor'].images : []),
    ...(Array.isArray(desc?.images) ? desc.images : []),
    ...(Array.isArray(issue['description']?.images) ? issue['description'].images : []),
  ];
  for (const i of sources) {
    if (typeof i === 'string') images.push(i);
    else if (i?.url) images.push(i.url);
  }
  return images;
}

export function extractIgmAttachments(
  issue: IgmIssue,
  desc?: Record<string, any>,
): Array<{ name: string; url?: string }> {
  const attachments: Array<{ name: string; url?: string }> = [];
  const add =
    issue['descriptor']?.additional_desc ??
    desc?.additional_desc ??
    issue['description']?.additional_desc;
  if (add?.url) attachments.push({ name: add.content_type || 'attachment', url: add.url });
  const media = issue['descriptor']?.media;
  if (Array.isArray(media)) {
    for (const m of media) {
      if (m?.url) attachments.push({ name: m.content_type || 'media', url: m.url });
    }
  }
  return attachments;
}

function sellerActorInfo(domain: string) {
  return {
    org: { name: `${ondcEnv.subscriberId}::${domain}` },
    contact: {
      phone: SELLER_PROFILE.SUPPORT_PHONE || '9886098860',
      email: SELLER_PROFILE.SUPPORT_EMAIL || 'support@odopmartmp.com',
    },
    person: { name: SELLER_PROFILE.SUPPORT_NAME || SELLER_PROFILE.BRAND_NAME || 'Support' },
  };
}

/** IGM 1.x respondent org block. */
export function respondentOrg(domain = 'ONDC:RET12') {
  return sellerActorInfo(domain);
}

/** Ensure COUNTERPARTY_NP (seller) actor exists; return its id. */
export function ensureSellerActor(issue: IgmIssue, domain: string): string {
  const actors: any[] = [...(issue['actors'] ?? [])];
  let seller = actors.find((a) => a.type === 'COUNTERPARTY_NP' || a.type === 'SELLER');
  if (!seller) {
    seller = {
      id: `NP-${ondcEnv.subscriberId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`,
      type: 'COUNTERPARTY_NP',
      info: sellerActorInfo(domain),
    };
    actors.push(seller);
    issue['actors'] = actors;
  }
  const ids = new Set<string>(issue['respondent_ids'] ?? []);
  ids.add(seller.id);
  issue['respondent_ids'] = [...ids];
  return seller.id;
}

export function parseIgmIssue(row: { payload_json?: string | null }): IgmIssue | null {
  if (!row.payload_json) return null;
  try {
    const parsed = JSON.parse(row.payload_json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Merge inbound /issue into stored IGM 2.0 issue — preserve created_at + append new actions. */
export function mergeInboundIgmIssue(stored: IgmIssue, inbound: IgmIssue): IgmIssue {
  const storedActionIds = new Set((stored['actions'] as any[] | undefined)?.map((a) => a.id) ?? []);
  const newActions = ((inbound['actions'] as any[]) ?? []).filter(
    (a) => !storedActionIds.has(a.id),
  );
  const merged: IgmIssue = {
    ...stored,
    ...inbound,
    created_at: stored['created_at'] ?? inbound['created_at'],
    actions: [...((stored['actions'] as any[]) ?? []), ...newActions],
    actors: (inbound['actors'] as any[])?.length ? inbound['actors'] : stored['actors'],
    refs: (inbound['refs'] as any[])?.length ? inbound['refs'] : stored['refs'],
    descriptor: {
      ...((stored['descriptor'] as object) ?? {}),
      ...((inbound['descriptor'] as object) ?? {}),
    },
    expected_response_time: inbound['expected_response_time'] ?? stored['expected_response_time'],
    expected_resolution_time:
      inbound['expected_resolution_time'] ?? stored['expected_resolution_time'],
    source_id: inbound['source_id'] ?? stored['source_id'],
    complainant_id: inbound['complainant_id'] ?? stored['complainant_id'],
    respondent_ids: inbound['respondent_ids']?.length
      ? inbound['respondent_ids']
      : stored['respondent_ids'],
    level: inbound['level'] ?? stored['level'] ?? 'ISSUE',
  };
  if (inbound['last_action_id']) merged['last_action_id'] = inbound['last_action_id'];
  if (inbound['status']) merged['status'] = inbound['status'];
  if (inbound['resolutions']) merged['resolutions'] = inbound['resolutions'];
  merged['updated_at'] = inbound['updated_at'] ?? nowIso();
  return merged;
}

/** Find resolution code accepted by buyer (RESOLUTION_ACCEPTED action → resolutions[]). */
export function resolutionCodeFromAcceptedAction(issue: IgmIssue): string | null {
  const actions = (issue['actions'] as any[]) ?? [];
  const accepted = [...actions].reverse().find((a) => a.descriptor?.code === 'RESOLUTION_ACCEPTED');
  if (!accepted?.ref_id) return null;
  const resolutions = (issue['resolutions'] as any[]) ?? [];
  const picked = resolutions.find((r) => r.id === accepted.ref_id);
  return picked?.descriptor?.code ?? null;
}

/** Resolution id + label from buyer's RESOLUTION_ACCEPTED action. */
export function resolutionPickFromAcceptedAction(issue: IgmIssue): {
  id: string | null;
  code: string | null;
  label: string | null;
} {
  const actions = (issue['actions'] as any[]) ?? [];
  const accepted = [...actions].reverse().find((a) => a.descriptor?.code === 'RESOLUTION_ACCEPTED');
  if (!accepted) return { id: null, code: null, label: null };
  const resolutions = (issue['resolutions'] as any[]) ?? [];
  const picked = accepted.ref_id ? resolutions.find((r) => r.id === accepted.ref_id) : null;
  return {
    id: picked?.id ?? accepted.ref_id ?? null,
    code: picked?.descriptor?.code ?? resolutionCodeFromAcceptedAction(issue),
    label: picked?.descriptor?.short_desc ?? accepted.descriptor?.short_desc ?? null,
  };
}

function clipStr(value: unknown, max: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value).slice(0, max);
}

function tagGroup(issue: IgmIssue, groupCode: string): any | undefined {
  const tags = issue['tags'];
  if (!Array.isArray(tags)) return undefined;
  return tags.find((t: any) => t.descriptor?.code === groupCode || t.code === groupCode);
}

function tagPair(
  issue: IgmIssue,
  groupCode: string,
  itemCode?: string,
): { code: string | null; label: string | null } {
  const group = tagGroup(issue, groupCode);
  if (!group?.list?.length) return { code: null, label: null };
  const list = group.list as any[];
  const item = itemCode
    ? list.find((l) => l.descriptor?.code === itemCode || l.code === itemCode)
    : list[0];
  if (!item) return { code: null, label: null };
  const code = item.descriptor?.code ?? item.code ?? item.value ?? null;
  const label = item.value ?? item.descriptor?.short_desc ?? item.descriptor?.name ?? code;
  return { code: clipStr(code, 10), label: clipStr(label, 100) };
}

const RESOLUTION_ACTION_CODES = new Set(['RESOLUTION_PROPOSED', 'RESOLUTION_ACCEPTED', 'RESOLVED']);

const COMPLAINANT_ACTION_CODES = new Set([
  'OPEN',
  'INFO_PROVIDED',
  'RESOLUTION_ACCEPTED',
  'CLOSED',
  'ESCALATED',
]);

/** Denormalized ticket columns mirrored from inbound IGM issue + context. */
export interface TicketMirrorFields {
  issue_level: string | null;
  igm_status_raw: string | null;
  issue_type_code: string | null;
  issue_type_label: string | null;
  issue_category_code: string | null;
  issue_category_label: string | null;
  issue_source_type_code: string | null;
  issue_source_type_label: string | null;
  provider_type_code: string | null;
  provider_type_label: string | null;
  gro_type_code: string | null;
  gro_type_label: string | null;
  complainant_action_code: string | null;
  complainant_action_label: string | null;
  resolution_action_code: string | null;
  resolution_action_label: string | null;
  customer_actor_id: string | null;
  source_id: string | null;
  complainant_id: string | null;
  respondent_ids_json: string;
  resolver_ids_json: string;
  reason_code: string | null;
  reason_name: string | null;
  reason_short_desc: string | null;
  reason_long_desc: string | null;
  last_action_id: string | null;
  last_action_code: string | null;
  last_action_by: string | null;
  last_actor_name: string | null;
  resolutions_count: number;
  open_info_request_count: number;
  selected_resolution_id: string | null;
  selected_resolution_code: string | null;
  selected_resolution_label: string | null;
}

export function extractTicketMirrorFields(
  issue: IgmIssue,
  context?: { ttl?: string },
): TicketMirrorFields {
  const v2 = isIgmV2Issue(issue);
  const descriptor = (issue['descriptor'] as Record<string, any>) ?? {};
  const desc = (issue['description'] as Record<string, any>) ?? {};
  const consumer = (issue['actors'] as any[] | undefined)?.find((a) => a.type === 'CONSUMER');

  const issueTypeTag = tagPair(issue, 'ISSUE_TYPE');
  const issueSourceTag = tagPair(issue, 'ISSUE_SOURCE');
  const providerTypeTag = tagPair(issue, 'PROVIDER_TYPE');
  const groTypeTag = tagPair(issue, 'GRO_TYPE');

  const issueLevel = clipStr(issue['level'] ?? issue['issue_type'], 30);
  const issueTypeCode = issueTypeTag.code ?? clipStr(issue['issue_type'] ?? issue['level'], 10);
  const issueTypeLabel = issueTypeTag.label ?? clipStr(issue['issue_type'] ?? issue['level'], 100);

  const sourceObj = issue['source'] as Record<string, any> | undefined;
  const issueSourceCode =
    issueSourceTag.code ?? clipStr(sourceObj?.type, 10) ?? (issue['source_id'] ? 'CONSUMER' : null);
  const issueSourceLabel =
    issueSourceTag.label ?? clipStr(sourceObj?.type ?? sourceObj?.network_participant_id, 100);

  const categoryCode = clipStr(descriptor.code ?? issue['sub_category'] ?? issue['category'], 10);
  const categoryLabel = clipStr(descriptor.short_desc ?? issue['category'], 100);

  const reasonCode = clipStr(descriptor.code ?? issue['sub_category'] ?? issue['category'], 120);
  const reasonShort = descriptor.short_desc ?? desc.short_desc ?? null;
  const reasonLong = descriptor.long_desc ?? desc.long_desc ?? null;

  const sourceId = clipStr(issue['source_id'] ?? consumer?.id, 120);
  const complainantId = clipStr(issue['complainant_id'], 120);
  const customerActorId = sourceId ?? clipStr(consumer?.id, 120);

  const respondentIds = issue['respondent_ids'] ?? [];
  const resolverIds = issue['resolver_ids'] ?? [];

  let complainantActionCode: string | null = null;
  let complainantActionLabel: string | null = null;
  let resolutionActionCode: string | null = null;
  let resolutionActionLabel: string | null = null;
  let lastAction: any = null;

  if (v2) {
    const actions = (issue['actions'] as any[]) ?? [];
    const respondentSet = new Set((respondentIds as string[]) ?? []);
    lastAction = actions.at(-1) ?? null;

    for (let i = actions.length - 1; i >= 0; i--) {
      const a = actions[i];
      const code = a.descriptor?.code;
      if (
        !complainantActionCode &&
        (COMPLAINANT_ACTION_CODES.has(code) || !respondentSet.has(a.action_by))
      ) {
        if (COMPLAINANT_ACTION_CODES.has(code) || !respondentSet.has(a.action_by)) {
          complainantActionCode = clipStr(code, 10);
          complainantActionLabel = clipStr(a.descriptor?.short_desc, 100);
        }
      }
      if (!resolutionActionCode && RESOLUTION_ACTION_CODES.has(code)) {
        resolutionActionCode = clipStr(code, 10);
        resolutionActionLabel = clipStr(a.descriptor?.short_desc, 100);
      }
      if (complainantActionCode && resolutionActionCode) break;
    }
  } else {
    const compActions = issue['issue_actions']?.['complainant_actions'] ?? [];
    const lastComp = compActions.at(-1);
    if (lastComp) {
      complainantActionCode = clipStr(lastComp.complainant_action, 10);
      complainantActionLabel = clipStr(lastComp.short_desc, 100);
    }
    const respActions = issue['issue_actions']?.['respondent_actions'] ?? [];
    const lastRes = [...respActions]
      .reverse()
      .find((r: any) =>
        ['RESOLVED', 'RESOLUTION_PROPOSED', 'PROCESSING'].includes(r.respondent_action),
      );
    if (lastRes) {
      resolutionActionCode = clipStr(lastRes.respondent_action, 10);
      resolutionActionLabel = clipStr(lastRes.short_desc, 100);
    }
    const resolution = issue['resolution'] as Record<string, any> | undefined;
    if (resolution?.action_triggered) {
      resolutionActionCode = clipStr(resolution.action_triggered, 10);
      resolutionActionLabel = clipStr(resolution.short_desc ?? resolution.action_triggered, 100);
    }
  }

  const resolutions = (issue['resolutions'] as unknown[]) ?? [];
  const infoRequested = v2
    ? ((issue['actions'] as any[]) ?? []).filter((a) => a.descriptor?.code === 'INFO_REQUESTED')
        .length
    : ((issue['issue_actions'] as any)?.['respondent_actions'] ?? []).filter(
        (r: any) => r.respondent_action === 'NEED-MORE-INFO' || r.respondent_action === 'GET_INFO',
      ).length;

  const resolutionPick = v2
    ? resolutionPickFromAcceptedAction(issue)
    : {
        id: null as string | null,
        code: clipStr((issue['resolution'] as any)?.action_triggered, 100),
        label: clipStr((issue['resolution'] as any)?.short_desc, 255),
      };

  const statusRaw = clipStr(issue['status'], 50);

  return {
    issue_level: issueLevel,
    igm_status_raw: statusRaw,
    issue_type_code: issueTypeCode,
    issue_type_label: issueTypeLabel,
    issue_category_code: categoryCode,
    issue_category_label: categoryLabel,
    issue_source_type_code: issueSourceCode,
    issue_source_type_label: issueSourceLabel,
    provider_type_code:
      providerTypeTag.code ?? clipStr(issue['order_details']?.['provider_id'], 10),
    provider_type_label:
      providerTypeTag.label ?? clipStr(issue['order_details']?.['provider_id'], 100),
    gro_type_code: groTypeTag.code,
    gro_type_label: groTypeTag.label,
    complainant_action_code: complainantActionCode,
    complainant_action_label: complainantActionLabel,
    resolution_action_code: resolutionActionCode,
    resolution_action_label: resolutionActionLabel,
    customer_actor_id: customerActorId,
    source_id: sourceId,
    complainant_id: complainantId,
    respondent_ids_json: JSON.stringify(respondentIds),
    resolver_ids_json: JSON.stringify(resolverIds),
    reason_code: reasonCode,
    reason_name: clipStr(reasonShort, 255),
    reason_short_desc: reasonShort,
    reason_long_desc: reasonLong,
    last_action_id: clipStr(issue['last_action_id'] ?? lastAction?.id, 120),
    last_action_code: clipStr(lastAction?.descriptor?.code ?? complainantActionCode, 100),
    last_action_by: clipStr(lastAction?.action_by, 120),
    last_actor_name: clipStr(lastAction?.actor_details?.name, 255),
    resolutions_count: resolutions.length,
    open_info_request_count: infoRequested,
    selected_resolution_id: resolutionPick.id,
    selected_resolution_code: resolutionPick.code,
    selected_resolution_label: resolutionPick.label,
  };
}

export function appendIgmV2Action(
  issue: IgmIssue,
  params: {
    code: string;
    short_desc: string;
    action_by: string;
    actor_name?: string;
    name?: string;
    ref_id?: string;
    ref_type?: string;
    extra_descriptor?: Record<string, unknown>;
  },
): string {
  const actionId = `A${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const ts = nowIso();
  const action: Record<string, unknown> = {
    id: actionId,
    descriptor: {
      code: params.code,
      short_desc: params.short_desc,
      ...(params.name ? { name: params.name } : {}),
      ...(params.extra_descriptor ?? {}),
    },
    updated_at: ts,
    action_by: params.action_by,
    actor_details: { name: params.actor_name ?? SELLER_PROFILE.BRAND_NAME ?? 'Support' },
  };
  if (params.ref_id) {
    action['ref_id'] = params.ref_id;
    if (params.ref_type) action['ref_type'] = params.ref_type;
  }
  issue['actions'] = [...((issue['actions'] as any[]) ?? []), action];
  issue['last_action_id'] = actionId;
  issue['updated_at'] = ts;

  if (params.code === 'RESOLVED') issue['status'] = 'RESOLVED';
  else if (params.code === 'CLOSED') issue['status'] = 'CLOSED';
  else if (issue['status'] === 'OPEN') issue['status'] = 'PROCESSING';

  return actionId;
}

const RESOLUTION_OPTIONS = [
  { code: 'REFUND', short_desc: 'Refund Offered', tagCode: 'REFUND' },
  { code: 'REPLACEMENT', short_desc: 'Replacement Offered', tagCode: 'REPLACEMENT' },
  { code: 'CANCEL', short_desc: 'Cancellation Offered', tagCode: 'CANCEL' },
  { code: 'NO_ACTION', short_desc: 'No Action Taken', tagCode: 'NO_ACTION' },
] as const;

/**
 * Full resolution options for Pramaan modal (REFUND / REPLACEMENT / CANCEL / NO_ACTION).
 * Matches on_issue9 + Pramaan Flow 6B UI.
 */
export function buildResolutionOptions(
  proposedBy: string,
  itemRefId: string,
  refundAmount?: string,
): IgmIssue[] {
  const ts = nowIso();
  const parentId = `R_PARENT_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const parent = {
    id: parentId,
    descriptor: {
      code: 'PARENT',
      short_desc: 'PROVIDING RESOLUTION OPTIONS. PLEASE SELECT ONE',
    },
    updated_at: ts,
    proposed_by: proposedBy,
  };
  const children = RESOLUTION_OPTIONS.map((opt, idx) => ({
    id: `R${idx + 1}_${randomUUID().replace(/-/g, '').slice(0, 6)}`,
    ref_id: parentId,
    ref_type: 'PARENT',
    descriptor: { code: opt.code, short_desc: opt.short_desc },
    updated_at: ts,
    proposed_by: proposedBy,
    tags: [
      {
        descriptor: { code: 'RESOLUTION_DETAILS' },
        list: [
          { descriptor: { code: 'ITEM' }, value: itemRefId },
          {
            descriptor: { code: opt.tagCode },
            value: opt.code === 'REFUND' && refundAmount ? refundAmount : '',
          },
        ],
      },
    ],
  }));
  return [parent, ...children];
}

/** Human-readable resolution options block for admin chat UI. */
export function formatResolutionOptionsChat(): string {
  return [
    'PROVIDING RESOLUTION OPTIONS',
    ...RESOLUTION_OPTIONS.map((o) => `${o.code}: ${o.short_desc}`),
  ].join('\n');
}

export function buildIgmV2OnIssueMessage(issue: IgmIssue): Record<string, unknown> {
  return {
    update_target: [{ path: 'issue.actions', action: 'APPENDED' }],
    issue: sanitizeIgmIssueForOutbound(issue),
  };
}

export function buildIgmV2IssueStatusMessage(issue: IgmIssue): Record<string, unknown> {
  return {
    update_target: [{ path: 'issue.actions', action: 'APPENDED' }],
    issue: sanitizeIgmIssueForOutbound(issue),
  };
}

/** Echo full issue from DB — never drop descriptor, refs, actors, resolutions. */
function sanitizeIgmIssueForOutbound(issue: IgmIssue): IgmIssue {
  const out: IgmIssue = { ...issue };
  if (!out['level']) out['level'] = 'ISSUE';
  if (!out['created_at']) out['created_at'] = nowIso();
  if (!out['updated_at']) out['updated_at'] = nowIso();
  if (!out['expected_response_time']) out['expected_response_time'] = { duration: 'PT2H' };
  if (!out['expected_resolution_time']) out['expected_resolution_time'] = { duration: 'P1D' };
  return out;
}

/** @deprecated use buildResolutionOptions */
export const buildRefundResolutions = buildResolutionOptions;

/** IGM 1.x respondent_actions (legacy Flow 6a). */
export function buildIgmV1RespondentActions(
  messages: Array<{ actor: string; action_code?: string; message: string; created_at: string }>,
  domain: string,
): any[] {
  const org = respondentOrg(domain);
  return messages
    .filter((m) => m.actor === 'SELLER' && m.action_code)
    .map((m) => {
      let code = m.action_code!;
      if (code === 'GET_INFO') code = 'NEED-MORE-INFO';
      if (code === 'RESOLUTION_PROPOSED' || code === 'CLOSED') code = 'PROCESSING';
      return {
        respondent_action: code,
        short_desc: m.message,
        updated_at: m.created_at,
        updated_by: org,
        cascaded_level: 1,
      };
    });
}
