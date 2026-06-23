/**
 * IGM (Issue & Grievance Management) Service.
 * Handles /issue, /issue_status flows per ONDC IGM v1.0.
 *
 * TODO: Implement full IGM spec with escalation tiers (L1/L2/L3).
 * Reference: issue.php, issue_status.php, issue_close.php from PHP project.
 */

import { issueModel } from '~/ondc/models/issue.model';
import { becknService } from './beckn.service';
import { buildResponseContext } from '~/ondc/utils/payload.builder';
import { ondcLogger } from '~/ondc/utils/logger.util';
import type { BecknContext } from '~/ondc/types/beckn.types';

export const igmService = {
  /** Handle incoming /issue request */
  async handleIssue(context: BecknContext, message: Record<string, any>): Promise<void> {
    const issue = message['issue'] as Record<string, any>;
    const issueId = issue['id'] ?? crypto.randomUUID();

    await issueModel.create({
      issue_id: issueId,
      transaction_id: context.transaction_id,
      order_id: issue['order_details']?.['id'] ?? '',
      bap_id: context.bap_id,
      category: issue['category'] ?? 'ITEM',
      sub_category: issue['sub_category'] ?? null,
      short_desc: issue['description']?.['short_desc'] ?? '',
      long_desc: issue['description']?.['long_desc'] ?? null,
      status: 'OPEN',
      expected_resolution_time: issue['expected_resolution_time']?.['timestamp'] ?? null,
      expected_response_time: issue['expected_response_time']?.['timestamp'] ?? null,
      resolution_json: null,
      actions_json: '[]',
    });

    // Send /on_issue callback
    const callbackPayload = {
      context: buildResponseContext(context, 'on_issue'),
      message: {
        issue: {
          id: issueId,
          status: 'OPEN',
          issue_actions: { respondent_actions: [] },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      },
    };

    const callbackUrl = becknService.buildCallbackUrl(context.bap_uri, 'on_issue');
    await becknService.sendCallback(
      callbackUrl,
      'on_issue',
      callbackPayload as any,
      context.transaction_id,
    );

    ondcLogger.info('Issue created', { issueId, transactionId: context.transaction_id });
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
    await becknService.sendCallback(
      callbackUrl,
      'on_issue_status',
      callbackPayload as any,
      context.transaction_id,
    );
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
