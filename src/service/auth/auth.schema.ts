import { z } from 'zod';
import { UserRole } from '~/generated/prisma/enums';

function hasControlChars(val: string): boolean {
  for (let i = 0; i < val.length; i++) {
    const code = val.charCodeAt(i);
    if ((code >= 0x00 && code <= 0x1f) || code === 0x7f) {
      return true;
    }
  }
  return false;
}

// phone number must start with country code with +
export const PhoneNumberSchema = z.object({
  phoneNumber: z
    .string()
    .trim()
    .min(10, { message: 'Phone number must be at least 10 characters long.' })
    .max(15, { message: 'Phone number must be at most 15 characters long.' })
    .regex(/^\+[1-9]\d{1,14}$/, { message: 'Please enter a valid phone number.' }),
});

export const RegisterSchema = PhoneNumberSchema.extend({
  fullName: z
    .string()
    .trim()
    .min(2, { message: 'Name must be at least 2 characters long.' })
    .max(40, { message: 'Name must be at most 40 characters long.' })
    .transform((val) => val.replace(/\s+/g, ' '))
    .refine((val) => /^[A-Za-z]+(?: [A-Za-z]+)*$/.test(val), {
      message: 'Name can only contain letters.',
    }),
  email: z.email({ message: 'Please enter a valid email.' }).optional(),
  password: z
    .string()
    .trim()
    .min(8, { message: 'Be at least 8 characters long' })
    .max(50, { message: 'Password must be at most 50 characters long' })
    .regex(/[a-zA-Z]/, { message: 'Contain at least one letter.' })
    .regex(/[0-9]/, { message: 'Contain at least one number.' })
    .regex(/[^a-zA-Z0-9]/, {
      message: 'Contain at least one special character.',
    })
    .refine((val) => !hasControlChars(val), {
      message: 'Password cannot contain escape sequences or control characters.',
    }),
});

export const LoginSchema = PhoneNumberSchema.extend({
  email: z.email({ message: 'Please enter a valid email.' }).optional(),
  isLoginWithPassword: z.boolean().default(false),
  isLoginWithOtp: z.boolean().default(false),
  loginRole: z.enum([UserRole.USER, UserRole.ADMIN]).default(UserRole.USER),
  rememberMe: z.boolean().default(false),
  password: z
    .string()
    .trim()
    .refine((val) => !hasControlChars(val), {
      message: 'Password cannot contain escape sequences or control characters.',
    })
    .optional(),
}).superRefine(({ isLoginWithPassword, password }, ctx) => {
  if (isLoginWithPassword && (!password || password.length < 1)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Password field must not be empty.',
      path: ['password'],
    });
  }
});

export const OTPVerifySchema = PhoneNumberSchema.extend({
  tokens: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    }),
  ),
  otp: z
    .union([z.string(), z.number()])
    .transform((val) => String(val).trim())
    .pipe(
      z
        .string()
        .min(6, { message: 'OTP must be at least 6 characters long.' })
        .refine((val) => !hasControlChars(val), {
          message: 'OTP cannot contain escape sequences or control characters.',
        }),
    ),
  rememberMe: z.boolean().default(false).optional(),
});

export const OTPSchema = PhoneNumberSchema.extend({
  tokens: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    }),
  ),
});

export const ResetPasswordSchema = OTPSchema.extend({
  password: z
    .string()
    .trim()
    .min(8, { message: 'Be at least 8 characters long' })
    .max(50, { message: 'Password must be at most 50 characters long' })
    .regex(/[a-zA-Z]/, { message: 'Contain at least one letter.' })
    .regex(/[0-9]/, { message: 'Contain at least one number.' })
    .regex(/[^a-zA-Z0-9]/, {
      message: 'Contain at least one special character.',
    })
    .refine((val) => !hasControlChars(val), {
      message: 'Password cannot contain escape sequences or control characters.',
    }),
});
