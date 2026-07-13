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
import { fulfillmentService } from '~/ondc/services/fulfillment.service';
import { flow4BService } from '~/ondc/flows/flow4B.service';

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
      // Inbound request is logged centrally by ondcRequestLogger middleware.
      const dbOrder =
        (await orderModel.findByOndcOrderId(orderId)) ??
        (await orderModel.findByTransactionId(txnId));

      if (!dbOrder) {
        ondcLogger.warn('update: order not found', { orderId, txnId });
        return;
      }

      // Flow 4 return requests carry their target lifecycle state in a
      // fulfillment. Handle these before the generic item-update branch so
      // the callback is rebuilt from the persisted Return_* state.
      const requestedReturn = (order['fulfillments'] ?? []).find((fulfillment: any) =>
        String(fulfillment?.state?.descriptor?.code ?? '').startsWith('Return_'),
      );
      if (requestedReturn) {
        const fulfillmentId = String(requestedReturn.id ?? 'F1');
        const fulfillmentType = typeof requestedReturn.type === 'string' ? requestedReturn.type : undefined;
        const returnState = String(requestedReturn.state?.descriptor?.code);

        switch (returnState) {
          case 'Return_Initiated':
            await fulfillmentService.initiateReturn(
              dbOrder.ondc_order_id,
              fulfillmentId,
              fulfillmentType,
            );
            break;
          case 'Return_Approved':
            await fulfillmentService.markReturnApproved(
              dbOrder.ondc_order_id,
              fulfillmentId,
              fulfillmentType,
            );
            break;
          case 'Return_Picked':
            await fulfillmentService.markReturnPicked(
              dbOrder.ondc_order_id,
              fulfillmentId,
              fulfillmentType,
            );
            break;
          case 'Return_Delivered':
            await fulfillmentService.markReturnDelivered(
              dbOrder.ondc_order_id,
              fulfillmentId,
              fulfillmentType,
            );
            break;
          case 'Return_Rejected':
            await flow4BService.rejectReturn(
              dbOrder.ondc_order_id,
              String(requestedReturn.reason?.id ?? 'Return rejected'),
              fulfillmentId,
              fulfillmentType,
            );
            break;
          default:
            break;
        }
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

      // Check the intent of the /update request
      if (target === 'item' || target === 'fulfillment') {
        // 1. If it's an item or fulfillment update (like Partial Cancel), send the on_update callback
        const payload = buildOnUpdate(ctx, updatedOrder) as any;
        const { statusCode, error: cbErr } = await becknService.sendCallback(
          becknService.buildCallbackUrl(bapUri, 'on_update'),
          'on_update',
          payload,
          txnId,
        );

        // Log outbound webhook into Database
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
      } else if (target === 'payment') {
        // 2. If it's a settlement (payment) update, as per protocol do not send the on_update callback
        ondcLogger.info('Payment settlement recorded. No on_update is required for this action.', {
          txnId,
        });
      } else {
        // 3. Any other unhandled target
        ondcLogger.warn(`Unhandled update_target: ${target}`, { txnId });
      }
    } catch (err) {
      ondcLogger.error('update async error', { txnId, err });
    }
  });
}
