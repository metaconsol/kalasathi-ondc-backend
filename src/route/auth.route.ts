import express from 'express';

// ─── Validation schemas ───────────────────────────────────────────────────────
import {
  OTPSchema,
  LoginSchema,
  RegisterSchema,
  OTPVerifySchema,
  PhoneNumberSchema,
  ResetPasswordSchema,
} from '~/service/auth/auth.schema';

// ─── Middleware ───────────────────────────────────────────────────────────────
import { validate } from '~/middleware/validate';
import { authMiddleware } from '~/middleware/auth.middleware';

// ─── Controller ───────────────────────────────────────────────────────────────
// All handlers are now imported from auth.controller instead of authService
// directly, following the Route → Controller → Service pattern.
import {
  login,
  logout,
  register,
  getUser,
  refreshToken,
  otpPreview,
  otpVerify,
  otpResend,
  forgotPasswordInitiate,
  forgotPasswordPreview,
  forgotPasswordResend,
  forgotPasswordVerify,
  forgotPasswordReset,
  SellerRegister,
  CreateSellerProfile,
  CreateStoreForSeller,
  GetSellerProfile,
} from '~/controller/auth.controller';
import { sellerAuthMiddleware } from '~/middleware/seller.middleware';

const router = express.Router();

// ─── Public routes ────────────────────────────────────────────────────────────

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register a new user (creates account + sends OTP for verification)
 */
router.post('/register', validate({ body: RegisterSchema }), register);

/**
 * @route   POST /api/v1/auth/login
 * @desc    Login with password or request OTP
 * @body    { phoneNumber, password?, isLoginWithPassword, isLoginWithOtp, loginRole?, rememberMe? }
 */
router.post('/login', validate({ body: LoginSchema }), login);

/**
 * @route   DELETE /api/v1/auth/logout
 * @desc    Logout — clears the refreshToken cookie
 */
router.delete('/logout', logout);

/**
 * @route   POST /api/v1/auth/refresh-token
 * @desc    Get a new access token using the refreshToken cookie
 */
router.post('/refresh-token', refreshToken);

// ─── Protected routes ─────────────────────────────────────────────────────────

/**
 * @route   GET /api/v1/auth/user
 * @desc    Get current authenticated user
 * @access  Private
 */
router.get('/user', authMiddleware, getUser);

/** Alias for clients expecting `/auth/me` (e.g. Mrignayanee-style collections). */
router.get('/me', authMiddleware, getUser);

// ─── OTP: Credential account verification ────────────────────────────────────

/**
 * @route   POST /api/v1/auth/credential-account/preview
 * @desc    Preview user info before OTP entry
 */
router.post('/credential-account/preview', validate({ body: OTPSchema }), otpPreview);

/**
 * @route   POST /api/v1/auth/credential-account/verify
 * @desc    Verify OTP and activate account
 */
router.post('/credential-account/verify', validate({ body: OTPVerifySchema }), otpVerify);

/**
 * @route   POST /api/v1/auth/credential-account/resend
 * @desc    Resend OTP for account verification
 */
router.post('/credential-account/resend', validate({ body: OTPSchema }), otpResend);

// ─── Forgot password flow ─────────────────────────────────────────────────────

/**
 * @route   POST /api/v1/auth/forgot-password/initiate
 * @desc    Send OTP to phone to begin password reset
 */
router.post(
  '/forgot-password/initiate',
  validate({ body: PhoneNumberSchema }),
  forgotPasswordInitiate,
);

/**
 * @route   POST /api/v1/auth/forgot-password/preview
 * @desc    Validate reset token before showing reset form
 */
router.post('/forgot-password/preview', validate({ body: OTPSchema }), forgotPasswordPreview);

/**
 * @route   POST /api/v1/auth/forgot-password/resend
 * @desc    Resend OTP for password reset
 */
router.post('/forgot-password/resend', validate({ body: OTPSchema }), forgotPasswordResend);

/**
 * @route   POST /api/v1/auth/forgot-password/verify
 * @desc    Verify OTP for password reset
 */
router.post('/forgot-password/verify', validate({ body: OTPVerifySchema }), forgotPasswordVerify);

/**
 * @route   POST /api/v1/auth/forgot-password/reset
 * @desc    Reset the password after OTP verification
 */
router.post('/forgot-password/reset', validate({ body: ResetPasswordSchema }), forgotPasswordReset);

/**
 * @route   POST /api/v1/auth/Sellerregister
 * @desc    Register a  SellerRegister (creates account + sends OTP for verification)
 *  Four Way verification Process
 */

router.post('/seller/register', validate({ body: RegisterSchema }), SellerRegister);
router.post('/seller/register/profile', authMiddleware, CreateSellerProfile);
router.get('/seller/profile', authMiddleware, GetSellerProfile);
router.post('/seller/register/store', sellerAuthMiddleware, CreateStoreForSeller);

export { router as authRouter };
