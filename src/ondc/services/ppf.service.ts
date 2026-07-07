/**
 * PPF (Payment Protection Framework) / RSF Service.
 * Domain: ONDC:NTS10, version: 2.0.0.
 *
 * Bidirectional recon flow (per ONDC NTS spec):
 *  A) BPP initiates: sendRecon() → POST {bap_uri}/recon → BAP responds POST {bpp_uri}/on_recon
 *  B) BAP initiates: POST {bpp_uri}/recon → handleInboundRecon() → POST {bap_uri}/on_recon
 */

import { randomUUID } from 'crypto';
import { ppfModel } from '~/ondc/models/ppf.model';
import { orderModel } from '~/ondc/models/order.model';
import { becknService } from '~/ondc/services/beckn.service';
import { txnLogModel } from '~/ondc/models/log.model';
import { ondcEnv } from '~/config/ondc.config';
import { ondcLogger } from '~/ondc/utils/logger.util';
import {
  buildNtsContext,
  buildOnReconError,
  buildOnReconMessage,
  buildQuoteFromOrder,
  buildReconOrderPayload,
  buildSettlementsFromOrder,
  mapOrderStatusForRecon,
  reconcileSettlements,
  type NtsContext,
} from '~/ondc/utils/ppf.builder';

function money(v: number | string): string {
  return Number(v).toFixed(2);
}

function ntsContextFromBody(body: Record<string, any>): NtsContext {
  const ctx = body.context ?? {};
  return {
    domain: ctx.domain ?? 'ONDC:NTS10',
    location: ctx.location ?? { country: { code: 'IND' }, city: { code: '*' } },
    version: ctx.version ?? '2.0.0',
    action: ctx.action ?? 'recon',
    bap_id: ctx.bap_id ?? '',
    bap_uri: ctx.bap_uri ?? '',
    bpp_id: ctx.bpp_id ?? ondcEnv.subscriberId,
    bpp_uri: ctx.bpp_uri ?? ondcEnv.baseUri,
    transaction_id: ctx.transaction_id ?? '',
    message_id: ctx.message_id ?? '',
    timestamp: ctx.timestamp ?? '',
    ttl: ctx.ttl ?? 'P1D',
  };
}

async function postOnRecon(
  targetUri: string,
  payload: Record<string, unknown>,
  txnId: string,
): Promise<{ statusCode: number | undefined; error: string | undefined }> {
  const url = `${targetUri.replace(/\/$/, '')}/on_recon`;
  return becknService.sendCallback(url, 'on_recon', payload as any, txnId);
}

async function loadOrderBundle(ondcOrderId: string) {
  const order = await orderModel.findByOndcOrderId(ondcOrderId);
  if (!order) return null;
  const items = await orderModel.getItems(ondcOrderId);
  const settlements = buildSettlementsFromOrder(order, order.bap_id);
  const quote = buildQuoteFromOrder(order, items);
  const orderPayload = buildReconOrderPayload(order, items, settlements);
  return { order, items, settlements, quote, orderPayload };
}

export const ppfService = {
  /**
   * BPP → BAP: build and POST `recon` for a completed ONDC order.
   */
  async sendRecon(ondcOrderId: string): Promise<number | null> {
    const bundle = await loadOrderBundle(ondcOrderId);
    if (!bundle) {
      ondcLogger.warn('PPF sendRecon: order not found', { ondcOrderId });
      return null;
    }

    const { order, settlements, quote, orderPayload } = bundle;
    const txnId = order.transaction_id;
    const msgId = randomUUID();
    const bapId = order.bap_id ?? '';
    const bapUri = order.bap_uri ?? '';

    const ctx = buildNtsContext(
      {
        bap_id: bapId,
        bap_uri: bapUri,
        bpp_id: ondcEnv.subscriberId,
        bpp_uri: ondcEnv.baseUri,
        transaction_id: txnId,
      },
      'recon',
      msgId,
    );

    const payload = {
      context: ctx,
      message: { orders: [orderPayload] },
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
      order_status: mapOrderStatusForRecon(order.status),
      transaction_id: txnId,
      bap_id: bapId,
      bap_uri: bapUri,
      message_id: msgId,
      currency: order.currency || 'INR',
      total_amount: money(order.order_total),
      quote_json: JSON.stringify(quote),
      settlements_json: JSON.stringify(settlements),
      direction: 'OUTBOUND',
      http_status: statusCode ?? null,
      status: statusCode && statusCode < 300 ? 'ACKED' : 'FAILED',
    });

    await txnLogModel.insert({
      transaction_id: txnId,
      message_id: msgId,
      action: 'recon',
      direction: 'outbound',
      bap_id: bapId,
      bpp_id: ondcEnv.subscriberId,
      domain: 'ONDC:NTS10',
      http_status: statusCode ?? null,
      ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
      payload_json: JSON.stringify(payload),
      error_message: error ?? null,
    });

    ondcLogger.info('PPF recon sent', { ondcOrderId, txnId, statusCode, error });
    return rowId;
  },

  /**
   * BAP → BPP: inbound /recon — compare settlements and respond with /on_recon.
   */
  async handleInboundRecon(body: Record<string, unknown>): Promise<void> {
    const raw = body as Record<string, any>;
    const ctx = ntsContextFromBody(raw);
    const orders: any[] = raw.message?.orders ?? [];

    for (const inboundOrder of orders) {
      const orderId = String(inboundOrder?.id ?? '');
      if (!orderId) continue;

      const bundle = await loadOrderBundle(orderId);
      const inboundJson = JSON.stringify(inboundOrder);

      if (!bundle) {
        const errPayload = buildOnReconError(ctx);
        const { statusCode, error } = await postOnRecon(
          ctx.bap_uri,
          errPayload,
          ctx.transaction_id,
        );
        await txnLogModel.insert({
          transaction_id: ctx.transaction_id,
          message_id: (errPayload.context as NtsContext).message_id,
          action: 'on_recon',
          direction: 'outbound',
          bap_id: ctx.bap_id,
          bpp_id: ctx.bpp_id,
          domain: 'ONDC:NTS10',
          http_status: statusCode ?? null,
          ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
          payload_json: JSON.stringify(errPayload),
          error_message: error ?? 'Invalid Order Id',
        });
        ondcLogger.warn('PPF inbound recon: invalid order', { orderId, txnId: ctx.transaction_id });
        continue;
      }

      const { order, settlements, orderPayload } = bundle;
      const theirs = (inboundOrder.settlements ?? []) as Array<Record<string, unknown>>;

      const prior = await ppfModel.findLatestByOrderAndTxn(orderId, ctx.transaction_id);
      let priorSettlements: Array<Record<string, unknown>> | undefined;
      if (prior?.outbound_on_recon_payload) {
        try {
          const parsed = JSON.parse(prior.outbound_on_recon_payload);
          priorSettlements = parsed?.message?.orders?.[0]?.settlements;
        } catch {
          priorSettlements = undefined;
        }
      }

      const { accord, settlements: reconciled } = reconcileSettlements(
        settlements,
        theirs,
        priorSettlements,
      );

      const finalSettlements =
        reconciled.length > 0
          ? reconciled
          : ((orderPayload.settlements as Record<string, unknown>[]) ?? []);

      const onReconPayload = buildOnReconMessage(ctx, orderPayload, accord, finalSettlements);

      ondcLogger.info('PPF posting on_recon', {
        orderId,
        txnId: ctx.transaction_id,
        target: `${ctx.bap_uri.replace(/\/$/, '')}/on_recon`,
        accord,
      });

      const rowId = await ppfModel.create({
        ondc_order_id: orderId,
        order_status: mapOrderStatusForRecon(order.status),
        transaction_id: ctx.transaction_id,
        bap_id: ctx.bap_id,
        bap_uri: ctx.bap_uri,
        message_id: ctx.message_id,
        currency: order.currency || 'INR',
        total_amount: money(order.order_total),
        quote_json: JSON.stringify(orderPayload.quote),
        settlements_json: JSON.stringify(settlements),
        direction: 'INBOUND',
        inbound_recon_payload: inboundJson,
        http_status: null,
        status: 'INITIATED',
      });

      const { statusCode, error } = await postOnRecon(
        ctx.bap_uri,
        onReconPayload,
        ctx.transaction_id,
      );

      await ppfModel.updateInboundResponse(rowId, {
        recon_accord: accord,
        outbound_on_recon_payload: JSON.stringify(onReconPayload),
        on_recon_http_status: statusCode ?? null,
        status: accord ? 'ACCORD' : 'DISPUTE',
      });

      await txnLogModel.insert({
        transaction_id: ctx.transaction_id,
        message_id: (onReconPayload.context as NtsContext).message_id,
        action: 'on_recon',
        direction: 'outbound',
        bap_id: ctx.bap_id,
        bpp_id: ctx.bpp_id,
        domain: 'ONDC:NTS10',
        http_status: statusCode ?? null,
        ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
        payload_json: JSON.stringify(onReconPayload),
        error_message: error ?? null,
      });

      ondcLogger.info('PPF inbound recon → on_recon sent', {
        orderId,
        accord,
        txnId: ctx.transaction_id,
        statusCode,
      });
    }
  },

  /**
   * BAP → BPP: inbound /on_recon (response to our outbound recon).
   * Also handles legacy /on_receiver_recon.
   */
  async processOnRecon(payload: unknown): Promise<void> {
    const body = payload as Record<string, any>;
    const ctx = body?.context ?? {};

    if (body?.error) {
      ondcLogger.warn('PPF on_recon error from counterparty', {
        code: body.error.code,
        message: body.error.message,
        txnId: ctx.transaction_id,
      });
      return;
    }

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
