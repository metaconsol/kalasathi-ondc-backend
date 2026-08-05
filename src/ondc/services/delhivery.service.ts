/**
 * Delhivery logistics for ONDC orders — a port of odop_backend's
 * delhivery.service (same Delhivery API calls, payload shapes and status
 * handling) adapted to the ONDC tables: ondc_orders / ondc_order_items /
 * ondc_fulfillments instead of seller_units / order_items.
 *
 * Nothing here pushes ONDC callbacks — protocol status (packed / picked_up /
 * delivered…) stays with the seller's Update Fulfillment flow. Booking DOES
 * persist the AWB + tracking URL onto the primary forward fulfillment, so
 * /track and the picked_up on_status carry real courier data automatically.
 *
 * Requires migration 003_delhivery_logistics.sql (delhivery_* columns on
 * ondc_orders and store_locations).
 */

import axios from 'axios';
import { ondcExec, ondcQuery } from '~/lib/ondcSql';
import { delhiveryEnv } from '~/config/delhivery.config';
import { AppError } from '~/lib/response';
import { orderModel, type OndcOrderRow } from '~/ondc/models/order.model';
import { ondcLogger } from '~/ondc/utils/logger.util';

const DELHIVERY_TIMEOUT_MS = 20_000;
const DEFAULT_PACKAGE_METRICS = { weightGm: 500, lengthCm: 10, widthCm: 10, heightCm: 10 };

/**
 * GST on freight. Delhivery's charges endpoint quotes the base WITHOUT tax, but
 * the invoice ODOP actually pays includes 18% — so the buyer must be charged it,
 * exactly as the ecom checkout does (odop_backend SHIPPING_CHARGE_TAX_RATE).
 *
 * It is folded INTO the delivery charge rather than emitted as its own quote
 * tax line: buyer apps sum every `@ondc/org/title_type: "tax"` entry into a
 * single "Tax" figure, so a separate freight-GST line showed the customer one
 * blended number they could not account for. Only the product GST is itemised
 * now, which is what the storefront shows too.
 */
const SHIPPING_CHARGE_TAX_PERCENT = Number(process.env['ONDC_SHIPPING_TAX_PERCENT'] ?? '18');

// ---------------------------------------------------------------------------
// Sanitizers (ported verbatim from odop_backend/src/service/delhivery.service.ts)
// ---------------------------------------------------------------------------

const clean = (v: unknown, fallback = ''): string => String(v ?? fallback).trim();

/** Strips characters Delhivery rejects in free-text fields. */
const cleanForDelhivery = (v: unknown, fallback = ''): string =>
  clean(v, fallback)
    .replace(/[&#%;\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizePhone = (v: unknown): string => {
  const digits = clean(v).replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
};

const compactAddress = (...parts: unknown[]): string =>
  cleanForDelhivery(
    parts
      .map((p) => clean(p))
      .filter(Boolean)
      .join(', '),
  );

const omitEmpty = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(omitEmpty);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === '' || v === null || v === undefined) continue;
      out[k] = omitEmpty(v);
    }
    return out;
  }
  return value;
};

const normalizePaymentMode = (v: unknown, fallback: 'COD' | 'Prepaid'): 'COD' | 'Prepaid' => {
  const s = clean(v).toLowerCase();
  if (s === 'cod') return 'COD';
  if (s === 'pre-paid' || s === 'prepaid' || s === 'paid') return 'Prepaid';
  return fallback;
};

const toNumber = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

// Case is preserved deliberately — the storefront's warehouse names are
// case-sensitive on Delhivery's side and we must produce the identical name.
const slugPart = (v: unknown): string =>
  clean(v)
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

const parseJson = <T = Record<string, unknown>>(value: unknown): T | null => {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

/** Human-readable message out of a Delhivery axios error. */
const parseApiError = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 'no-response';
    const data = error.response?.data as Record<string, unknown> | undefined;
    const detail =
      clean(data?.['message']) ||
      clean(data?.['error']) ||
      clean(data?.['detail']) ||
      clean(data?.['rmk']) ||
      (data ? JSON.stringify(data).slice(0, 400) : error.message);
    let message = `Delhivery API error (HTTP ${status}): ${detail}`;
    if (detail.includes("'NoneType' object has no attribute 'end_date'")) {
      message += ' — this usually means the pickup warehouse is not registered with Delhivery yet.';
    }
    return message;
  }
  return error instanceof Error ? error.message : String(error);
};

const jsonHeaders = () => ({
  Authorization: `Token ${delhiveryEnv.token}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

function requireConfigured(): void {
  if (!delhiveryEnv.enabled) throw new AppError('Delhivery integration is disabled', 400);
  if (!delhiveryEnv.token) throw new AppError('Delhivery API token is not configured', 400);
}

const publicTrackingUrl = (waybill: string): string =>
  `https://www.delhivery.com/track/package/${waybill}`;

// ---------------------------------------------------------------------------
// Shipment context — everything a manifest needs, from the ONDC tables
// ---------------------------------------------------------------------------

interface ShipmentItemRow {
  quantity: number;
  product_name: string | null;
  hsn_sac_code: string | null;
  package_weight_gm: number | null;
  package_length_cm: string | null;
  package_width_cm: string | null;
  package_height_cm: string | null;
}

interface StoreRow {
  store_name: string | null;
  store_slug: string | null;
  support_phone: string | null;
  support_email: string | null;
  gstin: string | null;
}

interface StoreLocationRow {
  id: number;
  store_id: number;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  pincode: string | null;
  delhivery_warehouse_name: string | null;
}

interface ShipTo {
  name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  country: string;
  pin: string;
}

interface ShipmentContext {
  order: OndcOrderRow;
  items: ShipmentItemRow[];
  store: StoreRow | null;
  location: StoreLocationRow | null;
  shipTo: ShipTo;
}

/**
 * Delivery address for the shipment: prefer the fulfillment end location the
 * buyer app sent at /confirm; fall back to billing_json (the only structured
 * address stored on ondc_orders).
 */
function resolveShipTo(order: OndcOrderRow): ShipTo {
  const raw = parseJson<Record<string, any>>(order.raw_confirm_payload);
  const fulfillments = raw?.['message']?.order?.fulfillments ?? raw?.['order']?.fulfillments;
  const end = Array.isArray(fulfillments)
    ? fulfillments.find((f: any) => f?.end?.location?.address)?.end
    : undefined;
  const billing = parseJson<Record<string, any>>(order.billing_json);
  const addr = end?.location?.address ?? billing?.['address'] ?? {};

  return {
    name: cleanForDelhivery(billing?.['name'] ?? order.customer_name),
    phone: normalizePhone(end?.contact?.phone ?? billing?.['phone'] ?? order.customer_phone),
    line1: compactAddress(addr.name, addr.building),
    line2: cleanForDelhivery(addr.locality),
    city: cleanForDelhivery(addr.city),
    state: cleanForDelhivery(addr.state),
    country: cleanForDelhivery(addr.country, 'India') || 'India',
    pin: clean(addr.area_code),
  };
}

async function loadShipmentContext(ondcOrderId: string): Promise<ShipmentContext> {
  const order = await orderModel.findByOndcOrderId(ondcOrderId);
  if (!order) throw new AppError('Order not found', 404);

  const [items, stores, locations] = await Promise.all([
    ondcQuery<ShipmentItemRow>(
      `SELECT oi.quantity, p.product_name, p.hsn_sac_code,
              p.package_weight_gm, p.package_length_cm, p.package_width_cm, p.package_height_cm
       FROM ondc_order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.ondc_order_id = ?
       ORDER BY oi.id ASC`,
      [ondcOrderId],
    ),
    order.store_id
      ? ondcQuery<StoreRow>(
          `SELECT st.store_name, st.store_slug, st.support_phone, st.support_email, sp.gstin
           FROM stores st
           LEFT JOIN seller_profiles sp ON sp.user_id = ?
           WHERE st.id = ?
           LIMIT 1`,
          [order.seller_id, order.store_id],
        )
      : Promise.resolve([] as StoreRow[]),
    order.store_id
      ? ondcQuery<StoreLocationRow>(
          `SELECT id, store_id, address_line1, address_line2, city, state, country, pincode,
                  delhivery_warehouse_name
           FROM store_locations
           WHERE store_id = ? AND is_active = 1
           ORDER BY CASE location_type
             WHEN 'SELF_PICKUP' THEN 1 WHEN 'DELIVERY' THEN 2 WHEN 'RETURN' THEN 3 ELSE 4 END,
             id ASC
           LIMIT 1`,
          [order.store_id],
        )
      : Promise.resolve([] as StoreLocationRow[]),
  ]);

  return {
    order,
    items,
    store: stores[0] ?? null,
    location: locations[0] ?? null,
    shipTo: resolveShipTo(order),
  };
}

/**
 * Weight summed across items; L/W/H take the max. Items missing a value get
 * the per-item default (same as odop_backend), so mixed carts don't
 * under-declare weight.
 */
function resolvePackageMetrics(items: ShipmentItemRow[]) {
  let weightGm = 0;
  let lengthCm = 0;
  let widthCm = 0;
  let heightCm = 0;
  for (const item of items) {
    const qty = Math.max(1, toNumber(item.quantity, 1));
    weightGm += (toNumber(item.package_weight_gm) || DEFAULT_PACKAGE_METRICS.weightGm) * qty;
    lengthCm = Math.max(
      lengthCm,
      toNumber(item.package_length_cm) || DEFAULT_PACKAGE_METRICS.lengthCm,
    );
    widthCm = Math.max(widthCm, toNumber(item.package_width_cm) || DEFAULT_PACKAGE_METRICS.widthCm);
    heightCm = Math.max(
      heightCm,
      toNumber(item.package_height_cm) || DEFAULT_PACKAGE_METRICS.heightCm,
    );
  }
  return {
    weightGm: Math.round(weightGm) || DEFAULT_PACKAGE_METRICS.weightGm,
    lengthCm: Math.round(lengthCm) || DEFAULT_PACKAGE_METRICS.lengthCm,
    widthCm: Math.round(widthCm) || DEFAULT_PACKAGE_METRICS.widthCm,
    heightCm: Math.round(heightCm) || DEFAULT_PACKAGE_METRICS.heightCm,
  };
}

// ---------------------------------------------------------------------------
// Pickup warehouse (same deterministic name as odop_backend, so a store that
// already booked from the storefront reuses its registered warehouse)
// ---------------------------------------------------------------------------

function buildDynamicPickupName(order: OndcOrderRow, store: StoreRow | null): string {
  const suffix =
    slugPart(store?.store_slug || store?.store_name) || `store-${clean(order.store_id)}`;
  return `ODOP-${clean(order.store_id)}-${suffix}`.slice(0, 80);
}

function resolvePickupLocationName(ctx: ShipmentContext): string {
  const saved = cleanForDelhivery(ctx.location?.delhivery_warehouse_name);
  if (saved) return saved;
  const dynamic = cleanForDelhivery(buildDynamicPickupName(ctx.order, ctx.store));
  if (dynamic) return dynamic;
  throw new AppError('Could not resolve a Delhivery pickup location name for this store', 400);
}

const isAlreadyExistsMessage = (value: string): boolean => /already|exist|duplicate/i.test(value);

const isMissingClientWarehouseError = (data: unknown): boolean => {
  const text = JSON.stringify(data ?? '').toLowerCase();
  return text.includes('clientwarehouse') && text.includes('does not exist');
};

async function ensureClientWarehouse(ctx: ShipmentContext, pickupName: string): Promise<unknown> {
  const { store, location } = ctx;
  const phone = normalizePhone(store?.support_phone);
  const email = clean(store?.support_email);
  if (!phone)
    throw new AppError('Store support phone is required to register Delhivery warehouse', 400);
  if (!email)
    throw new AppError('Store support email is required to register Delhivery warehouse', 400);
  if (
    !location ||
    !clean(location.address_line1) ||
    !clean(location.city) ||
    !clean(location.state) ||
    !clean(location.pincode)
  ) {
    throw new AppError(
      'Store pickup address is incomplete (address/city/state/pincode required)',
      400,
    );
  }

  const pickupAddress = compactAddress(location.address_line1, location.address_line2);
  const registeredName = cleanForDelhivery(delhiveryEnv.clientName);
  const payload = {
    phone,
    city: cleanForDelhivery(location.city),
    name: pickupName,
    pin: clean(location.pincode),
    address: pickupAddress,
    country: cleanForDelhivery(location.country, 'India') || 'India',
    email,
    ...(registeredName ? { registered_name: registeredName } : {}),
    return_address: pickupAddress,
    return_pin: clean(location.pincode),
    return_city: cleanForDelhivery(location.city),
    return_state: cleanForDelhivery(location.state),
    return_country: cleanForDelhivery(location.country, 'India') || 'India',
  };

  let response: unknown = null;
  try {
    const { data } = await axios.post(
      `${delhiveryEnv.baseUrl}/api/backend/clientwarehouse/create/`,
      payload,
      { headers: jsonHeaders(), timeout: DELHIVERY_TIMEOUT_MS },
    );
    const body = data as Record<string, unknown>;
    if (
      body &&
      (body['success'] === false || body['error'] === true) &&
      !isAlreadyExistsMessage(JSON.stringify(body))
    ) {
      throw new AppError(
        `Delhivery warehouse registration failed: ${JSON.stringify(body).slice(0, 400)}`,
        400,
      );
    }
    response = data;
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = parseApiError(err);
    // Re-registering an existing warehouse is fine — treat as success.
    if (!isAlreadyExistsMessage(message)) throw new AppError(message, 400);
    response = { note: 'warehouse already registered', message };
  }

  if (ctx.location) {
    await ondcExec(
      `UPDATE store_locations SET
         delhivery_warehouse_name = ?,
         delhivery_warehouse_created_at = COALESCE(delhivery_warehouse_created_at, NOW()),
         delhivery_warehouse_response = ?,
         updated_at = NOW()
       WHERE id = ? AND store_id = ?`,
      [pickupName, JSON.stringify(response ?? null), ctx.location.id, ctx.location.store_id],
    );
    ctx.location.delhivery_warehouse_name = pickupName;
  }
  return response;
}

// ---------------------------------------------------------------------------
// 1. Pincode serviceability (raw passthrough, same as storefront)
// ---------------------------------------------------------------------------

export async function checkPincode(pincode: string): Promise<unknown> {
  requireConfigured();
  const pin = clean(pincode);
  if (!pin) throw new AppError('Pincode is required', 400);
  try {
    const { data } = await axios.get(`${delhiveryEnv.baseUrl}/c/api/pin-codes/json/`, {
      headers: jsonHeaders(),
      params: { filter_codes: pin },
      timeout: DELHIVERY_TIMEOUT_MS,
    });
    return data;
  } catch (err) {
    throw new AppError(parseApiError(err), 400);
  }
}

// ---------------------------------------------------------------------------
// 2. Book shipment (CMU manifest)
// ---------------------------------------------------------------------------

function findWaybill(manifest: Record<string, any>): string {
  const packages: any[] = Array.isArray(manifest?.['packages']) ? manifest['packages'] : [];
  const pkg = packages.find((p) => clean(p?.status).toLowerCase() === 'success') ?? packages[0];
  return clean(pkg?.waybill ?? pkg?.wbn ?? manifest?.['waybill']);
}

/** Delhivery reports failures inside HTTP-200 bodies — check before trusting. */
function assertDelhiverySuccess(body: Record<string, any>, what: string): void {
  const packages: any[] = Array.isArray(body?.['packages']) ? body['packages'] : [];
  const failed =
    body?.['success'] === false ||
    body?.['error'] === true ||
    packages.some((p) => clean(p?.status).toLowerCase() === 'fail');
  if (failed) {
    const remarks = packages
      .flatMap((p) => [p?.remarks, p?.remark])
      .flat()
      .map((r) => clean(r))
      .filter(Boolean)
      .join('; ');
    const message =
      remarks ||
      clean(body?.['rmk']) ||
      clean(body?.['error']) ||
      clean(body?.['message']) ||
      JSON.stringify(body).slice(0, 400);
    throw new AppError(`Delhivery ${what} rejected: ${message}`, 400);
  }
}

async function createManifest(payload: unknown): Promise<Record<string, any>> {
  const formData = new URLSearchParams();
  formData.set('format', 'json');
  formData.set('data', JSON.stringify(payload));
  const { data } = await axios.post(`${delhiveryEnv.baseUrl}/api/cmu/create.json`, formData, {
    headers: {
      Authorization: `Token ${delhiveryEnv.token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    timeout: DELHIVERY_TIMEOUT_MS,
  });
  return data as Record<string, any>;
}

export interface BookShipmentResult {
  waybill: string;
  uploadWbn: string;
  pickupLocationName: string;
  trackingUrl: string;
  response: unknown;
}

export async function bookShipment(
  ondcOrderId: string,
  paymentModeInput?: string,
): Promise<BookShipmentResult> {
  requireConfigured();
  const ctx = await loadShipmentContext(ondcOrderId);
  const { order, items, store, location, shipTo } = ctx;

  if (clean(order.tracking_number)) {
    throw new AppError('Shipment is already booked for this order', 400);
  }
  if (items.length === 0) throw new AppError('Order has no items to ship', 400);
  if (!shipTo.name || !shipTo.phone || !shipTo.line1 || !shipTo.pin) {
    throw new AppError('Shipping address is incomplete (name/phone/address/pincode required)', 400);
  }
  if (
    !location ||
    !clean(location.address_line1) ||
    !clean(location.city) ||
    !clean(location.pincode)
  ) {
    throw new AppError('Store pickup address is incomplete', 400);
  }
  const returnPhone = normalizePhone(store?.support_phone) || shipTo.phone;
  if (!returnPhone) throw new AppError('Store support phone is required to book a shipment', 400);

  const quantity = items.reduce((sum, i) => sum + Math.max(1, toNumber(i.quantity, 1)), 0);
  const shipmentAmount = toNumber(order.order_total);
  const itemNames = items.map((i) => cleanForDelhivery(i.product_name)).filter(Boolean);
  const hsnCodes = Array.from(new Set(items.map((i) => clean(i.hsn_sac_code)).filter(Boolean)));
  const metrics = resolvePackageMetrics(items);
  const defaultMode: 'COD' | 'Prepaid' = order.payment_method === 'COD' ? 'COD' : 'Prepaid';
  const paymentMode = normalizePaymentMode(paymentModeInput, defaultMode);
  const clientName = cleanForDelhivery(delhiveryEnv.clientName);

  const shipment: Record<string, unknown> = {
    order: order.ondc_order_id,
    name: shipTo.name,
    phone: shipTo.phone,
    add: compactAddress(shipTo.line1, shipTo.line2),
    city: shipTo.city,
    state: shipTo.state,
    country: shipTo.country,
    pin: shipTo.pin,
    payment_mode: paymentMode,
    cod_amount: paymentMode === 'COD' ? shipmentAmount.toFixed(2) : '0',
    total_amount: shipmentAmount.toFixed(2),
    quantity: String(quantity || 1),
    products_desc: itemNames.join(', ').slice(0, 500) || 'ODOP products',
    order_date: new Date(order.created_at).toISOString().slice(0, 19).replace('T', ' '),
    shipping_mode: delhiveryEnv.defaultShippingMode,
    seller_name: cleanForDelhivery(store?.store_name),
    seller_add: compactAddress(
      location.address_line1,
      location.address_line2,
      location.city,
      location.state,
      location.pincode,
    ),
    seller_gst_tin: clean(store?.gstin),
    hsn_code: hsnCodes.join(','),
    weight: String(Math.max(1, metrics.weightGm)),
    shipment_length: Math.max(1, metrics.lengthCm),
    shipment_width: Math.max(1, metrics.widthCm),
    shipment_height: Math.max(1, metrics.heightCm),
    return_name: cleanForDelhivery(store?.store_name),
    return_phone: returnPhone,
    return_add: compactAddress(location.address_line1, location.address_line2),
    return_city: cleanForDelhivery(location.city),
    return_state: cleanForDelhivery(location.state),
    return_country: cleanForDelhivery(location.country, 'India') || 'India',
    return_pin: clean(location.pincode),
  };
  if (clientName) shipment['client'] = clientName;

  const pickupName = resolvePickupLocationName(ctx);
  const payload = omitEmpty({ pickup_location: { name: pickupName }, shipments: [shipment] });

  // Register the pickup warehouse first if this location never has been.
  if (!clean(location.delhivery_warehouse_name)) {
    await ensureClientWarehouse(ctx, pickupName);
  }

  // The missing-ClientWarehouse error can arrive in a 200 body OR as an HTTP
  // error — both trigger one register-then-retry, like the storefront.
  let manifest: Record<string, any>;
  try {
    manifest = await createManifest(payload);
    if (isMissingClientWarehouseError(manifest)) {
      await ensureClientWarehouse(ctx, pickupName);
      manifest = await createManifest(payload);
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (axios.isAxiosError(err) && isMissingClientWarehouseError(err.response?.data)) {
      await ensureClientWarehouse(ctx, pickupName);
      try {
        manifest = await createManifest(payload);
      } catch (retryErr) {
        if (retryErr instanceof AppError) throw retryErr;
        throw new AppError(parseApiError(retryErr), 400);
      }
    } else {
      throw new AppError(parseApiError(err), 400);
    }
  }
  assertDelhiverySuccess(manifest, 'booking');

  const waybill = findWaybill(manifest);
  if (!waybill) throw new AppError('Delhivery did not return a waybill', 400);
  const trackingUrl = publicTrackingUrl(waybill);

  await ondcExec(
    `UPDATE ondc_orders SET
       tracking_number = ?, tracking_link = ?, logistics_provider = 'Delhivery',
       delhivery_upload_wbn = ?, delhivery_shipment_status = 'booked',
       delhivery_last_response = ?, updated_at = NOW()
     WHERE ondc_order_id = ?`,
    [waybill, trackingUrl, clean(manifest?.['upload_wbn']), JSON.stringify(manifest), ondcOrderId],
  );
  // Put the AWB on the primary forward fulfillment so picked_up/on_track carry it.
  await ondcExec(
    `UPDATE ondc_fulfillments SET
       awb_number = ?, courier_name = 'Delhivery', tracking_url = ?, updated_at = NOW()
     WHERE ondc_order_id = ? AND fulfillment_role = 'primary_forward'`,
    [waybill, trackingUrl, ondcOrderId],
  );

  ondcLogger.info('Delhivery shipment booked for ONDC order', { ondcOrderId, waybill });
  return {
    waybill,
    uploadWbn: clean(manifest?.['upload_wbn']),
    pickupLocationName: pickupName,
    trackingUrl,
    response: manifest,
  };
}

// ---------------------------------------------------------------------------
// 3. Track shipment
// ---------------------------------------------------------------------------

export interface TrackShipmentResult {
  waybill: string;
  status: string | null;
  statusAt: string | null;
  response: unknown;
}

export async function trackShipment(ondcOrderId: string): Promise<TrackShipmentResult> {
  requireConfigured();
  const order = await orderModel.findByOndcOrderId(ondcOrderId);
  if (!order) throw new AppError('Order not found', 404);
  const waybill = clean(order.tracking_number);
  if (!waybill) throw new AppError('Shipment is not booked yet', 400);

  let data: Record<string, any>;
  try {
    const response = await axios.get(`${delhiveryEnv.baseUrl}/api/v1/packages/json/`, {
      params: { token: delhiveryEnv.token, waybill },
      timeout: DELHIVERY_TIMEOUT_MS,
    });
    data = response.data as Record<string, any>;
  } catch (err) {
    throw new AppError(parseApiError(err), 400);
  }

  const shipment = data?.['ShipmentData']?.[0]?.Shipment;
  const status: string | null = shipment?.Status?.Status || shipment?.Status?.StatusType || null;
  const statusAt: string | null = shipment?.Status?.StatusDateTime || null;

  await ondcExec(
    `UPDATE ondc_orders SET
       delhivery_shipment_status = ?, delhivery_last_scan_at = ?,
       delhivery_last_response = ?, updated_at = NOW()
     WHERE ondc_order_id = ?`,
    [status, statusAt ? new Date(statusAt) : null, JSON.stringify(data), ondcOrderId],
  );

  return { waybill, status, statusAt, response: data };
}

// ---------------------------------------------------------------------------
// 4. Cancel shipment
// ---------------------------------------------------------------------------

export interface CancelShipmentResult {
  waybill: string;
  status: 'cancelled';
  response: unknown;
}

export async function cancelShipment(ondcOrderId: string): Promise<CancelShipmentResult> {
  requireConfigured();
  const order = await orderModel.findByOndcOrderId(ondcOrderId);
  if (!order) throw new AppError('Order not found', 404);
  const waybill = clean(order.tracking_number);
  if (!waybill) throw new AppError('Shipment is not booked yet', 400);

  let data: unknown;
  try {
    const response = await axios.post(
      `${delhiveryEnv.baseUrl}/api/p/edit`,
      { waybill, cancellation: true },
      { headers: jsonHeaders(), timeout: DELHIVERY_TIMEOUT_MS },
    );
    data = response.data;
  } catch (err) {
    throw new AppError(parseApiError(err), 400);
  }
  // Delhivery refuses some cancels (e.g. already dispatched) inside a 200 body
  // — do NOT clear the AWB in that case.
  assertDelhiverySuccess((data ?? {}) as Record<string, any>, 'cancellation');

  await ondcExec(
    `UPDATE ondc_orders SET
       tracking_number = NULL, tracking_link = NULL,
       delhivery_upload_wbn = NULL, delhivery_pickup_id = NULL,
       delhivery_shipment_status = 'cancelled',
       delhivery_last_response = ?, updated_at = NOW()
     WHERE ondc_order_id = ?`,
    [JSON.stringify(data ?? null), ondcOrderId],
  );
  await ondcExec(
    `UPDATE ondc_fulfillments SET
       awb_number = NULL, courier_name = NULL, tracking_url = NULL, updated_at = NOW()
     WHERE ondc_order_id = ? AND fulfillment_role = 'primary_forward'`,
    [ondcOrderId],
  );

  ondcLogger.info('Delhivery shipment cancelled for ONDC order', { ondcOrderId, waybill });
  return { waybill, status: 'cancelled', response: data };
}

// ---------------------------------------------------------------------------
// 5. Packing slip (two-step: label JSON → PDF bytes)
// ---------------------------------------------------------------------------

const PDF_URL_KEYS = new Set([
  'pdf',
  'pdf_url',
  'pdfurl',
  'label',
  'label_url',
  'labelurl',
  'download_url',
  'downloadurl',
  's3_url',
  's3url',
  'url',
  'link',
]);

function findPdfUrl(value: unknown): string {
  if (typeof value === 'string') {
    const match = value.match(/https?:\/\/[^\s"']+/);
    return match ? match[0] : '';
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findPdfUrl(entry);
      if (found) return found;
    }
    return '';
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PDF_URL_KEYS.has(k.toLowerCase())) {
        const found = findPdfUrl(v);
        if (found) return found;
      }
    }
    for (const v of Object.values(value as Record<string, unknown>)) {
      const found = findPdfUrl(v);
      if (found) return found;
    }
  }
  return '';
}

export interface PackingSlipResult {
  buffer: Buffer;
  contentType: string;
  filename: string;
}

export async function getPackingSlip(ondcOrderId: string): Promise<PackingSlipResult> {
  requireConfigured();
  const order = await orderModel.findByOndcOrderId(ondcOrderId);
  if (!order) throw new AppError('Order not found', 404);
  const waybill = clean(order.tracking_number);
  if (!waybill) throw new AppError('Shipment is not booked yet', 400);

  let slipData: unknown;
  try {
    const response = await axios.get(`${delhiveryEnv.baseUrl}/api/p/packing_slip`, {
      headers: jsonHeaders(),
      params: { wbns: waybill, pdf: 'true', pdf_size: '4R' },
      timeout: DELHIVERY_TIMEOUT_MS,
    });
    slipData = response.data;
  } catch (err) {
    throw new AppError(parseApiError(err), 400);
  }

  const pdfUrl = findPdfUrl(slipData);
  if (!pdfUrl) {
    const body = slipData as Record<string, unknown> | undefined;
    const message =
      clean(body?.['message']) ||
      clean(body?.['error']) ||
      clean(body?.['detail']) ||
      clean(body?.['rmk']) ||
      JSON.stringify(slipData ?? {}).slice(0, 400);
    throw new AppError(`Delhivery did not return a packing slip PDF: ${message}`, 400);
  }

  try {
    const pdfResponse = await axios.get<ArrayBuffer>(pdfUrl, {
      responseType: 'arraybuffer',
      headers: { Accept: 'application/pdf,*/*' },
      timeout: DELHIVERY_TIMEOUT_MS,
    });
    return {
      buffer: Buffer.from(pdfResponse.data),
      contentType: String(pdfResponse.headers['content-type'] ?? 'application/pdf'),
      filename: `delhivery-shipping-label-${waybill}.pdf`,
    };
  } catch (err) {
    throw new AppError(parseApiError(err), 400);
  }
}

// ---------------------------------------------------------------------------
// 6. Pickup request
// ---------------------------------------------------------------------------

export interface CreatePickupInput {
  pickupDate: string;
  pickupTime: string;
  expectedPackageCount?: number;
}

export async function createPickup(
  ondcOrderId: string,
  input: CreatePickupInput,
): Promise<unknown> {
  requireConfigured();
  if (!clean(input.pickupDate) || !clean(input.pickupTime)) {
    throw new AppError('pickupDate and pickupTime are required', 400);
  }
  const ctx = await loadShipmentContext(ondcOrderId);
  const { order } = ctx;
  if (!clean(order.tracking_number)) {
    throw new AppError('Book shipment before scheduling pickup', 400);
  }
  if (clean((order as Record<string, any>)['delhivery_pickup_id'])) {
    throw new AppError('Pickup request is already created for this shipment', 400);
  }
  const shipmentStatus = clean(
    (order as Record<string, any>)['delhivery_shipment_status'],
  ).toLowerCase();
  const alreadyMoving = [
    'picked',
    'pickup',
    'shipped',
    'dispatch',
    'transit',
    'out for delivery',
    'ofd',
    'delivered',
    'cancelled',
    'rto',
  ].some((k) => shipmentStatus.includes(k));
  if (alreadyMoving) {
    throw new AppError('Shipment is already in transit — pickup request not applicable', 400);
  }

  const pickupName = resolvePickupLocationName(ctx);
  if (!clean(ctx.location?.delhivery_warehouse_name)) {
    await ensureClientWarehouse(ctx, pickupName);
  }

  let data: Record<string, any>;
  try {
    const response = await axios.post(
      `${delhiveryEnv.baseUrl}/fm/request/new/`,
      {
        pickup_date: clean(input.pickupDate),
        pickup_time: clean(input.pickupTime),
        pickup_location: pickupName,
        expected_package_count: input.expectedPackageCount || 1,
      },
      { headers: jsonHeaders(), timeout: DELHIVERY_TIMEOUT_MS },
    );
    data = response.data as Record<string, any>;
  } catch (err) {
    throw new AppError(parseApiError(err), 400);
  }

  await ondcExec(
    `UPDATE ondc_orders SET
       delhivery_pickup_id = ?, delhivery_last_response = ?, updated_at = NOW()
     WHERE ondc_order_id = ?`,
    [clean(data?.['pickup_id']), JSON.stringify(data ?? null), ondcOrderId],
  );

  return data;
}

// ---------------------------------------------------------------------------
// 7. Shipping-cost estimate for /on_select — real Delhivery freight charge.
//
// Mirrors odop_backend's calculateShippingCost (Delhivery invoice/charges API).
// FAIL-OPEN: returns null whenever it can't produce a trustworthy number
// (Delhivery disabled, missing token / pincode / store location, or any API
// error). Callers must treat null as "no delivery charge" (0), NEVER as an
// error — /on_select must respond even if the courier is down.
// ---------------------------------------------------------------------------

const SHIPPING_ESTIMATE_TIMEOUT_MS = Number(process.env['ONDC_SHIPPING_TIMEOUT_MS'] ?? 4000);
// /select answers inside the BAP's TTL (PT30S), so the whole retry budget must fit well
// under it: 3 x 4s plus backoff is ~13s worst case.
const SHIPPING_ESTIMATE_ATTEMPTS = Math.max(1, Number(process.env['ONDC_SHIPPING_RETRIES'] ?? 3));
const SHIPPING_ESTIMATE_BACKOFF_MS = [300, 800];
// Last good quote per identical parcel+route, so a courier blip reuses a real number
// instead of quoting free delivery. Short enough that a tariff change is picked up.
const QUOTE_CACHE_TTL_MS = Math.max(
  0,
  Number(process.env['ONDC_SHIPPING_CACHE_TTL_MS'] ?? 600_000),
);
const quoteCache = new Map<string, { value: number; expiresAt: number }>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry only what a retry can fix: timeouts, network drops, 5xx and 429. */
function isRetryableShippingError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  if (!err.response) return true;
  const status = err.response.status;
  return status >= 500 || status === 429;
}

/** Pull the freight amount out of Delhivery's charges response (nested/array-safe). */
function findChargeAmount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (Array.isArray(value)) {
    let total = 0;
    let found = false;
    for (const entry of value) {
      const amount = findChargeAmount(entry);
      if (amount !== null) {
        total += amount;
        found = true;
      }
    }
    return found ? total : null;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferred = [
      'total_amount',
      'totalAmount',
      'total',
      'charge',
      'charges',
      'shipping_charge',
      'shippingCharge',
      'freight',
      'freight_charge',
      'freightCharge',
      'gross_amount',
      'grossAmount',
    ];
    for (const key of preferred) {
      const amount = findChargeAmount(record[key]);
      if (amount !== null) return amount;
    }
    for (const entry of Object.values(record)) {
      const amount = findChargeAmount(entry);
      if (amount !== null) return amount;
    }
  }
  return null;
}

const sixDigitPincode = (v: unknown): string | null => {
  const s = clean(v);
  return /^\d{6}$/.test(s) ? s : null;
};

interface ShippingItemInput {
  productId: number;
  quantity: number;
}

/**
 * Estimated Delhivery freight for shipping `items` from the store to
 * `buyerPincode`. Returns the amount in INR, or null to skip (fail-open).
 * @param paymentType affects Delhivery's COD-vs-prepaid charge; defaults Pre-paid.
 */
/**
 * Freight including GST.
 *
 * Delhivery's `total_amount` ALREADY includes the tax it reports in `tax_data` —
 * a 320g Bhopal parcel comes back gross 62.18, CGST 5.60, SGST 5.60,
 * total 73.38. We used to multiply that by 1.18 again and quote 86.59, so every
 * buyer paid 18% too much for delivery. Tax is only added when we had to fall
 * back to a pre-tax field, which is the one case it is genuinely missing.
 */
function taxInclusiveFreight(data: unknown): number | null {
  const row = Array.isArray(data) ? data[0] : data;
  const record = row && typeof row === 'object' ? (row as Record<string, unknown>) : null;

  const total = record ? findChargeAmount(record['total_amount'] ?? record['totalAmount']) : null;
  if (total !== null && total >= 0) return total;

  const gross = record ? findChargeAmount(record['gross_amount'] ?? record['grossAmount']) : null;
  if (gross !== null && gross >= 0) {
    const tax = record?.['tax_data'];
    const taxTotal = tax && typeof tax === 'object' ? findChargeAmount(Object.values(tax)) : null;
    // Reported tax beats an assumed rate — the slab and the rate can both change.
    return taxTotal !== null ? gross + taxTotal : gross * (1 + SHIPPING_CHARGE_TAX_PERCENT / 100);
  }

  // Unknown shape: whatever number we can find, plus the configured rate.
  const fallback = findChargeAmount(data);
  return fallback === null ? null : fallback * (1 + SHIPPING_CHARGE_TAX_PERCENT / 100);
}

export async function estimateDeliveryCharge(input: {
  storeId: number | null;
  items: ShippingItemInput[];
  buyerPincode: string | null | undefined;
  paymentType?: 'Pre-paid' | 'COD';
}): Promise<number | null> {
  if (!delhiveryEnv.enabled || !delhiveryEnv.token) return null;
  if (!input.storeId || input.items.length === 0) return null;

  const destPin = sixDigitPincode(input.buyerPincode);
  if (!destPin) return null;

  try {
    const locations = await ondcQuery<{ pincode: string | null }>(
      `SELECT pincode FROM store_locations
       WHERE store_id = ? AND is_active = 1
       ORDER BY CASE location_type
         WHEN 'SELF_PICKUP' THEN 1 WHEN 'DELIVERY' THEN 2 WHEN 'RETURN' THEN 3 ELSE 4 END, id ASC
       LIMIT 1`,
      [input.storeId],
    );
    const originPin = sixDigitPincode(locations[0]?.pincode);
    if (!originPin) return null;

    const ids = Array.from(new Set(input.items.map((i) => Number(i.productId)).filter(Boolean)));
    if (ids.length === 0) return null;
    const placeholders = ids.map(() => '?').join(',');
    const prodRows = await ondcQuery<{
      id: number;
      package_weight_gm: number | null;
      package_length_cm: string | null;
      package_width_cm: string | null;
      package_height_cm: string | null;
    }>(
      `SELECT id, package_weight_gm, package_length_cm, package_width_cm, package_height_cm
       FROM products WHERE id IN (${placeholders})`,
      ids,
    );
    const byId = new Map(prodRows.map((r) => [Number(r.id), r]));

    let weightGm = 0;
    let lengthCm = 0;
    let widthCm = 0;
    let heightCm = 0;
    for (const item of input.items) {
      const qty = Math.max(1, toNumber(item.quantity, 1));
      const p = byId.get(Number(item.productId));
      weightGm += (toNumber(p?.package_weight_gm) || DEFAULT_PACKAGE_METRICS.weightGm) * qty;
      lengthCm = Math.max(
        lengthCm,
        toNumber(p?.package_length_cm) || DEFAULT_PACKAGE_METRICS.lengthCm,
      );
      widthCm = Math.max(widthCm, toNumber(p?.package_width_cm) || DEFAULT_PACKAGE_METRICS.widthCm);
      heightCm = Math.max(
        heightCm,
        toNumber(p?.package_height_cm) || DEFAULT_PACKAGE_METRICS.heightCm,
      );
    }

    const params: Record<string, string | number> = {
      md: delhiveryEnv.defaultShippingMode === 'Express' ? 'E' : 'S',
      cgm: Math.max(1, Math.round(weightGm) || DEFAULT_PACKAGE_METRICS.weightGm),
      o_pin: originPin,
      d_pin: destPin,
      ss: 'Delivered',
      pt: input.paymentType === 'COD' ? 'COD' : 'Pre-paid',
      l: Math.max(1, Math.round(lengthCm) || DEFAULT_PACKAGE_METRICS.lengthCm),
      b: Math.max(1, Math.round(widthCm) || DEFAULT_PACKAGE_METRICS.widthCm),
      h: Math.max(1, Math.round(heightCm) || DEFAULT_PACKAGE_METRICS.heightCm),
      ipkg_type: 'box',
    };

    const cacheKey = JSON.stringify(params);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= SHIPPING_ESTIMATE_ATTEMPTS; attempt++) {
      try {
        const { data } = await axios.get(
          `${delhiveryEnv.baseUrl}/api/kinko/v1/invoice/charges/.json`,
          { headers: jsonHeaders(), params, timeout: SHIPPING_ESTIMATE_TIMEOUT_MS },
        );
        const amount = taxInclusiveFreight(data);
        if (amount === null || amount < 0) return null;
        const value = Math.round(amount * 100) / 100;
        quoteCache.set(cacheKey, { value, expiresAt: Date.now() + QUOTE_CACHE_TTL_MS });
        return value;
      } catch (err) {
        lastError = err;
        if (attempt >= SHIPPING_ESTIMATE_ATTEMPTS || !isRetryableShippingError(err)) break;
        ondcLogger.warn('Delhivery shipping estimate failed — retrying', {
          attempt,
          of: SHIPPING_ESTIMATE_ATTEMPTS,
          storeId: input.storeId,
        });
        await sleep(SHIPPING_ESTIMATE_BACKOFF_MS[attempt - 1] ?? 800);
      }
    }

    // Every attempt failed. A recent identical quote beats quoting free delivery.
    const cached = quoteCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      ondcLogger.warn('Delhivery unreachable — reusing the last quote for this parcel', {
        storeId: input.storeId,
        value: cached.value,
      });
      return cached.value;
    }
    throw lastError ?? new Error('Delhivery shipping estimate failed');
  } catch (err) {
    ondcLogger.warn('Delhivery shipping estimate failed — using 0 (fail-open)', {
      storeId: input.storeId,
      buyerPincode: input.buyerPincode,
      err,
    });
    return null;
  }
}
