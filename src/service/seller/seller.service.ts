import { db } from '~/lib/db';
import { ApiError } from '~/lib/response';
import { KycStatus, StoreLocationType } from '~/generated/prisma/enums';

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
    const hit = await db.store.findUnique({ where: { storeSlug: slug }, select: { id: true } });
    if (!hit) return slug;
    i += 1;
    slug = `${base}-${i}`;
  }
}

export async function assertStoreOwnedBySeller(storeId: bigint, sellerUserId: number) {
  const store = await db.store.findFirst({
    where: { id: storeId, sellerUserId, ...storeIsActiveRow },
  });
  if (!store) {
    throw ApiError.NOT_FOUND('Store not found');
  }
  return store;
}

export function serializeLocation(loc: {
  id: bigint;
  storeId: bigint;
  radiusKm: bigint | null;
  latitude?: unknown;
  longitude?: unknown;
  [key: string]: unknown;
}) {
  const { id, storeId, radiusKm, latitude, longitude, ...rest } = loc;
  return {
    ...rest,
    id: id.toString(),
    storeId: storeId.toString(),
    radiusKm: radiusKm !== null ? radiusKm.toString() : null,
    latitude: latitude != null ? String(latitude) : null,
    longitude: longitude != null ? String(longitude) : null,
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
  return db.sellerProfile.findUnique({ where: { userId } });
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
  const existing = await db.sellerProfile.findUnique({ where: { userId } });

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
    const locked =
      existing?.kycStatus === KycStatus.VERIFIED ||
      existing?.kycStatus === KycStatus.IN_REVIEW ||
      existing?.kycStatus === KycStatus.REJECTED;
    if (locked) {
      kycStatus = existing!.kycStatus;
    } else if (gstin && pan) {
      kycStatus = KycStatus.SUBMITTED;
    } else {
      kycStatus = KycStatus.PENDING;
    }
  }

  return db.sellerProfile.upsert({
    where: { userId },
    create: {
      userId,
      gstin,
      pan,
      bankAccountNo,
      bankIfsc,
      upiId,
      kycStatus,
    },
    update: {
      ...(data.gstin !== undefined && { gstin: data.gstin?.trim() ?? null }),
      ...(data.pan !== undefined && { pan: data.pan?.trim()?.toUpperCase() ?? null }),
      ...(data.bankAccountNo !== undefined && {
        bankAccountNo: data.bankAccountNo?.trim() ?? null,
      }),
      ...(data.bankIfsc !== undefined && {
        bankIfsc: data.bankIfsc?.trim()?.toUpperCase() ?? null,
      }),
      ...(data.upiId !== undefined && { upiId: data.upiId?.trim() ?? null }),
      kycStatus,
    },
  });
}

export async function listStoresForSeller(sellerUserId: number) {
  const rows = await db.store.findMany({
    where: { sellerUserId, ...storeIsActiveRow },
    orderBy: { createdAt: 'desc' },
  });
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
  const store = await db.store.create({
    data: {
      sellerUserId,
      storeName: body.storeName.trim(),
      storeSlug,
      description: body.description?.trim() ?? null,
      supportEmail: body.supportEmail?.trim() ?? null,
      supportPhone: body.supportPhone?.trim() ?? null,
      isActive: body.isActive ?? true,
    },
  });
  return serializeStore(store);
}

export async function getStoreForSeller(
  storeId: bigint,
  sellerUserId: number,
  includeLocations: boolean,
) {
  const store = await db.store.findFirst({
    where: { id: storeId, sellerUserId, ...storeIsActiveRow },
    ...(includeLocations ? { include: { locations: { orderBy: { createdAt: 'desc' } } } } : {}),
  });
  if (!store) {
    throw ApiError.NOT_FOUND('Store not found');
  }
  return serializeStore(store as any);
}

async function uniqueStoreSlugForUpdate(
  baseInput: string,
  excludeStoreId: bigint,
): Promise<string> {
  const base = slugify(baseInput);
  let slug = base;
  let i = 0;
  for (;;) {
    const other = await db.store.findUnique({
      where: { storeSlug: slug },
      select: { id: true },
    });
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
  const current = await db.store.findFirst({
    where: { id: storeId, sellerUserId, ...storeIsActiveRow },
  });
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

  const updated = await db.store.update({
    where: { id: storeId },
    data: {
      ...(body.storeName !== undefined && { storeName: body.storeName.trim() }),
      ...(body.storeSlug !== undefined && { storeSlug: nextSlug }),
      ...(body.description !== undefined && { description: body.description?.trim() ?? null }),
      ...(body.supportEmail !== undefined && { supportEmail: body.supportEmail?.trim() ?? null }),
      ...(body.supportPhone !== undefined && { supportPhone: body.supportPhone?.trim() ?? null }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
    },
  });
  return serializeStore(updated);
}

/** Frees `storeSlug` for reuse while keeping the row (soft delete). */
async function uniqueArchivedStoreSlug(storeId: bigint, baseSlug: string): Promise<string> {
  const suffix = `-d-${storeId.toString()}`;
  for (let n = 0; n < 100; n++) {
    const extra = n === 0 ? '' : `-${n}`;
    const budget = 255 - suffix.length - extra.length;
    const stem = baseSlug.slice(0, Math.max(1, budget));
    const candidate = `${stem}${extra}${suffix}`.slice(0, 255);
    const clash = await db.store.findFirst({
      where: { storeSlug: candidate, NOT: { id: storeId } },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  throw ApiError.CONFLICT('Could not allocate archived store slug');
}

export async function deleteStoreForSeller(storeId: bigint, sellerUserId: number) {
  const store = await db.store.findFirst({
    where: { id: storeId, sellerUserId, ...storeIsActiveRow },
  });
  if (!store) {
    throw ApiError.NOT_FOUND('Store not found');
  }
  const archivedSlug = await uniqueArchivedStoreSlug(storeId, store.storeSlug);
  await db.store.update({
    where: { id: storeId },
    data: {
      deletedAt: new Date(),
      isActive: false,
      storeSlug: archivedSlug,
    },
  });
}

export async function createLocation(
  storeId: bigint,
  sellerUserId: number,
  locationType: StoreLocationType,
  body: LocationBody,
) {
  await assertStoreOwnedBySeller(storeId, sellerUserId);
  const row = await db.storeLocation.create({
    data: locationCreateData(storeId, locationType, body),
  });
  return serializeLocation(row);
}

export async function createPickupAndReturn(
  storeId: bigint,
  sellerUserId: number,
  pickup: LocationBody,
  ret: LocationBody,
) {
  await assertStoreOwnedBySeller(storeId, sellerUserId);
  const [a, b] = await db.$transaction([
    db.storeLocation.create({
      data: locationCreateData(storeId, StoreLocationType.SELF_PICKUP, pickup),
    }),
    db.storeLocation.create({
      data: locationCreateData(storeId, StoreLocationType.RETURN, ret),
    }),
  ]);
  return { pickup: serializeLocation(a), return: serializeLocation(b) };
}

export async function getDashboardSummary(sellerUserId: number) {
  const [profile, storeCount, activeStoreCount, locationCount] = await Promise.all([
    db.sellerProfile.findUnique({ where: { userId: sellerUserId } }),
    db.store.count({ where: { sellerUserId, ...storeIsActiveRow } }),
    db.store.count({ where: { sellerUserId, ...storeIsActiveRow, isActive: true } }),
    db.storeLocation.count({
      where: { store: { sellerUserId, ...storeIsActiveRow } },
    }),
  ]);

  return {
    kycStatus: profile?.kycStatus ?? KycStatus.PENDING,
    profileCompleteness: {
      hasGstin: Boolean(profile?.gstin),
      hasPan: Boolean(profile?.pan),
      hasBank: Boolean(profile?.bankAccountNo && profile?.bankIfsc),
      hasUpi: Boolean(profile?.upiId),
    },
    storeCount,
    activeStoreCount,
    locationCount,
  };
}
