/**
 * IGM flow test — runs the full txn sequence from fixtures/igm-txn-flow.json.
 *
 * Usage:
 *   npx tsx src/ondc/test-igm.ts              # in-process (mocks outbound callbacks)
 *   npx tsx src/ondc/test-igm.ts --http       # POST to running server (npm run dev)
 *   npx tsx src/ondc/test-igm.ts --cleanup      # delete test ticket after run
 *
 * Env: ONDC_DB_URL required. Optional ORDER_ID / PROVIDER_ID override DB lookup.
 * Outbound payloads logged to logs/ondc/igm-test.log
 */

import 'dotenv/config';
import { readFile, mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import { ondcQuery } from '~/lib/ondcSql';
import { customerTicketModel } from '~/ondc/models/customer_ticket.model';
import { igmService } from '~/ondc/services/igm.service';
import { becknService } from '~/ondc/services/beckn.service';
import type { BecknContext } from '~/ondc/types/beckn.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'igm-txn-flow.json');
const LOG_PATH = path.join(process.cwd(), 'logs', 'ondc', 'igm-test.log');

type FlowStep =
  | {
      step: number;
      name: string;
      type: 'inbound_issue' | 'inbound_issue_status';
      action: string;
      endpoint?: string;
      expects?: Record<string, unknown>;
      body: Record<string, unknown>;
    }
  | {
      step: number;
      name: string;
      type: 'seller_action';
      kind: string;
      message?: string;
      resolution_note?: string;
      expects?: Record<string, unknown>;
    };

interface FlowFixture {
  variables: Record<string, string>;
  steps: FlowStep[];
}

const outboundLog: Array<{ step: number; action: string; payload: unknown }> = [];
let ticketDbId: number | null = null;

function deepReplace(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
  }
  if (Array.isArray(value)) return value.map((v) => deepReplace(v, vars));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, deepReplace(v, vars)]),
    );
  }
  return value;
}

async function loadFixture(): Promise<FlowFixture> {
  const raw = await readFile(FIXTURE_PATH, 'utf8');
  return JSON.parse(raw) as FlowFixture;
}

async function resolveOrderContext(): Promise<{ orderId: string; providerId: string }> {
  const fromEnv = {
    orderId: process.env['IGM_TEST_ORDER_ID'] ?? process.env['ORDER_ID'] ?? '',
    providerId: process.env['IGM_TEST_PROVIDER_ID'] ?? process.env['PROVIDER_ID'] ?? '',
  };
  if (fromEnv.orderId && fromEnv.providerId)
    return fromEnv as { orderId: string; providerId: string };

  try {
    const rows = await ondcQuery<{ ondc_order_id: string; provider_id: string }>(
      `SELECT ondc_order_id, provider_id FROM ondc_orders
       WHERE status IN ('CONFIRMED','DELIVERED','COMPLETED','OUT_FOR_DELIVERY')
       ORDER BY created_at DESC LIMIT 1`,
    );
    if (rows[0]) {
      return {
        orderId: fromEnv.orderId || rows[0].ondc_order_id,
        providerId: fromEnv.providerId || String(rows[0].provider_id ?? '1'),
      };
    }
  } catch {
    /* DB unavailable — fall through to placeholders */
  }

  return {
    orderId: fromEnv.orderId || 'ORD-IGM-TEST-001',
    providerId: fromEnv.providerId || '1',
  };
}

function buildVars(
  base: Record<string, string>,
  orderId: string,
  providerId: string,
): Record<string, string> {
  const stamp = Date.now();
  return {
    ...base,
    TXN_ID: `igm-test-txn-${stamp}`,
    ISSUE_ID: `IGM-TEST-${stamp}`,
    ORDER_ID: orderId,
    PROVIDER_ID: providerId,
    TIMESTAMP: new Date().toISOString(),
    BPP_SUBSCRIBER_ID: process.env['BPP_SUBSCRIBER_ID'] ?? base['BPP_ID'] ?? 'test.bpp',
    BPP_BASE_URI: process.env['BPP_BASE_URI'] ?? 'http://localhost:5000/api/v1/ondc',
  };
}

function lastSellerAction(
  messages: ReturnType<typeof customerTicketModel.parseMessages>,
): string | undefined {
  const seller = [...messages].reverse().find((m) => m.actor === 'SELLER' && m.action_code);
  return seller?.action_code;
}

async function assertStep(
  step: FlowStep,
  issueId: string,
): Promise<{ ok: boolean; detail: string }> {
  const row = await customerTicketModel.findByTicketId(issueId);
  if (!row) return { ok: false, detail: 'ticket not found in ondc_customer_ticket' };

  ticketDbId = row.id;
  const expects = step.expects ?? {};
  const messages = customerTicketModel.parseMessages(row);

  if (expects['ticket_display_status'] && row.display_status !== expects['ticket_display_status']) {
    return {
      ok: false,
      detail: `expected display_status=${expects['ticket_display_status']}, got ${row.display_status}`,
    };
  }
  if (expects['last_seller_action']) {
    const last = lastSellerAction(messages);
    if (last !== expects['last_seller_action']) {
      return {
        ok: false,
        detail: `expected last seller action ${expects['last_seller_action']}, got ${last}`,
      };
    }
  }
  if (expects['outbound_callbacks']) {
    const wanted = expects['outbound_callbacks'] as string[];
    const got = outboundLog.filter((l) => l.step === step.step).map((l) => l.action);
    for (const action of wanted) {
      if (!got.includes(action)) {
        return {
          ok: false,
          detail: `expected outbound callback ${action}, got [${got.join(', ')}]`,
        };
      }
    }
  }

  return { ok: true, detail: `status=${row.display_status}, messages=${messages.length}` };
}

async function runInProcess(
  steps: FlowStep[],
  vars: Record<string, string>,
  issueId: string,
): Promise<void> {
  const stepRef = { current: 0 };
  const originalSend = becknService.sendCallback;
  becknService.sendCallback = async (_url, action, payload) => {
    outboundLog.push({ step: stepRef.current, action, payload });
    await appendFile(
      LOG_PATH,
      `\n--- step ${stepRef.current} ${action} ---\n${JSON.stringify(payload, null, 2)}\n`,
    );
    return { statusCode: 200, error: undefined };
  };
  let passed = 0;
  let failed = 0;

  try {
    for (const step of steps) {
      stepRef.current = step.step;
      console.log(`\n[Step ${step.step}] ${step.name}`);

      if (step.type === 'inbound_issue') {
        const body = deepReplace(step.body, vars) as {
          context: BecknContext;
          message: Record<string, unknown>;
        };
        await igmService.handleIssue(body.context, body.message);
      } else if (step.type === 'inbound_issue_status') {
        const body = deepReplace(step.body, vars) as {
          context: BecknContext;
          message: { issue_id: string };
        };
        await igmService.handleIssueStatus(body.context, body.message);
      } else if (step.type === 'seller_action') {
        const row = await customerTicketModel.findByTicketId(issueId);
        if (!row) throw new Error('Ticket missing before seller action');
        await igmService.sellerAction(row.id, step.kind as any, {
          ...(step.message !== undefined ? { message: step.message } : {}),
          ...(step.resolution_note !== undefined ? { resolution_note: step.resolution_note } : {}),
        });
      }

      const result = await assertStep(step, issueId);
      if (result.ok) {
        console.log(`  ✓ ${result.detail}`);
        passed++;
      } else {
        console.log(`  ✗ ${result.detail}`);
        failed++;
      }
    }
  } finally {
    becknService.sendCallback = originalSend;
  }

  printSummary(passed, failed, issueId, vars['TXN_ID']!);
}

async function runHttp(
  steps: FlowStep[],
  vars: Record<string, string>,
  issueId: string,
): Promise<void> {
  const port = process.env['SERVER_PORT'] ?? process.env['PORT'] ?? '5000';
  const base = process.env['IGM_TEST_BASE_URL'] ?? `http://localhost:${port}/api/v1/ondc`;
  let passed = 0;
  let failed = 0;

  for (const step of steps) {
    console.log(`\n[Step ${step.step}] ${step.name}`);

    if (step.type === 'seller_action') {
      console.log('  ⚠ seller_action steps need admin JWT — run in-process mode or use Admin UI');
      continue;
    }

    const body = deepReplace(step.body, vars);
    const url = `${base}${(step.endpoint ?? '').replace('/api/v1/ondc', '')}`;
    try {
      const res = await axios.post(url, body, { timeout: 15_000 });
      const ack = res.data?.message?.ack?.status;
      console.log(`  HTTP ${res.status} ack=${ack ?? '?'}`);
      await new Promise((r) => setTimeout(r, 800));
      const result = await assertStep(step, issueId);
      if (result.ok) {
        console.log(`  ✓ ${result.detail}`);
        passed++;
      } else {
        console.log(`  ✗ ${result.detail}`);
        failed++;
      }
    } catch (err: any) {
      console.log(`  ✗ HTTP error: ${err?.message ?? err}`);
      failed++;
    }
  }

  printSummary(passed, failed, issueId, vars['TXN_ID']!);
}

function printSummary(passed: number, failed: number, issueId: string, txnId: string): void {
  console.log('\n========================================');
  console.log(`IGM test complete — ${passed} passed, ${failed} failed`);
  console.log(`  txn_id:   ${txnId}`);
  console.log(`  issue_id: ${issueId}`);
  console.log(`  log:      ${LOG_PATH}`);
  console.log('  Admin UI: /admin/ondc/tickets (check transcript)');
  console.log('========================================\n');
}

async function cleanup(issueId: string): Promise<void> {
  await ondcQuery('DELETE FROM ondc_customer_ticket WHERE ticket_id = ?', [issueId]);
  console.log(`Cleaned up test ticket ${issueId}`);
}

async function main(): Promise<void> {
  const useHttp = process.argv.includes('--http');
  const doCleanup = process.argv.includes('--cleanup');

  await mkdir(path.dirname(LOG_PATH), { recursive: true });
  await appendFile(LOG_PATH, `\n===== IGM test run ${new Date().toISOString()} =====\n`);

  const fixture = await loadFixture();
  const { orderId, providerId } = await resolveOrderContext();
  const vars = buildVars(fixture.variables, orderId, providerId);
  const issueId = vars['ISSUE_ID']!;

  console.log('IGM txn flow test');
  console.log(`  mode:       ${useHttp ? 'HTTP' : 'in-process (mocked callbacks)'}`);
  console.log(`  order_id:   ${orderId}`);
  console.log(`  provider:   ${providerId}`);
  console.log(`  txn_id:     ${vars['TXN_ID']}`);
  console.log(`  issue_id:   ${issueId}`);

  if (useHttp) {
    await runHttp(fixture.steps, vars, issueId);
  } else {
    await runInProcess(fixture.steps, vars, issueId);
  }

  const row = await customerTicketModel.findByTicketId(issueId);
  if (row) {
    const messages = customerTicketModel.parseMessages(row);
    console.log('Transcript:');
    for (const m of messages) {
      console.log(`  [${m.actor}] ${m.action_code ?? '-'} — ${m.message.slice(0, 60)}`);
    }
  }

  if (doCleanup && row) {
    await cleanup(issueId);
  } else if (row) {
    console.log(`\nTicket kept (id=${row.id}). Re-run with --cleanup to delete.`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('IGM test failed:', err);
  process.exit(1);
});
