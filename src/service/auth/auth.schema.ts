import { z } from 'zod';
import { UserRole } from '~/generated/prisma/enums';

function hasControlChars(val: string): boolean {
  // Checks for ASCII control characters (0x00-0x1F, 0x7F)
  for (let i = 0; i < val.length; i++) {
    const code = val.charCodeAt(i);
    if ((code >= 0x00 && code <= 0x1f) || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export const PhoneNumberSchema = z.object({
  phoneNumber: z
    .string()
    .trim()
    .min(10, { message: 'Phone number must be at least 10 characters long.' })
    .max(15, { message: 'Phone number must be at most 15 characters long.' })
    .regex(/^[0-9]{10}$/, { message: 'Please enter a valid phone number.' }),
});

export const RegisterSchema = PhoneNumberSchema.extend({
  name: z
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
  isLoginWithPassword: z.boolean().default(false),
  isLoginWithOtp: z.boolean().default(false),
  loginRole: z.enum([UserRole.USER, UserRole.ADMIN]).default(UserRole.USER),
  rememberMe: z.boolean().default(false),
  password: z
    .string()
    .trim()
    .min(1, { message: 'Password field must not be empty.' })
    .refine((val) => !hasControlChars(val), {
      message: 'Password cannot contain escape sequences or control characters.',
    }),
});

export const OTPVerifySchema = PhoneNumberSchema.extend({
  tokens: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
    }),
  ),
  otp: z
    .string()
    .trim()
    .min(6, { message: 'OTP must be at least 6 characters long.' })
    .refine((val) => !hasControlChars(val), {
      message: 'Password cannot contain escape sequences or control characters.',
    }),
});

export const OTPResendSchema = PhoneNumberSchema.extend({
  token: z
    .string()
    .trim()
    .refine((val) => !hasControlChars(val), {
      message: 'Password cannot contain escape sequences or control characters.',
    }),
});

export const ResetPasswordSchema = OTPResendSchema.extend({
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
