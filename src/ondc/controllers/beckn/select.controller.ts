/**
 * POST /api/v1/ondc/select
 *
 * Validates items, computes quote using buildQuote (proper ONDC structure
 * with per-item available/maximum counts), and sends /on_select.
 */

import type { Request, Response } from 'express';
import { buildAck, buildOnSelect } from '~/ondc/utils/payload.builder';
import { becknService } from '~/ondc/services/beckn.service';
import { observabilityService } from '~/ondc/services/observability.service';
import { resolveOndcCatalogRow } from '~/ondc/adapters/product.adapter';
import { transactionModel } from '~/ondc/models/transaction.model';
import { txnLogModel } from '~/ondc/models/log.model';
import { overallTxnsModel } from '~/ondc/models/overall_txns.model';
import { buildQuote, type QuoteLineInput } from '~/ondc/utils/catalog.builders';
import { ondcLogger } from '~/ondc/utils/logger.util';
import { ondcEnv } from '~/config/ondc.config';
import type { BecknContext } from '~/ondc/types/beckn.types';

export async function handleSelect(req: Request, res: Response): Promise<void> {
  const { context: ctx, message } = req.body as {
    context: BecknContext;
    message: {
      order: {
        provider: any;
        items: Array<{ id: string; quantity: { count: number } }>;
        fulfillments?: any[];
      };
    };
  };

  res.status(200).json(buildAck(ctx));

  setImmediate(async () => {
    const txnId = ctx.transaction_id;
    const bapUri = String(ctx.bap_uri ?? '');
    const order = message?.order ?? {};

    try {
      await txnLogModel.insert({
        transaction_id: txnId,
        message_id: ctx.message_id,
        action: 'select',
        direction: 'inbound',
        bap_id: ctx.bap_id,
        bpp_id: ctx.bpp_id ?? null,
        domain: ctx.domain,
        http_status: null,
        ack_status: 'ACK',
        payload_json: JSON.stringify(req.body),
        error_message: null,
      });

      await transactionModel.upsert({
        transaction_id: txnId,
        bap_id: ctx.bap_id,
        bpp_id: ctx.bpp_id ?? null,
        domain: ctx.domain,
        city: ctx.city,
        country: ctx.country ?? null,
        core_version: ctx.core_version ?? null,
        status: 'SELECT',
      });
      await overallTxnsModel.upsert(txnId);

      // Validate items & build quote lines
      const validatedItems: any[] = [];
      const lines: QuoteLineInput[] = [];
      const errors: string[] = [];
      let firstItemId = '';
      let firstItemName = '';
      let itemCount = 0;
      const firstFulfillmentId = 'F1';

      for (const reqItem of order.items ?? []) {
        const row = await resolveOndcCatalogRow(reqItem.id);
        if (!row) {
          errors.push(reqItem.id);
          continue;
        }

        const qty = reqItem.quantity.count;
        itemCount += qty;

        if (!firstItemId) {
          firstItemId = reqItem.id;
          firstItemName = row.name;
        }

        const stockAvailable = Math.min(99, row.stock);
        const stockMaximum = Math.min(10, row.stock);

        lines.push({
          itemId: reqItem.id,
          itemName: row.name,
          unitPrice: row.price,
          quantity: qty,
          stockAvailable,
          stockMaximum,
        });

        validatedItems.push({
          id: reqItem.id,
          quantity: reqItem.quantity,
          fulfillment_id: firstFulfillmentId,
        });
      }

      // TODO: integrate shipping API for accurate delivery cost
      const deliveryCharge = 0;
      const packingCharge = 0;
      const quote = buildQuote(lines, firstFulfillmentId, deliveryCharge, packingCharge);

      const selectOrder = {
        provider: order.provider,
        items: validatedItems,
        fulfillments: (order.fulfillments ?? [{ id: firstFulfillmentId, type: 'Delivery' }]).map(
          (f: any) => ({
            ...f,
            '@ondc/org/provider_name': 'ODOP Logistics',
            state: { descriptor: { code: 'Serviceable' } },
            tracking: false,
          }),
        ),
        quote,
        payment: {
          type: 'ON-ORDER',
          collected_by: 'BAP',
          '@ondc/org/buyer_app_finder_fee_type': 'percent',
          '@ondc/org/buyer_app_finder_fee_amount': ondcEnv.buyerFinderFeeDefault,
        },
        ...(errors.length
          ? {
              error: {
                type: 'DOMAIN-ERROR',
                code: '40002',
                message: `Unavailable: ${errors.join(', ')}`,
              },
            }
          : {}),
      };

      await overallTxnsModel.patch(txnId, {
        on_select: 1,
        product_id: firstItemId || null,
        product_name: firstItemName || null,
        item_count: itemCount || null,
      });

      const payload = buildOnSelect(ctx, selectOrder) as any;
      const { statusCode, error: cbErr } = await becknService.sendCallback(
        becknService.buildCallbackUrl(bapUri, 'on_select'),
        'on_select',
        payload,
        txnId,
      );

      await txnLogModel.insert({
        transaction_id: txnId,
        message_id: payload.context.message_id,
        action: 'on_select',
        direction: 'outbound',
        bap_id: ctx.bap_id,
        bpp_id: payload.context.bpp_id ?? null,
        domain: ctx.domain,
        http_status: statusCode ?? null,
        ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
        payload_json: JSON.stringify(payload),
        error_message: cbErr ?? null,
      });

      observabilityService.push('on_select', payload);
    } catch (err) {
      ondcLogger.error('select async error', { txnId, err });
    }
  });
}
