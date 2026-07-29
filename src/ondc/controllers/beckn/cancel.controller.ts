/**
 * POST /api/v1/ondc/cancel
 * Buyer-initiated cancellation.
 * After ACK: update order to CANCELLED + send on_cancel callback.
 */

import type { Request, Response } from 'express';
import { buildAck, buildOnCancel, nowIso, safeJsonParse } from '~/ondc/utils/payload.builder';
import { becknService } from '~/ondc/services/beckn.service';
import { observabilityService } from '~/ondc/services/observability.service';
import { orderModel } from '~/ondc/models/order.model';
import { txnLogModel } from '~/ondc/models/log.model';
import { ondcLogger } from '~/ondc/utils/logger.util';
import type { BecknContext } from '~/ondc/types/beckn.types';
import { fetchStoreById, fetchStoreLocations } from '~/ondc/adapters/seller.adapter';
import { bapTermsModel } from '~/ondc/models/bap_terms.model';
import { ondcEnv } from '~/config/ondc.config';
import { PLATFORM_SETTLEMENT } from '~/ondc/config/constants';
import { ondcQuery } from '~/lib/ondcSql';

export async function handleCancel(req: Request, res: Response): Promise<void> {
  const { context: ctx, message } = req.body as {
    context: BecknContext;
    message: { order_id: string; cancellation_reason_id?: string; descriptor?: object };
  };

  const txnId = ctx.transaction_id;
  const bapUri = String(ctx.bap_uri ?? '');
  const orderId = String(message?.order_id ?? '');
  const reasonId = message?.cancellation_reason_id ?? '001';

  try {
    const dbOrder =
      (await orderModel.findByOndcOrderId(orderId)) ??
      (await orderModel.findByTransactionId(txnId));

    if (!dbOrder) {
      ondcLogger.warn('cancel: order not found', { orderId, txnId });
      res.status(200).json({
        context: ctx,
        message: { ack: { status: 'NACK' } },
        error: { type: 'CORE-ERROR', code: '40005', message: 'Order not found' },
      });
      return;
    }

    // Contract v1.2.5: buyer cancellation "may be enabled for all fulfillment
    // states, after order has been placed ('Pending') and before it is
    // delivered ('Order-delivered')" — a post-pickup cancel is answered with
    // cancellation charges in the updated quote, never refused. The only hard
    // refusal is a terminal order: no order mutation is allowed after
    // "Completed"/"Cancelled". (An earlier @ondc/org/cancellable=NO NACK here
    // was not contract-sourced — the flag has no documented NACK semantics —
    // and it failed certification's buyer-side cancellation flow.)
    const TERMINAL_STATUSES = new Set(['DELIVERED', 'CANCELLED', 'RETURNED']);
    if (TERMINAL_STATUSES.has(dbOrder.status)) {
      ondcLogger.warn('cancel: order already in terminal state', {
        orderId,
        txnId,
        status: dbOrder.status,
      });
      res.status(200).json({
        context: ctx,
        message: { ack: { status: 'NACK' } },
        error: {
          type: 'DOMAIN-ERROR',
          code: '50001',
          message: `Cancellation not possible — order is already ${dbOrder.status.toLowerCase()}`,
        },
      });
      return;
    }

    const items = await orderModel.getItems(dbOrder.ondc_order_id);

    res.status(200).json(buildAck(ctx));

    setImmediate(async () => {
      try {
        // Fetch bap_terms to inherit finder fee and static terms from search state
        const bapTerms = ctx.bap_id ? await bapTermsModel.findByBapId(ctx.bap_id) : null;

        // Update order status and store cancel_reason_id
        await orderModel.transitionStatus(
          dbOrder.ondc_order_id,
          dbOrder.status,
          'CANCELLED',
          'Cancelled',
          'buyer',
          `Cancellation reason: ${reasonId}`,
          JSON.stringify(req.body),
          { cancel_reason_id: reasonId },
        );

        // Fetch fulfillments from order model. This runs BEFORE the forward
        // fulfillment is flipped to Cancelled below, so it still holds the
        // pre-cancel state — the precancel_state tag must carry the true
        // prior state ("state of fulfillment prior to cancellation", [702]),
        // not a hardcoded value.
        const fulfillments = await orderModel.getFulfillments(dbOrder.ondc_order_id);
        const preCancelFulf =
          fulfillments.find((f) => f.fulfillment_role === 'primary_forward') ?? fulfillments[0];
        const preCancelState = preCancelFulf?.state ?? 'Pending';
        const preCancelUpdatedAt = preCancelFulf?.updated_at ?? dbOrder.updated_at ?? null;
        let storeId = dbOrder.store_id;
        if (!storeId && items.length > 0) {
          const firstProductId = items[0]?.product_id;
          if (firstProductId) {
            const productRows = await ondcQuery<any>(
              `SELECT store_id FROM products WHERE id = ? LIMIT 1`,
              [firstProductId],
            );
            if (productRows[0]?.store_id) {
              storeId = productRows[0].store_id;
            }
          }
        }
        const [store, storeLocations] = await Promise.all([
          storeId ? fetchStoreById(storeId) : Promise.resolve(null),
          storeId ? fetchStoreLocations(storeId) : Promise.resolve([]),
        ]);

        // Parse raw confirm payload if it exists
        const rawConfirm = dbOrder.raw_confirm_payload
          ? safeJsonParse<{ message?: { order?: any } }>(dbOrder.raw_confirm_payload, {})
          : {};
        const origOrder = rawConfirm?.message?.order ?? {};

        // Parse billing
        const dbBilling = safeJsonParse<any>(dbOrder.billing_json ?? '{}', {});
        const billingAddress = dbBilling.address ?? origOrder.billing?.address ?? {};
        const billing = {
          name: dbBilling.name ?? origOrder.billing?.name ?? dbOrder.customer_name ?? 'ONDC buyer',
          address: {
            name: billingAddress.name ?? 'my house or door or floor #',
            building: billingAddress.building ?? 'my building name or house #',
            locality: billingAddress.locality ?? 'my street name',
            city: billingAddress.city ?? 'Bengaluru',
            state: billingAddress.state ?? 'Karnataka',
            country: billingAddress.country ?? 'IND',
            area_code: billingAddress.area_code ?? '560037',
          },
          email:
            dbBilling.email ??
            origOrder.billing?.email ??
            dbOrder.customer_email ??
            'nobody@nomail.com',
          phone:
            dbBilling.phone ?? origOrder.billing?.phone ?? dbOrder.customer_phone ?? '9886098860',
          created_at:
            dbBilling.created_at ?? origOrder.billing?.created_at ?? '2025-01-08T09:00:00.000Z',
          updated_at:
            dbBilling.updated_at ?? origOrder.billing?.updated_at ?? '2025-01-08T09:00:00.000Z',
        };

        // Provider
        const origProvider = origOrder.provider ?? {};
        const provider = {
          id: dbOrder.provider_id,
          locations: origProvider.locations ?? [{ id: 'L1' }],
        };

        // Fetch any partial cancel action records to check for unique cancel fulfillment IDs
        const actionRows = await ondcQuery<any>(
          `SELECT item_id, action_id FROM ondc_order_actions WHERE ondc_order_id = ? AND action_type = 'partial_cancel'`,
          [dbOrder.ondc_order_id],
        );
        const actionMap = new Map<string, string>();
        for (const row of actionRows) {
          actionMap.set(row.item_id, row.action_id);
        }

        // Group quote trails by cancel fulfillment ID (fallback to 'C1')
        const cancelFulfIdMap = new Map<string, string>();
        const quoteTrailsByFulfId = new Map<string, any[]>();

        for (const item of items) {
          const cancelFulfId = actionMap.get(item.item_id) ?? 'C1';
          cancelFulfIdMap.set(item.item_id, cancelFulfId);

          const unitPrice = parseFloat(item.unit_price || '0');
          const refundValue = -1 * item.quantity * unitPrice;
          const trail = [
            { code: 'type', value: 'item' },
            { code: 'id', value: item.item_id },
            { code: 'currency', value: item.currency || 'INR' },
            { code: 'value', value: refundValue.toFixed(2) },
          ];

          if (!quoteTrailsByFulfId.has(cancelFulfId)) {
            quoteTrailsByFulfId.set(cancelFulfId, []);
          }
          quoteTrailsByFulfId.get(cancelFulfId)!.push(...trail);
        }

        // Items double entries:
        // - One for original fulfillment (e.g. F1) with quantity count = 0
        // - One for cancel fulfillment (unique action ID or fallback C1) with quantity count = original quantity
        const itemsPayload = [];
        for (const item of items) {
          const itemFulfillmentId = item.fulfillment_id || 'F1';
          itemsPayload.push({
            id: item.item_id,
            fulfillment_id: itemFulfillmentId,
            quantity: { count: 0 },
          });

          const cancelFulfId = cancelFulfIdMap.get(item.item_id) ?? 'C1';
          itemsPayload.push({
            id: item.item_id,
            fulfillment_id: cancelFulfId,
            quantity: { count: item.quantity },
          });
        }

        // Fulfillments
        const origFulfillments = origOrder.fulfillments ?? [];
        const origFulf = origFulfillments[0] ?? {};
        const firstFulfId = origFulf.id ?? fulfillments[0]?.fulfillment_id ?? 'F1';

        const startLoc = storeLocations[0];
        const providerName = store?.name ?? 'LSP or Provider Name';

        // Update Delivery fulfillment state to Cancelled in DB
        await orderModel.updateFulfillmentState(dbOrder.ondc_order_id, firstFulfId, 'Cancelled');

        // Upsert all Cancel fulfillments in DB
        for (const [cancelFulfId, trails] of quoteTrailsByFulfId.entries()) {
          const cancelFulfillmentJson = {
            id: cancelFulfId,
            type: 'Cancel',
            state: {
              descriptor: {
                code: 'Cancelled',
              },
            },
            tags: [
              {
                code: 'quote_trail',
                list: trails,
              },
            ],
          };

          await orderModel.upsertFulfillment({
            ondc_order_id: dbOrder.ondc_order_id,
            transaction_id: txnId,
            fulfillment_id: cancelFulfId,
            fulfillment_type: 'Cancel',
            fulfillment_role: `cancel_${cancelFulfId}`.slice(0, 32),
            state: 'Cancelled',
            contact_phone: null,
            contact_email: null,
            tracking_url: null,
            awb_number: null,
            courier_name: null,
            agent_name: null,
            agent_phone: null,
            estimated_delivery: null,
            actual_delivery: null,
            meta_json: JSON.stringify(cancelFulfillmentJson),
          });
        }

        // Retrieve all updated fulfillments from database dynamically
        const dbFulfillments = await orderModel.getFulfillments(dbOrder.ondc_order_id);
        const dbDeliveryFulf = dbFulfillments.find((f) => f.fulfillment_role === 'primary_forward');
        const dbCancelFulfs = dbFulfillments.filter(
          (f) => f.fulfillment_role?.startsWith('cancel') || f.fulfillment_role === 'cancel',
        );

        const origFulfMeta = dbDeliveryFulf?.meta_json
          ? safeJsonParse<any>(dbDeliveryFulf.meta_json, {})
          : {};

        const deliveryFulfillment = {
          id: dbDeliveryFulf?.fulfillment_id ?? firstFulfId,
          '@ondc/org/provider_name':
            origFulfMeta['@ondc/org/provider_name'] ??
            origFulf['@ondc/org/provider_name'] ??
            providerName,
          state: {
            descriptor: {
              code: dbDeliveryFulf?.state ?? 'Cancelled',
            },
          },
          type:
            dbDeliveryFulf?.fulfillment_type ?? origFulfMeta.type ?? origFulf.type ?? 'Delivery',
          tracking: !!dbDeliveryFulf?.tracking_url,
          '@ondc/org/TAT': origFulfMeta['@ondc/org/TAT'] ?? origFulf['@ondc/org/TAT'] ?? 'PT60M',
          start: {
            location: {
              id:
                origFulfMeta.start?.location?.id ??
                origFulf.start?.location?.id ??
                String(startLoc?.id ?? 'L1'),
              descriptor: {
                name:
                  origFulfMeta.start?.location?.descriptor?.name ??
                  origFulf.start?.location?.descriptor?.name ??
                  providerName,
              },
              gps:
                origFulfMeta.start?.location?.gps ??
                origFulf.start?.location?.gps ??
                (startLoc?.latitude != null && startLoc?.longitude != null
                  ? `${startLoc.latitude},${startLoc.longitude}`
                  : '12.9563,77.6368'),
              address: {
                locality:
                  origFulfMeta.start?.location?.address?.locality ??
                  origFulf.start?.location?.address?.locality ??
                  startLoc?.address_line2 ??
                  startLoc?.address_line1 ??
                  'Jayanagar',
                city:
                  origFulfMeta.start?.location?.address?.city ??
                  origFulf.start?.location?.address?.city ??
                  startLoc?.city ??
                  'Bengaluru',
                area_code:
                  origFulfMeta.start?.location?.address?.area_code ??
                  origFulf.start?.location?.address?.area_code ??
                  startLoc?.pincode ??
                  '560076',
                state:
                  origFulfMeta.start?.location?.address?.state ??
                  origFulf.start?.location?.address?.state ??
                  startLoc?.state ??
                  'KA',
              },
            },
            ...(origFulfMeta.start?.time || origFulf.start?.time || dbOrder.created_at
              ? {
                  time: {
                    timestamp:
                      origFulfMeta.start?.time?.timestamp ??
                      origFulf.start?.time?.timestamp ??
                      dbOrder.created_at?.toISOString().replace(/\.\d{3}Z$/, '.000Z') ??
                      nowIso(),
                  },
                }
              : {}),
            contact: {
              phone:
                origFulfMeta.start?.contact?.phone ??
                origFulf.start?.contact?.phone ??
                store?.phone ??
                '9886098860',
              email:
                origFulfMeta.start?.contact?.email ??
                origFulf.start?.contact?.email ??
                store?.email ??
                'nobody@nomail.com',
            },
          },
          end: {
            location: {
              gps:
                origFulfMeta.end?.location?.gps ?? origFulf.end?.location?.gps ?? '12.4535,77.9283',
              address: {
                name:
                  origFulfMeta.end?.location?.address?.name ??
                  origFulf.end?.location?.address?.name ??
                  billing.address.name,
                building:
                  origFulfMeta.end?.location?.address?.building ??
                  origFulf.end?.location?.address?.building ??
                  billing.address.building,
                locality:
                  origFulfMeta.end?.location?.address?.locality ??
                  origFulf.end?.location?.address?.locality ??
                  billing.address.locality,
                city:
                  origFulfMeta.end?.location?.address?.city ??
                  origFulf.end?.location?.address?.city ??
                  billing.address.city,
                state:
                  origFulfMeta.end?.location?.address?.state ??
                  origFulf.end?.location?.address?.state ??
                  billing.address.state,
                country:
                  origFulfMeta.end?.location?.address?.country ??
                  origFulf.end?.location?.address?.country ??
                  billing.address.country,
                area_code:
                  origFulfMeta.end?.location?.address?.area_code ??
                  origFulf.end?.location?.address?.area_code ??
                  billing.address.area_code,
              },
            },
            person: {
              name: origFulfMeta.end?.person?.name ?? origFulf.end?.person?.name ?? billing.name,
            },
            contact: {
              phone:
                origFulfMeta.end?.contact?.phone ?? origFulf.end?.contact?.phone ?? billing.phone,
              email:
                origFulfMeta.end?.contact?.email ?? origFulf.end?.contact?.email ?? billing.email,
            },
          },
          tags: [
            {
              code: 'cancel_request',
              list: [
                { code: 'reason_id', value: reasonId },
                { code: 'initiated_by', value: dbOrder.bap_id || ctx.bap_id || 'bnp.com' },
              ],
            },
            {
              code: 'igm_request',
              list: [{ code: 'id', value: 'Issue1' }],
            },
            {
              code: 'precancel_state',
              list: [
                { code: 'fulfillment_state', value: preCancelState },
                {
                  code: 'updated_at',
                  value: preCancelUpdatedAt
                    ? new Date(preCancelUpdatedAt).toISOString().replace(/\.\d{3}Z$/, '.000Z')
                    : nowIso(),
                },
              ],
            },
          ],
        };

        const cancelFulfillments = dbCancelFulfs.map((dbCancelFulf) => {
          return dbCancelFulf.meta_json
            ? safeJsonParse<any>(dbCancelFulf.meta_json, {})
            : {
                id: dbCancelFulf.fulfillment_id,
                type: 'Cancel',
                state: {
                  descriptor: {
                    code: 'Cancelled',
                  },
                },
                tags: [
                  {
                    code: 'quote_trail',
                    list: quoteTrailsByFulfId.get(dbCancelFulf.fulfillment_id) ?? [],
                  },
                ],
              };
        });

        const responseFulfillments = [deliveryFulfillment, ...cancelFulfillments];

        // Quote breakup
        const origBreakup = origOrder.quote?.breakup ?? [];
        const updatedBreakup: any[] = [];

        // 1. Add/Map Item entries
        for (const item of items) {
          const origItemEntry = origBreakup.find(
            (b: any) =>
              b['@ondc/org/item_id'] === item.item_id && b['@ondc/org/title_type'] === 'item',
          );
          updatedBreakup.push({
            '@ondc/org/item_id': item.item_id,
            '@ondc/org/item_quantity': { count: 0 },
            title: origItemEntry?.title ?? 'Atta',
            '@ondc/org/title_type': 'item',
            price: {
              currency: origItemEntry?.price?.currency ?? 'INR',
              value: '0.00',
            },
            item: {
              price: {
                currency: origItemEntry?.price?.currency ?? 'INR',
                value: origItemEntry?.item?.price?.value ?? item.unit_price ?? '170.00',
              },
            },
          });
        }

        // 2. Add Delivery Charges
        const origDeliveryEntry = origBreakup.find(
          (b: any) => b['@ondc/org/title_type'] === 'delivery',
        );
        const deliveryVal =
          origDeliveryEntry?.price?.value ??
          (dbOrder.delivery_charges && parseFloat(dbOrder.delivery_charges) > 0
            ? dbOrder.delivery_charges
            : '0.00');
        updatedBreakup.push({
          '@ondc/org/item_id': firstFulfId,
          title: origDeliveryEntry?.title ?? 'Delivery charges',
          '@ondc/org/title_type': 'delivery',
          price: {
            currency: origDeliveryEntry?.price?.currency ?? 'INR',
            value: parseFloat(deliveryVal).toFixed(2),
          },
        });

        // 3. Add Tax (Fulfillment)
        const origFulfTaxEntry = origBreakup.find(
          (b: any) => b['@ondc/org/title_type'] === 'tax' && b['@ondc/org/item_id'] === firstFulfId,
        );
        const fulfTaxVal = origFulfTaxEntry?.price?.value ?? '0.00';
        updatedBreakup.push({
          '@ondc/org/item_id': firstFulfId,
          title: origFulfTaxEntry?.title ?? 'Tax',
          '@ondc/org/title_type': 'tax',
          price: {
            currency: origFulfTaxEntry?.price?.currency ?? 'INR',
            value: parseFloat(fulfTaxVal).toFixed(2),
          },
          item: {
            tags: [
              {
                code: 'quote',
                list: [
                  {
                    code: 'type',
                    value: 'fulfillment',
                  },
                ],
              },
            ],
          },
        });

        // 4. Add Packing Charges
        const origPackingEntry = origBreakup.find(
          (b: any) => b['@ondc/org/title_type'] === 'packing',
        );
        const packingVal =
          origPackingEntry?.price?.value ??
          (dbOrder.packing_charges && parseFloat(dbOrder.packing_charges) > 0
            ? dbOrder.packing_charges
            : '0.00');
        updatedBreakup.push({
          '@ondc/org/item_id': firstFulfId,
          title: origPackingEntry?.title ?? 'Packing charges',
          '@ondc/org/title_type': 'packing',
          price: {
            currency: origPackingEntry?.price?.currency ?? 'INR',
            value: parseFloat(packingVal).toFixed(2),
          },
        });

        // 5. Add Tax (Item)
        for (const item of items) {
          const origItemTaxEntry = origBreakup.find(
            (b: any) =>
              b['@ondc/org/title_type'] === 'tax' && b['@ondc/org/item_id'] === item.item_id,
          );
          const itemTaxVal = origItemTaxEntry?.price?.value ?? '0.00';
          updatedBreakup.push({
            '@ondc/org/item_id': item.item_id,
            title: origItemTaxEntry?.title ?? 'Tax',
            '@ondc/org/title_type': 'tax',
            price: {
              currency: origItemTaxEntry?.price?.currency ?? 'INR',
              value: parseFloat(itemTaxVal).toFixed(2),
            },
          });
        }

        // Sum breakup values for quote price total
        const breakupSum = updatedBreakup.reduce((sum: number, entry: any) => {
          return sum + parseFloat(entry.price?.value ?? '0');
        }, 0);

        const quote = {
          price: {
            currency: origOrder.quote?.price?.currency ?? 'INR',
            value: breakupSum.toFixed(2),
          },
          breakup: updatedBreakup,
          ttl: origOrder.quote?.ttl ?? 'P1D',
        };

        // Payment
        const dbPayment = safeJsonParse<any>(dbOrder.payment_json ?? '{}', {});
        const origPayment = origOrder.payment ?? dbPayment ?? {};

        // Platform collects the full amount from the buyer — settlement identity is
        // always ODOP's own, never an individual seller's real bank details.
        const dynamicSettlementDetails = [
          {
            settlement_counterparty: 'seller-app',
            settlement_phase: 'sale-amount',
            settlement_type: PLATFORM_SETTLEMENT.TYPE || 'neft',
            beneficiary_name: PLATFORM_SETTLEMENT.BENEFICIARY_NAME || 'ODOP Marketplace',
            upi_address: PLATFORM_SETTLEMENT.UPI_ADDRESS || 'platform@kotak',
            settlement_bank_account_no: PLATFORM_SETTLEMENT.BANK_ACCOUNT_NO || '0000000000',
            settlement_ifsc_code: PLATFORM_SETTLEMENT.IFSC_CODE || 'KKBK0000001',
            bank_name: PLATFORM_SETTLEMENT.BANK_NAME || 'Kotak Mahindra Bank',
            branch_name: PLATFORM_SETTLEMENT.BRANCH_NAME || 'Bhopal',
          },
        ];

        const payment = {
          // Never invent a payment uri — only carry one the buyer actually sent.
          ...(origPayment.uri
            ? { uri: origPayment.uri, tl_method: origPayment.tl_method ?? 'http/get' }
            : {}),
          params: {
            currency: origPayment.params?.currency ?? 'INR',
            transaction_id:
              origPayment.params?.transaction_id ?? dbOrder.payment_transaction_ref ?? '3937',
            amount: origPayment.params?.amount ?? dbOrder.order_total ?? '424.00',
          },
          status: origPayment.status ?? 'PAID',
          type: origPayment.type ?? 'ON-ORDER',
          collected_by: origPayment.collected_by ?? 'BAP',
          '@ondc/org/buyer_app_finder_fee_type':
            origPayment['@ondc/org/buyer_app_finder_fee_type'] ?? 'percent',
          '@ondc/org/buyer_app_finder_fee_amount':
            origPayment['@ondc/org/buyer_app_finder_fee_amount'] ??
            bapTerms?.bff_percent ??
            ondcEnv.buyerFinderFeeDefault ??
            '3.0',
          '@ondc/org/settlement_details':
            origPayment['@ondc/org/settlement_details'] ?? dynamicSettlementDetails,
        };

        const cancelledOrder = {
          id: dbOrder.ondc_order_id,
          state: 'Cancelled',
          provider: {
            id: dbOrder.provider_id,
            locations:
              origOrder.provider?.locations ??
              (storeLocations.length > 0
                ? storeLocations.map((loc: any) => ({ id: String(loc.id) }))
                : []),
          },
          items: items.flatMap((i) => {
            const cFulfId = cancelFulfIdMap.get(i.item_id) ?? 'C1';
            return [
              { id: i.item_id, fulfillment_id: i.fulfillment_id || 'F1', quantity: { count: 0 } },
              { id: i.item_id, fulfillment_id: cFulfId, quantity: { count: i.quantity } },
            ];
          }),
          billing: JSON.parse(dbOrder.billing_json ?? '{}'),
          cancellation: {
            cancelled_by: dbOrder.bap_id || ctx.bap_id || 'bnp.com',
            reason: {
              id: reasonId,
            },
          },
          fulfillments: responseFulfillments,
          quote,
          payment,
          created_at: dbOrder.created_at
            ? dbOrder.created_at.toISOString().replace(/\.\d{3}Z$/, '.000Z')
            : nowIso(),
          updated_at: nowIso(),
        };

        const payload = buildOnCancel(ctx, cancelledOrder) as any;
        const { statusCode, error: cbErr } = await becknService.sendCallback(
          becknService.buildCallbackUrl(bapUri, 'on_cancel'),
          'on_cancel',
          payload,
          txnId,
        );

        await txnLogModel.insert({
          transaction_id: txnId,
          message_id: payload.context.message_id,
          action: 'on_cancel',
          direction: 'outbound',
          bap_id: ctx.bap_id,
          bpp_id: payload.context.bpp_id ?? null,
          domain: ctx.domain,
          http_status: statusCode ?? null,
          ack_status: statusCode && statusCode < 300 ? 'ACK' : 'NACK',
          payload_json: JSON.stringify(payload),
          error_message: cbErr ?? null,
        });

        observabilityService.push('on_cancel', payload);
      } catch (err: any) {
        ondcLogger.error('cancel async error', { txnId, error: err?.message, stack: err?.stack });
      }
    });
  } catch (err: any) {
    ondcLogger.error('cancel sync error', { txnId, error: err?.message, stack: err?.stack });
    if (!res.headersSent) {
      res.status(500).json({
        context: ctx,
        message: { ack: { status: 'NACK' } },
        error: { type: 'CORE-ERROR', code: '30000', message: 'Internal Server Error' },
      });
    }
  }
}
