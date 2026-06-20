/**
 * IGM (Issue & Grievance Management) Service.
 * Handles /issue, /issue_status flows per ONDC IGM v1.0.
 *
 * TODO: Implement full IGM spec with escalation tiers (L1/L2/L3).
 * Reference: issue.php, issue_status.php, issue_close.php from PHP project.
 */

import { issueModel } from '~/ondc/models/issue.model';
import { customerTicketModel } from '~/ondc/models/customerTicket.model';
import { providerModel } from '~/ondc/models/provider.model';
import { becknService } from './beckn.service';
import { buildResponseContext } from '~/ondc/utils/payload.builder';
import { ondcLogger } from '~/ondc/utils/logger.util';
import type { BecknContext } from '~/ondc/types/beckn.types';
import { txnLogModel } from '~/ondc/models/log.model';

const asArray = <T = any>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const asObject = <T = Record<string, any>>(value: unknown): T | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : null;
const stringify = (value: unknown) => (value == null ? null : JSON.stringify(value));
const safeParse = <T = any>(value: string | null | undefined): T | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

function slugActorId(prefix: string, seed: string) {
  const cleaned = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${prefix}_${cleaned || 'unknown'}`;
}

function buildRefsFromOrderDetails(issue: Record<string, any>) {
  const refs: Record<string, any>[] = [];
  const orderDetails = asObject<Record<string, any>>(issue['order_details']);
  const items = asArray<Record<string, any>>(orderDetails?.['items']);
  const fulfillments = asArray<Record<string, any>>(orderDetails?.['fulfillments']);

  if (orderDetails?.['id']) {
    refs.push({ ref_id: orderDetails['id'], ref_type: 'ORDER' });
  }
  if (orderDetails?.['provider_id']) {
    refs.push({ ref_id: orderDetails['provider_id'], ref_type: 'PROVIDER' });
  }
  for (const fulfillment of fulfillments) {
    if (!fulfillment?.['id']) continue;
    refs.push({ ref_id: fulfillment['id'], ref_type: 'FULFILLMENT' });
  }
  for (const item of items) {
    if (!item?.['id']) continue;
    const quantity = item?.['quantity'];
    const itemRef: Record<string, any> = { ref_id: item['id'], ref_type: 'ITEM' };
    if (quantity != null) {
      itemRef['tags'] = [
        {
          descriptor: { code: 'message.order.items' },
          list: [
            {
              descriptor: { code: 'quantity.selected.count' },
              value: String(quantity),
            },
          ],
        },
      ];
    }
    refs.push(itemRef);
  }

  return refs;
}

function buildActorsFromIssue(issue: Record<string, any>, context: BecknContext) {
  const actors: Record<string, any>[] = [];
  const complainantInfo = asObject<Record<string, any>>(issue['complainant_info']);
  const source = asObject<Record<string, any>>(issue['source']);
  const consumerName = complainantInfo?.['person']?.['name'] ?? null;
  const consumerPhone = complainantInfo?.['contact']?.['phone'] ?? null;
  const consumerEmail = complainantInfo?.['contact']?.['email'] ?? null;
  const sourceId =
    issue['source_id'] ??
    complainantInfo?.['person']?.['id'] ??
    (consumerPhone
      ? slugActorId('consumer', consumerPhone)
      : consumerEmail
        ? slugActorId('consumer', consumerEmail)
        : consumerName
          ? slugActorId('consumer', consumerName)
          : null);
  const complainantId =
    (issue['complainant_id'] ?? source?.['network_participant_id'] ?? context.bap_id)
      ? slugActorId(
          'inp',
          String(issue['complainant_id'] ?? source?.['network_participant_id'] ?? context.bap_id),
        )
      : null;

  if (complainantInfo || source) {
    if (sourceId) {
      actors.push({
        id: sourceId,
        type: source?.['type'] ?? 'CONSUMER',
        info: {
          org:
            complainantInfo?.['org'] ??
            (context.bap_id ? { name: `${context.bap_id}::${context.domain}` } : undefined),
          person: complainantInfo?.['person'] ?? undefined,
          contact: complainantInfo?.['contact'] ?? undefined,
        },
      });
    }

    if (complainantId) {
      actors.push({
        id: complainantId,
        type: 'INTERFACING_NP',
        info: {
          org: context.bap_id ? { name: `${context.bap_id}::${context.domain}` } : undefined,
          person: complainantInfo?.['person'] ?? undefined,
          contact: complainantInfo?.['contact'] ?? undefined,
        },
      });
    }
  }

  return actors;
}

function buildActionsFromIssue(
  issue: Record<string, any>,
  ids: { complainantId?: string | null; respondentId?: string | null; sourceId?: string | null },
) {
  const issueActions = asObject<Record<string, any>>(issue['issue_actions']);
  const complainantActions = asArray<Record<string, any>>(issueActions?.['complainant_actions']);
  const respondentActions = asArray<Record<string, any>>(issueActions?.['respondent_actions']);
  const fromList = (items: Record<string, any>[], actionBy: string | null | undefined) =>
    items.map((action, index) => ({
      id: action['id'] ?? `A${index + 1}`,
      descriptor: {
        code:
          action['complainant_action'] ??
          action['respondent_action'] ??
          action?.['descriptor']?.['code'] ??
          issue['status'] ??
          'OPEN',
        short_desc:
          action['short_desc'] ??
          action?.['descriptor']?.['short_desc'] ??
          action?.['descriptor']?.['name'] ??
          null,
      },
      updated_at:
        action['updated_at'] ??
        issue['updated_at'] ??
        issue['created_at'] ??
        new Date().toISOString(),
      action_by: actionBy ?? null,
      actor_details: {
        name:
          action?.['updated_by']?.['person']?.['name'] ??
          action?.['updated_by']?.['org']?.['name'] ??
          null,
      },
    }));

  const complainantMapped = fromList(complainantActions, ids.complainantId ?? ids.sourceId ?? null);
  const respondentMapped = fromList(respondentActions, ids.respondentId ?? null);
  const flattened = [...complainantMapped, ...respondentMapped];
  if (flattened.length > 0) return flattened;

  const directActions = asArray<Record<string, any>>(issue['actions']);
  return directActions.map((action, index) => ({
    id: action['id'] ?? `A${index + 1}`,
    descriptor: {
      code: action?.['descriptor']?.['code'] ?? issue['status'] ?? 'OPEN',
      short_desc:
        action?.['descriptor']?.['short_desc'] ?? action?.['descriptor']?.['name'] ?? null,
    },
    updated_at:
      action['updated_at'] ??
      issue['updated_at'] ??
      issue['created_at'] ??
      new Date().toISOString(),
    action_by: action['action_by'] ?? null,
    actor_details: {
      name: action?.['actor_details']?.['name'] ?? null,
    },
  }));
}

function buildMinimalFallbackAction(
  issue: Record<string, any>,
  consumerActor?: Record<string, any> | null,
) {
  const status = String(issue['status'] ?? 'OPEN');
  const descriptor =
    asObject<Record<string, any>>(issue['descriptor']) ??
    asObject<Record<string, any>>(issue['description']) ??
    {};
  return [
    {
      id: issue['last_action_id'] ?? 'A1',
      descriptor: {
        code: status,
        short_desc: descriptor?.['short_desc'] ?? descriptor?.['long_desc'] ?? null,
      },
      updated_at: issue['updated_at'] ?? issue['created_at'] ?? new Date().toISOString(),
      action_by: issue['complainant_id'] ?? issue['source_id'] ?? consumerActor?.['id'] ?? null,
      actor_details: {
        name: consumerActor?.['info']?.['person']?.['name'] ?? null,
      },
    },
  ];
}

function normalizeIssueForStorage(context: BecknContext, message: Record<string, any>) {
  const issue = asObject<Record<string, any>>(message['issue']) ?? {};
  const descriptor =
    asObject<Record<string, any>>(issue['descriptor']) ??
    asObject<Record<string, any>>(issue['description']) ??
    {};
  const refs = asArray<Record<string, any>>(issue['refs']);
  const fallbackRefs = buildRefsFromOrderDetails(issue);
  const normalizedRefs = refs.length > 0 ? refs : fallbackRefs;
  const actors = asArray<Record<string, any>>(issue['actors']);
  const fallbackActors = buildActorsFromIssue(issue, context);
  const normalizedActors = actors.length > 0 ? actors : fallbackActors;
  const respondentIds = asArray<string>(issue['respondent_ids']);
  const providerRef = normalizedRefs.find(
    (ref) => String(ref['ref_type'] ?? '').toUpperCase() === 'PROVIDER',
  );
  const orderRef = normalizedRefs.find(
    (ref) => String(ref['ref_type'] ?? '').toUpperCase() === 'ORDER',
  );
  const consumerActor = normalizedActors.find(
    (actor) => String(actor['type'] ?? '').toUpperCase() === 'CONSUMER',
  );
  const counterpartActor = normalizedActors.find(
    (actor) => String(actor['type'] ?? '').toUpperCase() === 'COUNTERPARTY_NP',
  );
  const groActor = normalizedActors.find(
    (actor) => String(actor['type'] ?? '').toUpperCase() === 'COUNTERPARTY_NP_GRO',
  );
  const normalizedRespondentIds =
    respondentIds.length > 0
      ? respondentIds
      : counterpartActor?.['id']
        ? [String(counterpartActor['id'])]
        : [];
  const actions = asArray<Record<string, any>>(issue['actions']);
  const derivedActions = buildActionsFromIssue(issue, {
    complainantId: issue['complainant_id'] ?? null,
    respondentId:
      normalizedRespondentIds[0] ?? groActor?.['id'] ?? counterpartActor?.['id'] ?? null,
    sourceId: issue['source_id'] ?? consumerActor?.['id'] ?? null,
  });
  const fallbackActions = buildMinimalFallbackAction(issue, consumerActor);
  const normalizedActions =
    actions.length > 0 ? actions : derivedActions.length > 0 ? derivedActions : fallbackActions;
  const lastAction = normalizedActions[normalizedActions.length - 1] ?? null;
  const displayStatus = String(lastAction?.['descriptor']?.['code'] ?? issue['status'] ?? 'OPEN');

  return {
    issue,
    descriptor,
    refs: normalizedRefs,
    actors: normalizedActors,
    respondentIds: normalizedRespondentIds,
    normalizedActions,
    displayStatus,
    providerId: providerRef?.['ref_id'] ?? issue?.['order_details']?.['provider_id'] ?? null,
    orderId: orderRef?.['ref_id'] ?? issue?.['order_details']?.['id'] ?? null,
    sourceId: issue['source_id'] ?? consumerActor?.['id'] ?? null,
    complainantId:
      issue['complainant_id'] ??
      normalizedActors.find(
        (actor) => String(actor['type'] ?? '').toUpperCase() === 'INTERFACING_NP',
      )?.['id'] ??
      null,
    consumerActor,
    counterpartActor,
    groActor,
    lastAction,
  };
}

/** Enrich issue data with provider/seller context to populate blank refs, actors, respondent_ids */
async function enrichIssueWithContext(
  context: BecknContext,
  normalized: ReturnType<typeof normalizeIssueForStorage>,
) {
  // Use providerId from normalized, or fall back to bpp_id if not in message
  const providerId = normalized.providerId ?? null;
  let provider = null;

  // Try to fetch provider details
  if (providerId) {
    provider = await providerModel.findById(providerId);
  }

  // Enrich refs with PROVIDER and ORDER if missing
  const enrichedRefs = [...normalized.refs];
  if (
    !enrichedRefs.find((r) => String(r['ref_type'] ?? '').toUpperCase() === 'PROVIDER') &&
    providerId
  ) {
    enrichedRefs.push({
      ref_type: 'PROVIDER',
      ref_id: providerId,
    });
  }
  if (
    !enrichedRefs.find((r) => String(r['ref_type'] ?? '').toUpperCase() === 'ORDER') &&
    normalized.orderId
  ) {
    enrichedRefs.push({
      ref_type: 'ORDER',
      ref_id: normalized.orderId,
    });
  }

  // Enrich actors with COUNTERPARTY_NP (seller/support) if missing
  const enrichedActors = [...normalized.actors];
  const hasCounterpartyActor = enrichedActors.find(
    (a) => String(a['type'] ?? '').toUpperCase() === 'COUNTERPARTY_NP',
  );
  if (!hasCounterpartyActor && provider) {
    const counterpartId = context.bpp_id ?? provider.provider_id;
    enrichedActors.push({
      type: 'COUNTERPARTY_NP',
      id: counterpartId,
      info: {
        org: {
          name: `${context.bpp_id ?? provider.business_name ?? provider.name}::${context.domain}`,
        },
        person: {
          name: provider.business_name ?? provider.name,
        },
        contact: {
          phone: provider.support_phone ?? undefined,
          email: provider.support_email ?? undefined,
        },
      },
    });
  }

  const hasGroActor = enrichedActors.find(
    (a) => String(a['type'] ?? '').toUpperCase() === 'COUNTERPARTY_NP_GRO',
  );
  if (!hasGroActor && provider) {
    const counterpartId = context.bpp_id ?? provider.provider_id;
    enrichedActors.push({
      type: 'COUNTERPARTY_NP_GRO',
      id: `${counterpartId}-GRO`,
      info: {
        org: {
          name: `${context.bpp_id ?? provider.business_name ?? provider.name}::${context.domain}`,
        },
        person: {
          name: provider.seller_name ?? provider.business_name ?? provider.name,
        },
        contact: {
          phone: provider.seller_phone ?? provider.support_phone ?? undefined,
          email: provider.seller_email ?? provider.support_email ?? undefined,
        },
      },
    });
  }

  // Enrich respondent_ids with provider if missing
  const enrichedRespondentIds = [...normalized.respondentIds];
  const counterpartActor = enrichedActors.find(
    (a) => String(a['type'] ?? '').toUpperCase() === 'COUNTERPARTY_NP',
  );
  const counterpartId = counterpartActor?.['id'] ? String(counterpartActor['id']) : null;
  if (counterpartId && !enrichedRespondentIds.includes(counterpartId)) {
    enrichedRespondentIds.push(counterpartId);
  }

  return {
    ...normalized,
    refs: enrichedRefs,
    actors: enrichedActors,
    respondentIds: enrichedRespondentIds,
    provider,
  };
}

/** Extract and structure attachments (images, media, etc.) from descriptor */
function extractDescriptorAttachments(descriptor: Record<string, any>) {
  const images = asArray<Record<string, any>>(descriptor['images']);
  const media = asArray<Record<string, any>>(descriptor['media']);
  const additionalDesc = asObject<Record<string, any>>(descriptor['additional_desc']);

  const attachments = {
    images: images.map((img) => ({
      url: img['url'] ?? 'https://via.placeholder.com/300?text=Image',
      size_type: img['size_type'] ?? 'md',
    })),
    media: media.map((m) => ({
      url: m['url'] ?? 'https://via.placeholder.com/300?text=Media',
    })),
    ...(additionalDesc && {
      additional_desc: {
        url: additionalDesc['url'] ?? 'https://via.placeholder.com/300?text=Additional',
        content_type: additionalDesc['content_type'] ?? 'image/png',
      },
    }),
  };

  // Return stringified if there are any attachments, otherwise null
  return Object.values(attachments).some((arr) => (Array.isArray(arr) ? arr.length > 0 : !!arr))
    ? stringify(attachments)
    : null;
}

function rebuildActionsFromOriginalIssue(issue: Record<string, any> | null | undefined) {
  if (!issue) return [];
  const directActions = asArray<Record<string, any>>(issue['actions']);
  if (directActions.length > 0) return directActions;
  return buildActionsFromIssue(issue, {
    complainantId: issue['complainant_id'] ?? null,
    respondentId: asArray<string>(issue['respondent_ids'])[0] ?? null,
    sourceId: issue['source_id'] ?? null,
  });
}

function buildOnIssuePayloadFromTicket(context: BecknContext, stored: Record<string, any>) {
  // Use stored payload as source of truth for full issue structure
  const fullPayload = stored['payload_json']
    ? safeParse<Record<string, any>>(stored['payload_json'])
    : null;
  const originalIssue = asObject<Record<string, any>>(fullPayload?.['issue']);

  // For refs, actors, and actions: prioritize enriched stored data over original payload
  // This ensures enrichments (added PROVIDER/ORDER refs, etc) are included in callback
  const storedRefs = safeParse<Record<string, any>[]>(stored['refs_json']) ?? [];
  const storedActors = safeParse<Record<string, any>[]>(stored['actors_json']) ?? [];
  const storedActions = safeParse<Record<string, any>[]>(stored['actions_json']) ?? [];
  const originalActions = rebuildActionsFromOriginalIssue(originalIssue);

  // Fall back to original issue only if stored data is empty
  const refs = storedRefs.length > 0 ? storedRefs : (originalIssue?.['refs'] ?? []);
  const actors = storedActors.length > 0 ? storedActors : (originalIssue?.['actors'] ?? []);
  const actions = storedActions.length >= originalActions.length ? storedActions : originalActions;
  const respondentIds =
    safeParse<string[]>(stored['respondent_ids_json']) ?? originalIssue?.['respondent_ids'] ?? [];
  const storedDescriptor = safeParse<Record<string, any>>(stored['descriptor_json']) ?? {};
  const originalDescriptor =
    asObject<Record<string, any>>(originalIssue?.['descriptor']) ??
    asObject<Record<string, any>>(originalIssue?.['description']) ??
    {};
  const storedDescriptorAttachments =
    safeParse<Record<string, any>>(stored['descriptor_attachments_json']) ?? {};
  const descriptor = {
    ...originalDescriptor,
    ...storedDescriptor,
    ...(stored['reason_code'] && !storedDescriptor['code'] && !originalDescriptor['code']
      ? { code: stored['reason_code'] }
      : {}),
    ...(stored['reason_short_desc'] &&
    !storedDescriptor['short_desc'] &&
    !originalDescriptor['short_desc']
      ? { short_desc: stored['reason_short_desc'] }
      : {}),
    ...(stored['reason_long_desc'] &&
    !storedDescriptor['long_desc'] &&
    !originalDescriptor['long_desc']
      ? { long_desc: stored['reason_long_desc'] }
      : {}),
    ...(storedDescriptorAttachments['additional_desc']
      ? { additional_desc: storedDescriptorAttachments['additional_desc'] }
      : {}),
    ...(Array.isArray(storedDescriptorAttachments['images'])
      ? { images: storedDescriptorAttachments['images'] }
      : {}),
    ...(Array.isArray(storedDescriptorAttachments['media'])
      ? { media: storedDescriptorAttachments['media'] }
      : {}),
  };

  const sourceId = stored['source_id'] ?? originalIssue?.['source_id'];
  const complainantId = stored['complainant_id'] ?? originalIssue?.['complainant_id'];

  const createdAt = stored['created_at']
    ? new Date(stored['created_at']).toISOString()
    : new Date().toISOString();
  const updatedAt = stored['updated_at'] ? new Date(stored['updated_at']).toISOString() : createdAt;

  return {
    context: buildResponseContext(context, 'on_issue'),
    message: {
      update_target: [
        {
          path: 'issue.actions',
          action: 'APPENDED',
        },
      ],
      issue: {
        id: stored['ticket_id'],
        status: stored['display_status'] ?? stored['igm_status_raw'] ?? 'PROCESSING',
        level: stored['issue_level'] ?? 'ISSUE',
        created_at: createdAt,
        updated_at: updatedAt,
        ...(originalIssue?.['expected_response_time']
          ? { expected_response_time: originalIssue['expected_response_time'] }
          : {}),
        ...(originalIssue?.['expected_resolution_time']
          ? { expected_resolution_time: originalIssue['expected_resolution_time'] }
          : {}),
        refs,
        actors,
        ...(sourceId ? { source_id: sourceId } : {}),
        ...(complainantId ? { complainant_id: complainantId } : {}),
        respondent_ids: respondentIds,
        descriptor,
        ...((stored['last_action_id'] ?? originalIssue?.['last_action_id'])
          ? { last_action_id: stored['last_action_id'] ?? originalIssue?.['last_action_id'] }
          : {}),
        actions,
      },
    },
  };
}

export const igmService = {
  /** Handle incoming /issue request */
  async handleIssue(context: BecknContext, message: Record<string, any>): Promise<void> {
    const issue = message['issue'] as Record<string, any>;
    const issueId = issue['id'] ?? crypto.randomUUID();
    const normalized = normalizeIssueForStorage(context, message);

    // Enrich with provider/seller context
    const enriched = await enrichIssueWithContext(context, normalized);

    const issueRow = await issueModel.createIfMissing({
      issue_id: issueId,
      transaction_id: context.transaction_id,
      order_id: enriched.orderId ?? '',
      bap_id: context.bap_id,
      category: issue['category'] ?? issue['issue_category_code'] ?? 'ITEM',
      sub_category: issue['sub_category'] ?? null,
      short_desc: enriched.descriptor['short_desc'] ?? '',
      long_desc: enriched.descriptor['long_desc'] ?? null,
      status: 'OPEN',
      expected_resolution_time: issue['expected_resolution_time']?.['timestamp'] ?? null,
      expected_response_time: issue['expected_response_time']?.['timestamp'] ?? null,
      resolution_json: null,
      actions_json: stringify(enriched.normalizedActions) ?? '[]',
    });

    await customerTicketModel.upsert({
      ticket_id: issueId,
      txn_id: context.transaction_id,
      order_id: enriched.orderId ?? null,
      provider_id: enriched.providerId ?? null,
      domain: context.domain,
      issue_level: issue['level'] ?? 'ISSUE',
      igm_status_raw: issue['status'] ?? 'OPEN',
      display_status: enriched.displayStatus,
      priority: issue['priority'] ?? 'MEDIUM',
      issue_category_code:
        issue['sub_category'] ??
        enriched.descriptor['code'] ??
        (typeof issue['category'] === 'string' && issue['category'].length <= 10
          ? issue['category']
          : null),
      issue_category_label: issue['category'] ?? issue['sub_category'] ?? null,
      customer_actor_id: enriched.consumerActor?.['id'] ?? null,
      customer_name: enriched.consumerActor?.['info']?.['person']?.['name'] ?? null,
      customer_phone: enriched.consumerActor?.['info']?.['contact']?.['phone'] ?? null,
      customer_email: enriched.consumerActor?.['info']?.['contact']?.['email'] ?? null,
      source_id: enriched.sourceId ?? null,
      complainant_id: enriched.complainantId ?? null,
      respondent_ids_json: stringify(enriched.respondentIds),
      bap_id: context.bap_id ?? null,
      bap_uri: context.bap_uri ?? null,
      bpp_id: context.bpp_id ?? null,
      bpp_uri: context.bpp_uri ?? null,
      country: context.country ?? null,
      city: context.city ?? null,
      core_version: context.core_version ?? null,
      ttl: context.ttl ?? null,
      reason_code: enriched.descriptor['code'] ?? null,
      reason_name: enriched.descriptor['short_desc'] ?? null,
      reason_short_desc: enriched.descriptor['short_desc'] ?? null,
      reason_long_desc: enriched.descriptor['long_desc'] ?? null,
      descriptor_json: stringify(enriched.descriptor),
      descriptor_attachments_json: extractDescriptorAttachments(enriched.descriptor),
      refs_json: stringify(enriched.refs),
      actors_json: stringify(enriched.actors),
      actions_json: stringify(enriched.normalizedActions),
      payload_json: stringify(message),
      last_action_id: enriched.lastAction?.['id'] ?? null,
      last_action_code: enriched.lastAction?.['descriptor']?.['code'] ?? null,
      last_action_by: enriched.lastAction?.['action_by'] ?? null,
      last_actor_name: enriched.lastAction?.['actor_details']?.['name'] ?? null,
      created_at: issue['created_at'] ?? new Date().toISOString(),
      updated_at: issue['updated_at'] ?? issue['created_at'] ?? new Date().toISOString(),
    });

    const storedTicket = await customerTicketModel.findByTicketId(issueId);
    const callbackPayload = buildOnIssuePayloadFromTicket(
      context,
      storedTicket ?? {
        ticket_id: issueId,
        display_status: enriched.displayStatus,
        issue_level: issue['level'] ?? 'ISSUE',
        created_at: issue['created_at'] ?? new Date().toISOString(),
        updated_at: issue['updated_at'] ?? issue['created_at'] ?? new Date().toISOString(),
        payload_json: stringify(message),
        refs_json: stringify(enriched.refs),
        actors_json: stringify(enriched.actors),
        respondent_ids_json: stringify(enriched.respondentIds),
        descriptor_json: stringify(enriched.descriptor),
        descriptor_attachments_json: extractDescriptorAttachments(enriched.descriptor),
        reason_code: enriched.descriptor['code'] ?? null,
        reason_short_desc: enriched.descriptor['short_desc'] ?? null,
        reason_long_desc: enriched.descriptor['long_desc'] ?? null,
        source_id: enriched.sourceId ?? null,
        complainant_id: enriched.complainantId ?? null,
        last_action_id: enriched.lastAction?.['id'] ?? null,
        actions_json: stringify(enriched.normalizedActions),
      },
    );

    const callbackUrl = becknService.buildCallbackUrl(context.bap_uri, 'on_issue');
    const { statusCode, error } = await becknService.sendCallback(
      callbackUrl,
      'on_issue',
      callbackPayload as any,
      context.transaction_id,
    );

    await txnLogModel.insert({
      transaction_id: context.transaction_id,
      message_id: callbackPayload.context.message_id,
      action: 'on_issue',
      direction: 'outbound',
      bap_id: context.bap_id,
      bpp_id: callbackPayload.context.bpp_id ?? null,
      domain: context.domain,
      http_status: statusCode ?? null,
      ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
      payload_json: JSON.stringify(callbackPayload),
      error_message: error ?? null,
    });

    ondcLogger.info('Issue created', {
      issueId: issueRow.issue_id,
      transactionId: context.transaction_id,
    });
  },

  /** Handle /issue_status request */
  async handleIssueStatus(context: BecknContext, message: { issue_id: string }): Promise<void> {
    const issue = await issueModel.findByIssueId(message.issue_id);
    if (!issue) {
      ondcLogger.warn('Issue not found', { issueId: message.issue_id });
      return;
    }

    const callbackPayload = {
      context: buildResponseContext(context, 'on_issue_status'),
      message: {
        issue: {
          id: issue.issue_id,
          status: issue.status,
          resolution: issue.resolution_json ? JSON.parse(issue.resolution_json) : null,
          updated_at: issue.updated_at.toISOString(),
        },
      },
    };

    const callbackUrl = becknService.buildCallbackUrl(context.bap_uri, 'on_issue_status');
    const { statusCode, error } = await becknService.sendCallback(
      callbackUrl,
      'on_issue_status',
      callbackPayload as any,
      context.transaction_id,
    );

    await txnLogModel.insert({
      transaction_id: context.transaction_id,
      message_id: callbackPayload.context.message_id,
      action: 'on_issue_status',
      direction: 'outbound',
      bap_id: context.bap_id,
      bpp_id: callbackPayload.context.bpp_id ?? null,
      domain: context.domain,
      http_status: statusCode ?? null,
      ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
      payload_json: JSON.stringify(callbackPayload),
      error_message: error ?? null,
    });
  },

  /** Resolve an issue and send update to BAP */
  async resolveIssue(
    issueId: string,
    resolution: { short_desc: string; long_desc?: string },
  ): Promise<void> {
    await issueModel.updateStatus(issueId, 'RESOLVED', JSON.stringify(resolution));
    ondcLogger.info('Issue resolved', { issueId });
    // TODO: Send proactive /on_issue_status to BAP with RESOLVED status
  },
};
