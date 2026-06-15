/**
 * POST /api/v1/ondc/confirm
 *
 * Most critical endpoint — creates the ONDC order.
 *
 * Flow (mirrors PHP confirm.php exactly):
 * 1. ACK immediately (sync, before any DB work)
 * 2. Persist order to ondc_orders + ondc_order_items + ondc_fulfillments
 * 3. Patch overall_txns (amount, payment, address)
 * 4. Build on_confirm and POST signed to bap_uri
 * 5. If BAP ACKs → update status = CONFIRMED
 */

import type { Request, Response } from 'express';
import { buildAck, buildOnConfirm, nowIso, safeJsonParse } from '~/ondc/utils/payload.builder';
import { becknService } from '~/ondc/services/beckn.service';
import { observabilityService } from '~/ondc/services/observability.service';
import { orderModel } from '~/ondc/models/order.model';
import { providerModel } from '~/ondc/models/provider.model';
import { transactionModel } from '~/ondc/models/transaction.model';
import { txnLogModel } from '~/ondc/models/log.model';
import { overallTxnsModel } from '~/ondc/models/overall_txns.model';
import { ondcLogger } from '~/ondc/utils/logger.util';
import { ondcEnv } from '~/config/ondc.config';
import { withOndcTransaction } from '~/lib/ondcSql';
import type { BecknContext } from '~/ondc/types/beckn.types';

/** Extract numeric string value from quote.price.value */
function quoteTotal(order: Record<string, any>): number {
  return parseFloat(String(order?.['quote']?.['price']?.['value'] ?? '0')) || 0;
}

/** Sum item quantities */
function itemQtyTotal(items: any[]): number {
  return items.reduce((s, i) => s + (parseInt(i?.quantity?.count ?? '1', 10) || 1), 0);
}

export async function handleConfirm(req: Request, res: Response): Promise<void> {
  const { context: ctx, message } = req.body as {
    context: BecknContext;
    message: { order: Record<string, any> };
  };

  // Sync ACK — must be first
  res.status(200).json(buildAck(ctx));

  setImmediate(async () => {
    const txnId = ctx.transaction_id;
    const bapUri = String(ctx.bap_uri ?? '');
    const order = message?.order ?? {};

    try {
      // Inbound request is logged centrally by ondcRequestLogger middleware.
      await transactionModel.upsert({
        transaction_id: txnId,
        bap_id: ctx.bap_id,
        bpp_id: ctx.bpp_id ?? null,
        domain: ctx.domain,
        city: ctx.city,
        country: ctx.country ?? null,
        core_version: ctx.core_version ?? null,
        status: 'CONFIRM',
      });

      // Parse billing / payment / fulfillment details
      const billing = order['billing'] ?? {};
      const payment = order['payment'] ?? {};
      const items: any[] = order['items'] ?? [];
      const fulfillments: any[] = order['fulfillments'] ?? [];
      const total = quoteTotal(order);
      const itemCount = itemQtyTotal(items);

      // Derive quote breakup totals
      const breakup: any[] = safeJsonParse(JSON.stringify(order['quote']?.['breakup'] ?? []), []);
      let itemTotal = 0,
        deliveryCharge = 0,
        packingCharge = 0,
        taxTotal = 0;
      for (const b of breakup) {
        const v = parseFloat(String(b?.price?.value ?? '0')) || 0;
        const t = String(b?.['@ondc/org/title_type'] ?? '');
        if (t === 'item') itemTotal += v;
        if (t === 'delivery') deliveryCharge += v;
        if (t === 'packing') packingCharge += v;
        if (t === 'tax') taxTotal += v;
      }

      const ondcOrderId = String(order['id'] || `ONDC-${txnId.slice(0, 8).toUpperCase()}`);
      const providerId = String(order['provider']?.['id'] ?? '');

      // Resolve seller / store from the underlying stores row (provider_id = String(stores.id)).
      const provider = providerId ? await providerModel.findById(providerId) : null;

      // Atomic: create order + items + fulfillments
      await withOndcTransaction(async (tx) => {
        await orderModel.create(
          {
            ondc_order_id: ondcOrderId,
            transaction_id: txnId,
            message_id: ctx.message_id,
            domain: ctx.domain,
            city: ctx.city ?? null,
            country: ctx.country ?? null,
            core_version: ctx.core_version ?? null,
            bap_id: ctx.bap_id,
            bap_uri: bapUri,
            bpp_id: ondcEnv.subscriberId,
            provider_id: providerId,
            seller_id: provider?.seller_id ?? 0,
            store_id: provider?.store_id ?? null,
            status: 'CREATED',
            payment_method: (payment['type'] === 'ON-DELIVERY' ? 'COD' : 'PREPAID') as any,
            payment_status: payment['status'] === 'PAID' ? 'PAID' : 'NOT_PAID',
            payment_transaction_ref: payment['params']?.['transaction_id'] ?? null,
            payment_json: JSON.stringify(payment),
            item_total: itemTotal.toFixed(2),
            delivery_charges: deliveryCharge.toFixed(2),
            packing_charges: packingCharge.toFixed(2),
            tax_total: taxTotal.toFixed(2),
            convenience_fee: '0.00',
            discount_total: '0.00',
            order_total: total.toFixed(2),
            currency: order['quote']?.['price']?.['currency'] ?? 'INR',
            item_count: itemCount,
            customer_name: billing['name'] ?? null,
            customer_phone: billing['phone'] ?? null,
            customer_email: billing['email'] ?? null,
            billing_json: JSON.stringify(billing),
            tracking_number: null,
            tracking_link: null,
            logistics_provider: null,
            cancel_reason_id: null,
            return_reason_id: null,
            raw_confirm_payload: JSON.stringify(req.body),
          },
          tx,
        );

        // Line items
        for (const item of items) {
          const qty = parseInt(item?.quantity?.count ?? '1', 10) || 1;
          const price =
            parseFloat(
              String(
                item?.price?.value ??
                  breakup.find((b: any) => b?.['@ondc/org/item_id'] === item.id)?.item?.price
                    ?.value ??
                  '0',
              ),
            ) || 0;
          await orderModel.insertItem(
            {
              ondc_order_id: ondcOrderId,
              transaction_id: txnId,
              item_id: String(item.id ?? ''),
              product_id: parseInt(String(item.id ?? '').replace(/\D/g, '') || '0', 10),
              variant_id: null,
              provider_id: providerId,
              seller_id: 0,
              quantity: qty,
              unit_price: price.toFixed(2),
              tax_percent: null,
              line_amount: (price * qty).toFixed(2),
              currency: 'INR',
              fulfillment_id: item?.fulfillment_id ?? null,
              raw_item_json: JSON.stringify(item),
            },
            tx,
          );
        }

        // Fulfillments
        for (const f of fulfillments) {
          await orderModel.upsertFulfillment(
            {
              ondc_order_id: ondcOrderId,
              transaction_id: txnId,
              fulfillment_id: String(f.id ?? 'F1'),
              fulfillment_type: String(f.type ?? 'Delivery'),
              fulfillment_role: 'primary_forward',
              state: 'Pending',
              contact_phone: f?.end?.contact?.phone ?? null,
              contact_email: f?.end?.contact?.email ?? null,
              tracking_url: null,
              awb_number: null,
              courier_name: null,
              agent_name: null,
              agent_phone: null,
              estimated_delivery: null,
              actual_delivery: null,
              meta_json: JSON.stringify(f),
            },
            tx,
          );
        }
      });

      // overall_txns
      await overallTxnsModel.patch(txnId, {
        on_confirm: 1,
        order_amount: total > 0 ? total.toFixed(2) : null,
        payment_status: payment['status'] ?? null,
        payment_method: payment['type'] ?? null,
        item_count: itemCount > 0 ? itemCount : null,
      });

      // Build on_confirm
      const onConfirmOrder = {
        id: ondcOrderId,
        state: 'CREATED',
        provider: order['provider'],
        items: order['items'] ?? [],
        billing: billing,
        fulfillments: fulfillments.map((f: any) => ({
          ...f,
          state: { descriptor: { code: 'Pending' } },
        })),
        quote: order['quote'],
        payment: {
          ...payment,
          status: payment['status'] ?? 'NOT-PAID',
        },
        ...(order['tags'] ? { tags: order['tags'] } : {}),
        created_at: nowIso(),
        updated_at: nowIso(),
      };

      const onConfirmPayload = buildOnConfirm(ctx, onConfirmOrder) as any;
      const callbackUrl = becknService.buildCallbackUrl(bapUri, 'on_confirm');
      const { statusCode, error: cbErr } = await becknService.sendCallback(
        callbackUrl,
        'on_confirm',
        onConfirmPayload,
        txnId,
      );

      const ackOk = statusCode !== undefined && statusCode >= 200 && statusCode < 300;

      // If BAP ACKed → confirm the order
      if (ackOk) {
        await orderModel.transitionStatus(
          ondcOrderId,
          'CREATED',
          'CONFIRMED',
          null,
          'buyer',
          'BAP ACKed on_confirm',
        );
      }

      await txnLogModel.insert({
        transaction_id: txnId,
        message_id: onConfirmPayload.context.message_id,
        action: 'on_confirm',
        direction: 'outbound',
        bap_id: ctx.bap_id,
        bpp_id: onConfirmPayload.context.bpp_id ?? null,
        domain: ctx.domain,
        http_status: statusCode ?? null,
        ack_status: ackOk ? 'ACK' : 'NACK',
        payload_json: JSON.stringify(onConfirmPayload),
        error_message: cbErr ?? null,
      });

      observabilityService.push('on_confirm', onConfirmPayload);
      ondcLogger.info('Order confirmed', { ondcOrderId, txnId, ackOk });
    } catch (err) {
      ondcLogger.error('confirm async error', { txnId, err });
    }
  });
}
