import { sqlExec, sqlQuery, withSqlTransaction } from '~/lib/sql';
import { ApiError } from '~/lib/response';
import { mailServiceAsync } from '../mail/mail.service';
import { SellerMailTemplate } from '../mail/seller.mail.template';
export type KycStatus = 'PENDING' | 'SUBMITTED' | 'IN_REVIEW' | 'VERIFIED' | 'REJECTED';
export type StoreLocationType = 'DELIVERY' | 'SELF_PICKUP' | 'RETURN';

/** Active stores only (not soft-deleted). */
const storeIsActiveRow = { deletedAt: null } as const;

export type LocationBody = {
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  country: string;
  pincode: string;
  latitude?: string | number | null;
  longitude?: string | number | null;
  radiusKm?: bigint | null;
  openingTime?: number | null;
  closingTime?: number | null;
  serviceability: 10 | 11 | 12 | 13;
  isActive?: boolean;
};

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return s.length > 0 ? s : 'store';
}

async function allocateStoreSlug(storeName: string, preferredSlug?: string): Promise<string> {
  const base = slugify(preferredSlug && preferredSlug.length > 0 ? preferredSlug : storeName);
  let slug = base;
  let i = 0;
  for (;;) {
    const hitRows = await sqlQuery<{ id: bigint }>(
      'SELECT `id` FROM `stores` WHERE `store_slug` = ? LIMIT 1',
      [slug],
    );
    const hit = hitRows[0] ?? null;
    if (!hit) return slug;
    i += 1;
    slug = `${base}-${i}`;
  }
}

export async function assertStoreOwnedBySeller(storeId: bigint, sellerUserId: number) {
  const rows = await sqlQuery(
    'SELECT `id`, `seller_user_id` as sellerUserId, `store_name` as storeName, `store_slug` as storeSlug, `description`, `support_email` as supportEmail, `support_phone` as supportPhone, `is_active` as isActive, `deleted_at` as deletedAt, `created_at` as createdAt, `updated_at` as updatedAt FROM `stores` WHERE `id` = ? AND `seller_user_id` = ? AND `deleted_at` IS NULL LIMIT 1',
    [storeId, sellerUserId],
  );
  const store = rows[0] ?? null;
  if (!store) {
    throw ApiError.NOT_FOUND('Store not found');
  }
  return store;
}

// export function serializeLocation(loc: {
//   id: bigint;
//   storeId: bigint;
//   radiusKm: bigint | null;
//   latitude?: unknown;
//   longitude?: unknown;
//   [key: string]: unknown;
// }) {
//   const { id, storeId, radiusKm, latitude, longitude, ...rest } = loc;
//   return {
//     ...rest,
//     id: id.toString(),
//     storeId: storeId.toString(),
//     radiusKm: radiusKm !== null ? radiusKm.toString() : null,
//     latitude: latitude != null ? String(latitude) : null,
//     longitude: longitude != null ? String(longitude) : null,
//   };
// }

export function serializeLocation(loc: any) {
  return {
    ...loc,

    id: loc.id ? loc.id.toString() : null,

    storeId: loc.storeId ? loc.storeId.toString() : loc.store_id ? loc.store_id.toString() : null,

    radiusKm: loc.radiusKm ? loc.radiusKm.toString() : loc.radius ? loc.radius.toString() : null,

    latitude: loc.latitude != null ? String(loc.latitude) : null,
    longitude: loc.longitude != null ? String(loc.longitude) : null,
  };
}

export function serializeStore<T extends { id: bigint }>(store: T & { locations?: any[] }) {
  const { locations, ...rest } = store as any;
  return {
    ...rest,
    id: rest.id.toString(),
    deletedAt:
      rest.deletedAt instanceof Date ? rest.deletedAt.toISOString() : (rest.deletedAt ?? null),
    locations: Array.isArray(locations) ? locations.map(serializeLocation) : undefined,
  };
}

function locationCreateData(storeId: bigint, locationType: StoreLocationType, body: LocationBody) {
  return {
    storeId,
    locationType,
    addressLine1: body.addressLine1,
    addressLine2: body.addressLine2 ?? null,
    city: body.city,
    state: body.state,
    country: body.country,
    pincode: body.pincode,
    latitude: body.latitude === null || body.latitude === undefined ? null : String(body.latitude),
    longitude:
      body.longitude === null || body.longitude === undefined ? null : String(body.longitude),
    radiusKm: body.radiusKm ?? null,
    openingTime: body.openingTime ?? null,
    closingTime: body.closingTime ?? null,
    serviceability: body.serviceability,
    isActive: body.isActive ?? true,
  };
}

export async function getSellerProfile(userId: number) {
  const rows = await sqlQuery('SELECT * FROM `seller_profiles` WHERE `user_id` = ? LIMIT 1', [
    userId,
  ]);
  return rows[0] ?? null;
}

export async function upsertSellerProfile(
  userId: number,
  data: {
    gstin?: string | null;
    pan?: string | null;
    bankAccountNo?: string | null;
    bankIfsc?: string | null;
    upiId?: string | null;
    kycStatus?: KycStatus;
  },
) {
  const existingRows = await sqlQuery<any>(
    'SELECT * FROM `seller_profiles` WHERE `user_id` = ? LIMIT 1',
    [userId],
  );
  const existing = existingRows[0] ?? null;

  const gstin = data.gstin !== undefined ? (data.gstin?.trim() ?? null) : (existing?.gstin ?? null);
  const pan =
    data.pan !== undefined ? (data.pan?.trim()?.toUpperCase() ?? null) : (existing?.pan ?? null);
  const bankAccountNo =
    data.bankAccountNo !== undefined
      ? (data.bankAccountNo?.trim() ?? null)
      : (existing?.bankAccountNo ?? null);
  const bankIfsc =
    data.bankIfsc !== undefined
      ? (data.bankIfsc?.trim()?.toUpperCase() ?? null)
      : (existing?.bankIfsc ?? null);
  const upiId = data.upiId !== undefined ? (data.upiId?.trim() ?? null) : (existing?.upiId ?? null);

  let kycStatus = data.kycStatus;
  if (kycStatus === undefined) {
    const existingStatus = (existing?.kyc_status ??
      existing?.kycStatus ??
      null) as KycStatus | null;
    const locked =
      existingStatus === 'VERIFIED' ||
      existingStatus === 'IN_REVIEW' ||
      existingStatus === 'REJECTED';
    if (locked) {
      kycStatus = existingStatus!;
    } else if (gstin && pan) {
      kycStatus = 'SUBMITTED';
    } else {
      kycStatus = 'PENDING';
    }
  }

  if (!existing) {
    await sqlExec(
      'INSERT INTO `seller_profiles` (`user_id`, `gstin`, `pan`, `bank_account_no`, `bank_ifsc`, `upi_id`, `kyc_status`) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, gstin, pan, bankAccountNo, bankIfsc, upiId, kycStatus],
    );
  } else {
    await sqlExec(
      'UPDATE `seller_profiles` SET `gstin` = ?, `pan` = ?, `bank_account_no` = ?, `bank_ifsc` = ?, `upi_id` = ?, `kyc_status` = ? WHERE `user_id` = ?',
      [
        data.gstin !== undefined ? (data.gstin?.trim() ?? null) : gstin,
        data.pan !== undefined ? (data.pan?.trim()?.toUpperCase() ?? null) : pan,
        data.bankAccountNo !== undefined ? (data.bankAccountNo?.trim() ?? null) : bankAccountNo,
        data.bankIfsc !== undefined ? (data.bankIfsc?.trim()?.toUpperCase() ?? null) : bankIfsc,
        data.upiId !== undefined ? (data.upiId?.trim() ?? null) : upiId,
        kycStatus,
        userId,
      ],
    );
  }
  const out = await sqlQuery<any>('SELECT * FROM `seller_profiles` WHERE `user_id` = ? LIMIT 1', [
    userId,
  ]);
  // return out[0] ?? null;
  const profile = out[0] ?? null;

  /**
   * Send KYC submitted mail
   */
  const users = await sqlQuery<{
    name: string;
    email: string | null;
  }>('SELECT `name`, `email` FROM `User` WHERE `id` = ? LIMIT 1', [userId]);

  const user = users[0] ?? null;

  if (user?.email && profile?.kyc_status === 'SUBMITTED') {
    void mailServiceAsync({
      to: user.email,
      subject: 'Seller KYC Submitted Successfully',
      html: SellerMailTemplate.sellerProfileSubmitted(user.name),
      text: 'Your seller profile has been submitted successfully.',
    });
  }

  return profile;
}

export async function listStoresForSeller(sellerUserId: number) {
  const rows = await sqlQuery<any>(
    'SELECT `id`, `seller_user_id` as sellerUserId, `store_name` as storeName, `store_slug` as storeSlug, `description`, `support_email` as supportEmail, `support_phone` as supportPhone, `is_active` as isActive, `deleted_at` as deletedAt, `created_at` as createdAt, `updated_at` as updatedAt FROM `stores` WHERE `seller_user_id` = ? AND `deleted_at` IS NULL ORDER BY `created_at` DESC',
    [sellerUserId],
  );
  return rows.map(serializeStore);
}

export async function createStoreForSeller(
  sellerUserId: number,
  body: {
    storeName: string;
    storeSlug?: string;
    description?: string | null;
    supportEmail?: string | null;
    supportPhone?: string | null;
    isActive?: boolean;
  },
) {
  const storeSlug = await allocateStoreSlug(body.storeName, body.storeSlug);
  const res = await sqlExec(
    'INSERT INTO `stores` (`seller_user_id`, `store_name`, `store_slug`, `description`, `support_email`, `support_phone`, `is_active`) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      sellerUserId,
      body.storeName.trim(),
      storeSlug,
      body.description?.trim() ?? null,
      body.supportEmail?.trim() ?? null,
      body.supportPhone?.trim() ?? null,
      body.isActive ?? true,
    ],
  );
  const rows = await sqlQuery<any>(
    'SELECT `id`, `seller_user_id` as sellerUserId, `store_name` as storeName, `store_slug` as storeSlug, `description`, `support_email` as supportEmail, `support_phone` as supportPhone, `is_active` as isActive, `deleted_at` as deletedAt, `created_at` as createdAt, `updated_at` as updatedAt FROM `stores` WHERE `id` = ? LIMIT 1',
    [BigInt(res.insertId as any)],
  );
  // return serializeStore(rows[0]);
  const store = serializeStore(rows[0]);

  /**
   * Send store created mail
   */
  const users = await sqlQuery<{
    name: string;
    email: string | null;
  }>('SELECT `name`, `email` FROM `User` WHERE `id` = ? LIMIT 1', [sellerUserId]);

  const user = users[0] ?? null;

  if (user?.email) {
    void mailServiceAsync({
      to: user.email,
      subject: 'Store Created Successfully',
      html: SellerMailTemplate.storeCreated({
        sellerName: user.name,
        storeName: body.storeName,
      }),
      text: `Your store ${body.storeName} has been created successfully.`,
    });
  }

  return store;
}

export async function getStoreForSeller(
  storeId: bigint,
  sellerUserId: number,
  includeLocations: boolean,
) {
  const storeRows = await sqlQuery<any>(
    'SELECT `id`, `seller_user_id` as sellerUserId, `store_name` as storeName, `store_slug` as storeSlug, `description`, `support_email` as supportEmail, `support_phone` as supportPhone, `is_active` as isActive, `deleted_at` as deletedAt, `created_at` as createdAt, `updated_at` as updatedAt FROM `stores` WHERE `id` = ? AND `seller_user_id` = ? AND `deleted_at` IS NULL LIMIT 1',
    [storeId, sellerUserId],
  );
  const store = storeRows[0] ?? null;
  if (!store) {
    throw ApiError.NOT_FOUND('Store not found');
  }
  if (!includeLocations) return serializeStore(store as any);
  const locRows = await sqlQuery<any>(
    'SELECT * FROM `store_locations` WHERE `store_id` = ? ORDER BY `created_at` DESC',
    [storeId],
  );
  return serializeStore({ ...(store as any), locations: locRows } as any);
}

async function uniqueStoreSlugForUpdate(
  baseInput: string,
  excludeStoreId: bigint,
): Promise<string> {
  const base = slugify(baseInput);
  let slug = base;
  let i = 0;
  for (;;) {
    const otherRows = await sqlQuery<{ id: bigint }>(
      'SELECT `id` FROM `stores` WHERE `store_slug` = ? LIMIT 1',
      [slug],
    );
    const other = otherRows[0] ?? null;
    if (!other || other.id === excludeStoreId) {
      return slug;
    }
    i += 1;
    slug = `${base}-${i}`;
  }
}

export async function updateStoreForSeller(
  storeId: bigint,
  sellerUserId: number,
  body: Partial<{
    storeName: string;
    storeSlug: string;
    description: string | null;
    supportEmail: string | null;
    supportPhone: string | null;
    isActive: boolean;
  }>,
) {
  const currentRows = await sqlQuery<any>(
    'SELECT `id`, `seller_user_id` as sellerUserId, `store_name` as storeName, `store_slug` as storeSlug, `description`, `support_email` as supportEmail, `support_phone` as supportPhone, `is_active` as isActive, `deleted_at` as deletedAt, `created_at` as createdAt, `updated_at` as updatedAt FROM `stores` WHERE `id` = ? AND `seller_user_id` = ? AND `deleted_at` IS NULL LIMIT 1',
    [storeId, sellerUserId],
  );
  const current = currentRows[0] ?? null;
  if (!current) {
    throw ApiError.NOT_FOUND('Store not found');
  }

  let nextSlug = current.storeSlug;
  if (body.storeSlug !== undefined) {
    const desired = slugify(body.storeSlug);
    if (desired !== current.storeSlug) {
      nextSlug = await uniqueStoreSlugForUpdate(body.storeSlug, storeId);
    }
  }

  await sqlExec(
    'UPDATE `stores` SET `store_name` = ?, `store_slug` = ?, `description` = ?, `support_email` = ?, `support_phone` = ?, `is_active` = ? WHERE `id` = ?',
    [
      body.storeName !== undefined ? body.storeName.trim() : current.storeName,
      body.storeSlug !== undefined ? nextSlug : current.storeSlug,
      body.description !== undefined ? (body.description?.trim() ?? null) : current.description,
      body.supportEmail !== undefined ? (body.supportEmail?.trim() ?? null) : current.supportEmail,
      body.supportPhone !== undefined ? (body.supportPhone?.trim() ?? null) : current.supportPhone,
      body.isActive !== undefined ? body.isActive : current.isActive,
      storeId,
    ],
  );
  const rows = await sqlQuery<any>(
    'SELECT `id`, `seller_user_id` as sellerUserId, `store_name` as storeName, `store_slug` as storeSlug, `description`, `support_email` as supportEmail, `support_phone` as supportPhone, `is_active` as isActive, `deleted_at` as deletedAt, `created_at` as createdAt, `updated_at` as updatedAt FROM `stores` WHERE `id` = ? LIMIT 1',
    [storeId],
  );
  return serializeStore(rows[0]);
}

/** Frees `storeSlug` for reuse while keeping the row (soft delete). */
async function uniqueArchivedStoreSlug(storeId: bigint, baseSlug: string): Promise<string> {
  const suffix = `-d-${storeId.toString()}`;
  for (let n = 0; n < 100; n++) {
    const extra = n === 0 ? '' : `-${n}`;
    const budget = 255 - suffix.length - extra.length;
    const stem = baseSlug.slice(0, Math.max(1, budget));
    const candidate = `${stem}${extra}${suffix}`.slice(0, 255);
    const clashRows = await sqlQuery<{ id: bigint }>(
      'SELECT `id` FROM `stores` WHERE `store_slug` = ? AND `id` <> ? LIMIT 1',
      [candidate, storeId],
    );
    const clash = clashRows[0] ?? null;
    if (!clash) return candidate;
  }
  throw ApiError.CONFLICT('Could not allocate archived store slug');
}

export async function deleteStoreForSeller(storeId: bigint, sellerUserId: number) {
  const storeRows = await sqlQuery<any>(
    'SELECT `id`, `store_slug` as storeSlug FROM `stores` WHERE `id` = ? AND `seller_user_id` = ? AND `deleted_at` IS NULL LIMIT 1',
    [storeId, sellerUserId],
  );
  const store = storeRows[0] ?? null;
  if (!store) {
    throw ApiError.NOT_FOUND('Store not found');
  }
  const archivedSlug = await uniqueArchivedStoreSlug(storeId, store.storeSlug);
  await sqlExec(
    'UPDATE `stores` SET `deleted_at` = NOW(), `is_active` = false, `store_slug` = ? WHERE `id` = ?',
    [archivedSlug, storeId],
  );
}

export async function createLocation(
  storeId: bigint,
  sellerUserId: number,
  locationType: StoreLocationType,
  body: LocationBody,
) {
  await assertStoreOwnedBySeller(storeId, sellerUserId);
  const d = locationCreateData(storeId, locationType, body);
  const res = await sqlExec(
    'INSERT INTO `store_locations` (`store_id`, `location_type`, `address_line1`, `address_line2`, `city`, `state`, `country`, `pincode`, `latitude`, `longitude`, `radius`, `opening_time`, `closing_time`, `serviceability`, `is_active`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      d.storeId,
      d.locationType,
      d.addressLine1,
      d.addressLine2,
      d.city,
      d.state,
      d.country,
      d.pincode,
      d.latitude,
      d.longitude,
      d.radiusKm,
      d.openingTime,
      d.closingTime,
      d.serviceability,
      d.isActive,
    ],
  );
  const rows = await sqlQuery<any>('SELECT * FROM `store_locations` WHERE `id` = ? LIMIT 1', [
    BigInt(res.insertId as any),
  ]);
  return serializeLocation(rows[0]);
}

export async function createPickupAndReturn(
  storeId: bigint,
  sellerUserId: number,
  pickup: LocationBody,
  ret: LocationBody,
) {
  await assertStoreOwnedBySeller(storeId, sellerUserId);
  return withSqlTransaction(async (tx) => {
    const a = locationCreateData(storeId, 'SELF_PICKUP', pickup);
    const b = locationCreateData(storeId, 'RETURN', ret);
    const ra = await sqlExec(
      'INSERT INTO `store_locations` (`store_id`, `location_type`, `address_line1`, `address_line2`, `city`, `state`, `country`, `pincode`, `latitude`, `longitude`, `radius`, `opening_time`, `closing_time`, `serviceability`, `is_active`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        a.storeId,
        a.locationType,
        a.addressLine1,
        a.addressLine2,
        a.city,
        a.state,
        a.country,
        a.pincode,
        a.latitude,
        a.longitude,
        a.radiusKm,
        a.openingTime,
        a.closingTime,
        a.serviceability,
        a.isActive,
      ],
      tx,
    );
    const rb = await sqlExec(
      'INSERT INTO `store_locations` (`store_id`, `location_type`, `address_line1`, `address_line2`, `city`, `state`, `country`, `pincode`, `latitude`, `longitude`, `radius`, `opening_time`, `closing_time`, `serviceability`, `is_active`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        b.storeId,
        b.locationType,
        b.addressLine1,
        b.addressLine2,
        b.city,
        b.state,
        b.country,
        b.pincode,
        b.latitude,
        b.longitude,
        b.radiusKm,
        b.openingTime,
        b.closingTime,
        b.serviceability,
        b.isActive,
      ],
      tx,
    );
    const [aRow] = await sqlQuery<any>(
      'SELECT * FROM `store_locations` WHERE `id` = ? LIMIT 1',
      [BigInt(ra.insertId as any)],
      tx,
    );
    const [bRow] = await sqlQuery<any>(
      'SELECT * FROM `store_locations` WHERE `id` = ? LIMIT 1',
      [BigInt(rb.insertId as any)],
      tx,
    );
    return { pickup: serializeLocation(aRow), return: serializeLocation(bRow) };
  });
}

export async function getDashboardSummary(sellerUserId: number) {
  const [profileRows, storeCountRows, activeStoreCountRows, locationCountRows] = await Promise.all([
    sqlQuery<any>('SELECT * FROM `seller_profiles` WHERE `user_id` = ? LIMIT 1', [sellerUserId]),
    sqlQuery<{ total: number }>(
      'SELECT COUNT(*) as total FROM `stores` WHERE `seller_user_id` = ? AND `deleted_at` IS NULL',
      [sellerUserId],
    ),
    sqlQuery<{ total: number }>(
      'SELECT COUNT(*) as total FROM `stores` WHERE `seller_user_id` = ? AND `deleted_at` IS NULL AND `is_active` = true',
      [sellerUserId],
    ),
    sqlQuery<{ total: number }>(
      'SELECT COUNT(*) as total FROM `store_locations` sl JOIN `stores` s ON s.`id` = sl.`store_id` WHERE s.`seller_user_id` = ? AND s.`deleted_at` IS NULL',
      [sellerUserId],
    ),
  ]);
  const profile = profileRows[0] ?? null;
  const storeCount = Number(storeCountRows?.[0]?.total ?? 0);
  const activeStoreCount = Number(activeStoreCountRows?.[0]?.total ?? 0);
  const locationCount = Number(locationCountRows?.[0]?.total ?? 0);

  return {
    kycStatus: (profile?.kyc_status ?? 'PENDING') as KycStatus,
    profileCompleteness: {
      hasGstin: Boolean(profile?.gstin),
      hasPan: Boolean(profile?.pan),
      hasBank: Boolean(profile?.bank_account_no && profile?.bank_ifsc),
      hasUpi: Boolean(profile?.upi_id),
    },
    storeCount,
    activeStoreCount,
    locationCount,
  };
}
