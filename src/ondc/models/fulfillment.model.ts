/**
 * Fulfillment tracking for ONDC orders.
 * Tracks shipping/delivery status per fulfillment leg.
 */

import { ondcExec, ondcQuery } from '~/lib/ondcSql';
import type { OndcFulfillmentState } from '~/ondc/types/order.types';

export interface OndcFulfillmentRow {
  id: number;
  ondc_order_id: string;
  fulfillment_id: string;
  fulfillment_type: string;
  state: OndcFulfillmentState;
  tracking_url: string | null;
  awb_number: string | null;
  courier_name: string | null;
  agent_name: string | null;
  agent_phone: string | null;
  estimated_delivery: Date | null;
  actual_delivery: Date | null;
  fulfillment_json: string; // full BecknFulfillment JSON
  created_at: Date;
  updated_at: Date;
}

export const fulfillmentModel = {
  async upsert(data: Omit<OndcFulfillmentRow, 'id' | 'created_at' | 'updated_at'>): Promise<void> {
    await ondcExec(
      `INSERT INTO ondc_fulfillments
        (ondc_order_id, fulfillment_id, fulfillment_type, state, tracking_url,
         awb_number, courier_name, agent_name, agent_phone,
         estimated_delivery, actual_delivery, fulfillment_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         state = VALUES(state), tracking_url = VALUES(tracking_url),
         awb_number = VALUES(awb_number), courier_name = VALUES(courier_name),
         agent_name = VALUES(agent_name), agent_phone = VALUES(agent_phone),
         estimated_delivery = VALUES(estimated_delivery),
         actual_delivery = VALUES(actual_delivery),
         fulfillment_json = VALUES(fulfillment_json),
         updated_at = NOW()`,
      [
        data.ondc_order_id,
        data.fulfillment_id,
        data.fulfillment_type,
        data.state,
        data.tracking_url,
        data.awb_number,
        data.courier_name,
        data.agent_name,
        data.agent_phone,
        data.estimated_delivery,
        data.actual_delivery,
        data.fulfillment_json,
      ],
    );
  },

  async findByOrderId(ondcOrderId: string): Promise<OndcFulfillmentRow[]> {
    return ondcQuery<OndcFulfillmentRow>(
      `SELECT * FROM ondc_fulfillments WHERE ondc_order_id = ?`,
      [ondcOrderId],
    );
  },

  async updateState(
    ondcOrderId: string,
    fulfillmentId: string,
    state: OndcFulfillmentState,
    details?: {
      fulfillmentType?: string;
      url?: string;
      awb?: string;
      courier?: string;
      agent_name?: string;
      agent_phone?: string;
    },
  ): Promise<void> {
    const sets = ['state = ?', 'updated_at = NOW()'];
    const params: unknown[] = [state];
    if (details?.fulfillmentType) {
      sets.push('fulfillment_type = ?');
      params.push(details.fulfillmentType);
    }
    if (details?.url) {
      sets.push('tracking_url = ?');
      params.push(details.url);
    }
    if (details?.awb) {
      sets.push('awb_number = ?');
      params.push(details.awb);
    }
    if (details?.courier) {
      sets.push('courier_name = ?');
      params.push(details.courier);
    }
    if (details?.agent_name) {
      sets.push('agent_name = ?');
      params.push(details.agent_name);
    }
    if (details?.agent_phone) {
      sets.push('agent_phone = ?');
      params.push(details.agent_phone);
    }
    params.push(ondcOrderId, fulfillmentId);
    await ondcExec(
      `UPDATE ondc_fulfillments SET ${sets.join(', ')} WHERE ondc_order_id = ? AND fulfillment_id = ?`,
      params,
    );
  },
};
