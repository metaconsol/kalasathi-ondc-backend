/**
 * PPF (Payment Protection Framework) Service.
 * Replaces RSF. Domain: ONDC:NTS10, version: 2.0.0.
 *
 * Flow:
 *  BPP calls sendRecon(orderId) → POST {bap_uri}/recon  (signed)
 *  BAP calls back → POST {bpp_uri}/on_receiver_recon
 */

import { ppfModel, type PpfSettlementItem } from '~/ondc/models/ppf.model';
import { orderModel } from '~/ondc/models/order.model';
import { becknService } from '~/ondc/services/beckn.service';
import { ondcEnv } from '~/config/ondc.config';
import { ondcLogger } from '~/ondc/utils/logger.util';
import { safeJsonParse } from '~/ondc/utils/payload.builder';
import type { BecknPayment } from '~/ondc/types/beckn.types';

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function money(v: number | string): string {
  return Number(v).toFixed(2);
}

function ppfContext(bapId: string, bapUri: string, txnId: string, msgId: string) {
  return {
    domain: 'ONDC:NTS10',
    location: { country: { code: 'IND' }, city: { code: '*' } },
    version: '2.0.0',
    action: 'recon',
    bap_id: bapId,
    bap_uri: bapUri,
    bpp_id: ondcEnv.subscriberId,
    bpp_uri: ondcEnv.baseUri,
    transaction_id: txnId,
    message_id: msgId,
    timestamp: nowIso(),
    ttl: 'P1D',
  };
}

export const ppfService = {
  /**
   * Build and POST a `recon` request to the BAP for a completed ONDC order.
   * Returns the ppf_recon row id.
   */
  async sendRecon(ondcOrderId: string): Promise<number | null> {
    const order = await orderModel.findByOndcOrderId(ondcOrderId);
    if (!order) {
      ondcLogger.warn('PPF sendRecon: order not found', { ondcOrderId });
      return null;
    }

    const payment: BecknPayment = safeJsonParse(order.payment_json ?? '{}', {});
    const total = parseFloat(String(order.order_total ?? payment.params?.amount ?? '0'));
    const currency = 'INR';
    const finderFeePercent = parseFloat(
      payment['@ondc/org/buyer_app_finder_fee_amount'] ?? String(ondcEnv.buyerFinderFeeDefault),
    );
    const commission = money((total * finderFeePercent) / 100);
    const settleAmount = money(total - parseFloat(commission));
    const updatedAt = nowIso();

    const settlementDetails: BecknPayment['@ondc/org/settlement_details'] =
      payment['@ondc/org/settlement_details'] ?? [];

    // Build PPF settlement entries from payment settlement_details (or synthetic)
    const settlements: PpfSettlementItem[] = [];
    if (settlementDetails && settlementDetails.length > 0) {
      let idx = 1;
      for (const d of settlementDetails) {
        const amt = d.settlement_amount ?? settleAmount;
        if (parseFloat(String(amt)) === 0) continue;
        settlements.push({
          id: d.settlement_id ?? `settlement-${ondcOrderId}-${idx}`,
          payment_id: `payment-${ondcOrderId}-${idx}`,
          status: d.settlement_status === 'SETTLED' ? 'SETTLED' : 'TO_BE_INITIATED',
          amount: { currency, value: money(amt) },
          commission: { currency, value: commission },
          withholding_amount: {
            currency,
            value: money(payment['@ondc/org/withholding_amount'] ?? 0),
          },
          tcs: { currency, value: '0.00' },
          tds: { currency, value: '0.00' },
          updated_at: d.settlement_timestamp ?? updatedAt,
        });
        const lastEntry = settlements[settlements.length - 1];
        if (d.settlement_reference && lastEntry) {
          lastEntry.settlement_ref_no = d.settlement_reference;
        }
        idx++;
      }
    }

    if (settlements.length === 0) {
      settlements.push({
        id: `settlement-${ondcOrderId}-1`,
        payment_id: `payment-${ondcOrderId}-1`,
        status: 'TO_BE_INITIATED',
        amount: { currency, value: settleAmount },
        commission: { currency, value: commission },
        withholding_amount: { currency, value: '0.00' },
        tcs: { currency, value: '0.00' },
        tds: { currency, value: '0.00' },
        updated_at: updatedAt,
      });
    }

    const txnId = order.transaction_id;
    const msgId = crypto.randomUUID();
    const bapId = order.bap_id ?? '';
    const bapUri = order.bap_uri ?? '';

    const payload = {
      context: ppfContext(bapId, bapUri, txnId, msgId),
      message: {
        orders: [
          {
            id: ondcOrderId,
            amount: { currency, value: money(total) },
            settlements,
          },
        ],
      },
    };

    const callbackUrl = `${bapUri.replace(/\/$/, '')}/recon`;
    const { statusCode, error } = await becknService.sendCallback(
      callbackUrl,
      'recon',
      payload as any,
      txnId,
    );

    const rowId = await ppfModel.create({
      ondc_order_id: ondcOrderId,
      transaction_id: txnId,
      bap_id: bapId,
      bap_uri: bapUri,
      message_id: msgId,
      currency,
      total_amount: money(total),
      settlements_json: JSON.stringify(settlements),
      http_status: statusCode ?? null,
      status: statusCode && statusCode < 300 ? 'ACKED' : 'FAILED',
    });

    ondcLogger.info('PPF recon sent', { ondcOrderId, txnId, statusCode, error });
    return rowId;
  },

  /**
   * Process incoming /on_receiver_recon from BAP.
   */
  async processOnRecon(payload: unknown): Promise<void> {
    const body = payload as Record<string, any>;
    const ctx = body?.context ?? {};
    const orders: any[] = body?.message?.orders ?? [];

    for (const order of orders) {
      const orderId = String(order?.id ?? '');
      const recon_accord = Boolean(order?.recon_accord ?? false);
      if (!orderId) continue;

      await ppfModel.updateOnRecon(orderId, recon_accord, JSON.stringify(order));
      ondcLogger.info('PPF on_recon processed', {
        orderId,
        recon_accord,
        txnId: ctx.transaction_id,
      });
    }
  },
};
