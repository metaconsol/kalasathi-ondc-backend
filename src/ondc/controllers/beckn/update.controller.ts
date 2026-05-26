/**
 * POST /api/v1/ondc/update
 * Buyer updates an order — partial cancel (flow 3A) or return initiation (flow 4A).
 */

import type { Request, Response } from 'express';
import { buildAck, buildOnUpdate, nowIso } from '~/ondc/utils/payload.builder';
import { becknService } from '~/ondc/services/beckn.service';
import { observabilityService } from '~/ondc/services/observability.service';
import { orderModel } from '~/ondc/models/order.model';
import { txnLogModel } from '~/ondc/models/log.model';
import { ondcExec } from '~/lib/ondcSql';
import { ondcLogger } from '~/ondc/utils/logger.util';
import type { BecknContext } from '~/ondc/types/beckn.types';

export async function handleUpdate(req: Request, res: Response): Promise<void> {
  const { context: ctx, message } = req.body as {
    context: BecknContext;
    message: { update_target: string; order: Record<string, any> };
  };

  res.status(200).json(buildAck(ctx));

  setImmediate(async () => {
    const txnId = ctx.transaction_id;
    const bapUri = String(ctx.bap_uri ?? '');
    const order = message?.order ?? {};
    const target = String(message?.update_target ?? 'item');
    const orderId = String(order['id'] ?? '');

    try {
      await txnLogModel.insert({
        transaction_id: txnId,
        message_id: ctx.message_id,
        action: 'update',
        direction: 'inbound',
        bap_id: ctx.bap_id,
        bpp_id: ctx.bpp_id ?? null,
        domain: ctx.domain,
        http_status: null,
        ack_status: 'ACK',
        payload_json: JSON.stringify(req.body),
        error_message: null,
      });

      const dbOrder =
        (await orderModel.findByOndcOrderId(orderId)) ??
        (await orderModel.findByTransactionId(txnId));

      if (!dbOrder) {
        ondcLogger.warn('update: order not found', { orderId, txnId });
        return;
      }

      // Log to ondc_order_actions
      if (target === 'item' || target === 'fulfillment') {
        const actionType = target === 'fulfillment' ? 'return' : 'partial_cancel';
        const actionItems: any[] = order['items'] ?? [];
        for (const item of actionItems) {
          const { randomUUID } = await import('crypto');
          await ondcExec(
            `INSERT INTO ondc_order_actions
               (transaction_id, ondc_order_id, action_type, action_id, flow_type,
                item_id, item_name, quantity, reason_id, status)
             VALUES (?,?,?,?,?, ?,?,?,?,?)`,
            [
              txnId,
              dbOrder.ondc_order_id,
              actionType,
              randomUUID(),
              actionType === 'return' ? '4a' : '3a',
              String(item.id ?? ''),
              null,
              parseInt(item?.quantity?.count ?? '1', 10) || 1,
              String(
                item?.tags?.find?.((t: any) => t?.code === 'reason_id')?.list?.[0]?.value ?? '001',
              ),
              'initiated',
            ],
          );
        }
      }

      const items = await orderModel.getItems(dbOrder.ondc_order_id);
      const fulfillments = await orderModel.getFulfillments(dbOrder.ondc_order_id);

      const updatedOrder = {
        id: dbOrder.ondc_order_id,
        state: dbOrder.status,
        provider: { id: dbOrder.provider_id },
        items: items.map((i) => ({ id: i.item_id, quantity: { count: i.quantity } })),
        fulfillments: fulfillments.map((f) => ({
          id: f.fulfillment_id,
          type: f.fulfillment_type,
          state: { descriptor: { code: f.state } },
        })),
        billing: JSON.parse(dbOrder.billing_json ?? '{}'),
        payment: JSON.parse(dbOrder.payment_json ?? '{}'),
        updated_at: nowIso(),
      };

      const payload = buildOnUpdate(ctx, updatedOrder) as any;
      const { statusCode, error: cbErr } = await becknService.sendCallback(
        becknService.buildCallbackUrl(bapUri, 'on_update'),
        'on_update',
        payload,
        txnId,
      );

      await txnLogModel.insert({
        transaction_id: txnId,
        message_id: payload.context.message_id,
        action: 'on_update',
        direction: 'outbound',
        bap_id: ctx.bap_id,
        bpp_id: payload.context.bpp_id ?? null,
        domain: ctx.domain,
        http_status: statusCode ?? null,
        ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
        payload_json: JSON.stringify(payload),
        error_message: cbErr ?? null,
      });

      observabilityService.push('on_update', payload);
    } catch (err) {
      ondcLogger.error('update async error', { txnId, err });
    }
  });
}
