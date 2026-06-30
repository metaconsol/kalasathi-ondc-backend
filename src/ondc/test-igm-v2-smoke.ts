import 'dotenv/config';
import { igmService } from '~/ondc/services/igm.service';
import { becknService } from '~/ondc/services/beckn.service';
import { customerTicketModel } from '~/ondc/models/customer_ticket.model';
import { ondcQuery } from '~/lib/ondcSql';

function latestCodes(row: { payload_json: string | null }): string[] {
  const payload = JSON.parse(row.payload_json ?? '{}');
  return ((payload.actions ?? []) as Array<{ descriptor?: { code?: string } }>)
    .map((a) => a.descriptor?.code ?? '')
    .filter(Boolean);
}

async function main() {
  becknService.sendCallback = async () => ({ statusCode: 200, error: undefined });

  const issueId = `ISSUE-V2-${Date.now()}`;
  const ctx = {
    domain: 'ONDC:RET12',
    action: 'issue',
    country: 'IND',
    city: 'std:080',
    core_version: '2.0.0',
    bap_id: 'pramaan.test',
    bap_uri: 'https://pramaan.test',
    bpp_id: 'test',
    bpp_uri: 'http://localhost',
    transaction_id: `txn-v2-${Date.now()}`,
    message_id: 'm1',
    timestamp: new Date().toISOString(),
    ttl: 'PT30S',
  };

  const issue = {
    id: issueId,
    status: 'OPEN',
    level: 'ISSUE',
    created_at: '2026-06-30T10:00:00.000Z',
    updated_at: '2026-06-30T10:00:00.000Z',
    expected_response_time: { duration: 'PT2H' },
    expected_resolution_time: { duration: 'P1D' },
    refs: [
      { ref_id: 'ORD1', ref_type: 'ORDER' },
      { ref_id: 'P1', ref_type: 'PROVIDER' },
      { ref_id: 'F1', ref_type: 'FULFILLMENT' },
      { ref_id: 'I1', ref_type: 'ITEM' },
    ],
    actors: [
      {
        id: 'C1',
        type: 'CONSUMER',
        info: {
          org: { name: 'bap::ONDC:RET12' },
          person: { name: 'Buyer' },
          contact: { phone: '9999999999', email: 'b@t.com' },
        },
      },
      {
        id: 'NP1',
        type: 'INTERFACING_NP',
        info: {
          org: { name: 'bap::ONDC:RET12' },
          person: { name: 'BAP' },
          contact: { phone: '9999999998', email: 'bap@t.com' },
        },
      },
    ],
    source_id: 'C1',
    complainant_id: 'NP1',
    descriptor: { code: 'ITM02', short_desc: 'Damaged item', long_desc: 'Item damaged' },
    last_action_id: 'A1',
    actions: [
      {
        id: 'A1',
        descriptor: { code: 'OPEN', short_desc: 'Opened' },
        updated_at: '2026-06-30T10:00:00.000Z',
        action_by: 'NP1',
        actor_details: { name: 'Buyer' },
      },
    ],
  };

  await igmService.handleIssue(ctx as any, { issue });
  const row = await customerTicketModel.findByTicketId(issueId);
  if (!row) throw new Error('ticket not created');

  await igmService.sellerAction(row.id, 'info_request', { message: 'Please share photos' });
  let fresh = (await customerTicketModel.getById(row.id))!;
  console.log('after first info_request:', latestCodes(fresh).at(-1));

  await igmService.handleIssue(
    { ...ctx, message_id: 'm2', timestamp: new Date().toISOString() } as any,
    {
      issue: {
        id: issueId,
        actions: [
          {
            id: 'A2',
            descriptor: { code: 'INFO_PROVIDED', short_desc: 'Shared images' },
            updated_at: new Date().toISOString(),
            action_by: 'NP1',
            actor_details: { name: 'Buyer' },
          },
        ],
      },
    },
  );
  fresh = (await customerTicketModel.getById(row.id))!;
  console.log(
    'after first info_provided, open_info_request_count:',
    (fresh as any).open_info_request_count,
  );

  await igmService.sellerAction(row.id, 'processing', { note: 'Reviewing shared images' });
  await igmService.sellerAction(row.id, 'info_request', {
    message: 'Please share invoice copy as well',
  });
  fresh = (await customerTicketModel.getById(row.id))!;
  console.log('after second info_request:', latestCodes(fresh).slice(-2).join(', '));
  console.log('open_info_request_count:', (fresh as any).open_info_request_count);

  await igmService.handleIssue(
    { ...ctx, message_id: 'm3', timestamp: new Date().toISOString() } as any,
    {
      issue: {
        id: issueId,
        actions: [
          {
            id: 'A3',
            descriptor: { code: 'INFO_PROVIDED', short_desc: 'Shared invoice copy' },
            updated_at: new Date().toISOString(),
            action_by: 'NP1',
            actor_details: { name: 'Buyer' },
          },
        ],
      },
    },
  );
  fresh = (await customerTicketModel.getById(row.id))!;
  console.log(
    'after second info_provided, open_info_request_count:',
    (fresh as any).open_info_request_count,
  );

  await igmService.sellerAction(row.id, 'processing', { note: 'All requested info received' });
  await igmService.sellerAction(row.id, 'resolution_options', { message: 'Choose refund' });
  const afterRes = JSON.parse((await customerTicketModel.getById(row.id))!.payload_json!);
  console.log(
    'resolutions:',
    afterRes.resolutions?.length,
    afterRes.resolutions?.[1]?.descriptor?.code,
  );
  console.log(
    'last actions:',
    latestCodes((await customerTicketModel.getById(row.id))!)
      .slice(-4)
      .join(' -> '),
  );

  await ondcQuery('DELETE FROM ondc_customer_ticket WHERE ticket_id = ?', [issueId]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
