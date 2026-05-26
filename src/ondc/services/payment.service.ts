/**
 * Payment Service — tracks ONDC payment status per order.
 * ONDC payments are typically collected by BAP (buyer app).
 * BPP only needs to verify payment status before fulfillment.
 *
 * TODO: Integrate with payment gateway for COD collection,
 *       implement payment webhook from BAP.
 */

import { orderModel } from '~/ondc/models/order.model';
import { ondcLogger } from '~/ondc/utils/logger.util';
import { safeJsonParse } from '~/ondc/utils/payload.builder';
import type { BecknPayment } from '~/ondc/types/beckn.types';

export const paymentService = {
  /** Get payment details for an order */
  async getPayment(ondcOrderId: string): Promise<BecknPayment | null> {
    const order = await orderModel.findByOndcOrderId(ondcOrderId);
    if (!order) return null;
    return safeJsonParse<BecknPayment>(order.payment_json, {} as BecknPayment);
  },

  /** Mark payment as received (for COD or post-delivery settlement) */
  async markPaid(ondcOrderId: string): Promise<void> {
    const order = await orderModel.findByOndcOrderId(ondcOrderId);
    if (!order) return;

    const payment: BecknPayment = safeJsonParse(order.payment_json, {});
    payment.status = 'PAID';

    await orderModel.updateStatus(ondcOrderId, order.status, {
      payment_json: JSON.stringify(payment),
    });

    ondcLogger.info('Payment marked as PAID', { ondcOrderId });
  },

  /** Check if payment has been collected before fulfilling */
  async isPaymentReceived(ondcOrderId: string): Promise<boolean> {
    const payment = await this.getPayment(ondcOrderId);
    if (!payment) return false;
    // For prepaid (collected by BAP), status should be PAID before we ship
    // For COD, it's PAID after delivery
    if (payment.collected_by === 'BAP' && payment.type === 'ON-ORDER') {
      return payment.status === 'PAID';
    }
    return true; // COD — always allow fulfillment
  },
};
