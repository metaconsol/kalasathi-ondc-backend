import { z } from 'zod';
import { KycStatus, StoreLocationType } from '~/generated/prisma/enums';

const hhmm = z
  .number()
  .int()
  .min(0)
  .max(2359)
  .refine((n) => n % 100 < 60, { message: 'Invalid time: minutes must be 00–59' });

export const StoreIdParamsSchema = z.object({
  storeId: z.preprocess(
    (v) => (typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : v),
    z.bigint({ message: 'storeId must be a positive integer' }),
  ),
});

export const UpdateSellerProfileBodySchema = z.object({
  gstin: z.string().trim().max(15).optional().nullable(),
  pan: z.string().trim().max(10).optional().nullable(),
  bankAccountNo: z.string().trim().max(34).optional().nullable(),
  bankIfsc: z.string().trim().max(11).optional().nullable(),
  upiId: z.string().trim().max(256).optional().nullable(),
  kycStatus: z.nativeEnum(KycStatus).optional(),
});

export const CreateStoreBodySchema = z.object({
  storeName: z.string().trim().min(1).max(255),
  storeSlug: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message: 'storeSlug must be lowercase letters, numbers, and single hyphens',
    })
    .optional(),
  description: z.string().max(20000).optional().nullable(),
  supportEmail: z.string().email().max(255).optional().nullable(),
  supportPhone: z.string().trim().max(20).optional().nullable(),
  isActive: z.boolean().optional(),
});

export const UpdateStoreBodySchema = CreateStoreBodySchema.partial().extend({
  storeName: z.string().trim().min(1).max(255).optional(),
});

const baseLocationFields = z.object({
  addressLine1: z.string().trim().min(1).max(255),
  addressLine2: z.string().trim().max(255).optional().nullable(),
  city: z.string().trim().min(1).max(120),
  state: z.string().trim().min(1).max(120),
  country: z.string().trim().min(1).max(120),
  pincode: z.string().trim().min(1).max(20),
  latitude: z.union([z.string(), z.number()]).optional().nullable(),
  longitude: z.union([z.string(), z.number()]).optional().nullable(),
  radiusKm: z.coerce.bigint().nonnegative().optional().nullable(),
  openingTime: hhmm.optional().nullable(),
  closingTime: hhmm.optional().nullable(),
  serviceability: z.union([z.literal(10), z.literal(11), z.literal(12), z.literal(13)]),
  isActive: z.boolean().optional(),
});

export const CreateStoreLocationBodySchema = baseLocationFields;

export const CreatePickupAndReturnBodySchema = z.object({
  pickup: baseLocationFields,
  return: baseLocationFields,
});

export const OnboardingCreateStoreBodySchema = CreateStoreBodySchema;

export const OnboardingStep4BodySchema = baseLocationFields.extend({
  storeId: z.preprocess(
    (v) => (typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : v),
    z.bigint({ message: 'storeId must be a positive integer' }),
  ),
});
