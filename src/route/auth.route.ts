import {
  OTPSchema,
  LoginSchema,
  RegisterSchema,
  OTPVerifySchema,
  PhoneNumberSchema,
  ResetPasswordSchema,
} from '~/service/auth/auth.schema';
import express from 'express';
import { validate } from '~/middleware/validate';
import { authService } from '../service/auth/auth.service';

const router = express.Router();

/**
 * @desc    Register a new user and send OTP
 * @route   POST /auth/register
 * @access  Public
 */
router.post('/register', validate({ body: RegisterSchema }), authService.register);

/**
 * @desc    Login a user and send OTP
 * @route   POST /auth/login
 * @access  Public
 */
router.post('/login', validate({ body: LoginSchema }), authService.login);

/**
 * @desc    Logout a user
 * @route   DELETE /auth/logout
 * @access  Private
 */
router.delete('/logout', authService.logout);

/**
 * @desc    Preview OTP verification for credential account
 * @route   POST /auth/credential-account/preview
 * @access  Public
 */
router.post(
  '/credential-account/preview',
  validate({ body: OTPSchema }),
  authService.otpVerificationForCredentialAccountPreviewData,
);

/**
 * @desc    Verify OTP for credential account
 * @route   POST /auth/credential-account/verify
 * @access  Public
 */
router.post(
  '/credential-account/verify',
  validate({ body: OTPVerifySchema }),
  authService.otpVerificationForCredentialAccount,
);

/**
 * @desc    Resend OTP for credential account
 * @route   POST /auth/credential-account/resend
 * @access  Public
 */
router.post(
  '/credential-account/resend',
  validate({ body: OTPSchema }),
  authService.otpResendForCredentialAccount,
);

/**
 * @desc    Initiate forgot password
 * @route   POST /auth/forgot-password/initiate
 * @access  Public
 */
router.post(
  '/forgot-password/initiate',
  validate({ body: PhoneNumberSchema }),
  authService.forgotPasswordForCredentialAccountTokenGenerate,
);

/**
 * @desc    Preview forgot password
 * @route   POST /auth/forgot-password/preview
 * @access  Public
 */
router.post(
  '/forgot-password/preview',
  validate({ body: OTPSchema }),
  authService.forgotPasswordForCredentialAccountPreviewData,
);

/**
 * @desc    Resend forgot password
 * @route   POST /auth/forgot-password/resend
 * @access  Public
 */
router.post(
  '/forgot-password/resend',
  validate({ body: OTPSchema }),
  authService.forgotPasswordForCredentialAccountTokenResend,
);

/**
 * @desc    Verify forgot password
 * @route   POST /auth/forgot-password/verify
 * @access  Public
 */
router.post(
  '/forgot-password/verify',
  validate({ body: OTPVerifySchema }),
  authService.forgotPasswordForCredentialAccountOtpVerification,
);

/**
 * @desc    Reset password
 * @route   POST /auth/forgot-password/reset
 * @access  Public
 */
router.post(
  '/forgot-password/reset',
  validate({ body: ResetPasswordSchema }),
  authService.resetPasswordForCredentialAccount,
);

/**
 * @desc    Get user
 * @route   GET /auth/user
 * @access  Public
 */
router.get('/user', authService.authenticate, authService.getUser);

/**
 * @desc    Refresh token
 * @route   POST /auth/refresh-token
 * @access  Public
 */
router.post('/refresh-token', authService.getNewAccessTokenUsingRefreshToken);

export { router as authRouter };
