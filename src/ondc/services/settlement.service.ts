/**
 * Settlement Service — RSF (Reconciliation & Settlement Framework).
 * Handles /recon and /on_receiver_recon flows.
 *
 * TODO: Implement full RSF v1.1 per ONDC guidelines.
 * Reference: generate_recon.php, recon.php from PHP project.
 */

import { settlementModel } from '~/ondc/models/settlement.model';
import { orderModel } from '~/ondc/models/order.model';
import { ondcLogger, reconLogger } from '~/ondc/utils/logger.util';
import { safeJsonParse } from '~/ondc/utils/payload.builder';
import { finderFeeCommission, orderFinderFee } from '~/ondc/utils/finder-fee';
import type { BecknPayment } from '~/ondc/types/beckn.types';

export const settlementService = {
  /** Create a settlement record for a completed order */
  async createForOrder(ondcOrderId: string): Promise<string | null> {
    const order = await orderModel.findByOndcOrderId(ondcOrderId);
    if (!order) return null;

    const payment: BecknPayment = safeJsonParse(order.payment_json, {});
    const totalAmount = payment.params?.amount ?? '0';
    const total = parseFloat(totalAmount);
    const finderFee = finderFeeCommission(orderFinderFee(order, payment), total).toFixed(2);
    const settlementAmount = (total - parseFloat(finderFee)).toFixed(2);

    const settlementId = `SETTLE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    await settlementModel.create({
      settlement_id: settlementId,
      ondc_order_id: ondcOrderId,
      transaction_id: order.transaction_id,
      total_amount: totalAmount,
      settlement_amount: settlementAmount,
      buyer_finder_fee: finderFee,
      withholding_amount: '0',
      status: 'PENDING',
      settlement_reference: null,
      settlement_timestamp: null,
      counterparty: order.bap_id,
      utr: null,
      raw_json: JSON.stringify(payment),
    });

    ondcLogger.info('Settlement created', { ondcOrderId, settlementId, total, settlementAmount });
    return settlementId;
  },

  /** Process incoming /on_receiver_recon from BAP */
  async processReceiverRecon(payload: unknown): Promise<void> {
    // TODO: Parse ONDC RSF recon payload and reconcile against our settlements
    reconLogger.info('Received recon payload', { payload });
  },

  /** Generate recon report for a date range */
  async generateReconReport(_from: Date, _to: Date): Promise<unknown[]> {
    // TODO: Implement RSF reconciliation report
    return [];
  },
};
