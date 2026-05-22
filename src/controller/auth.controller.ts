import type { Request, Response } from 'express';
import { authService } from '~/service/auth/auth.service';

// ─── Auth Controller ──────────────────────────────────────────────────────────
//
// This controller acts as a thin layer between the route and the AuthService.
// It delegates all business logic to authService, keeping handlers clean and
// focused only on HTTP request/response handling.
//
// Route mapping (registered in auth.route.ts under /api/v1/auth):
//
//   POST   /login                          → login
//   POST   /register                       → register
//   DELETE /logout                         → logout
//   GET    /user                           → getUser
//   POST   /refresh-token                  → refreshToken
//   POST   /credential-account/preview     → otpPreview
//   POST   /credential-account/verify      → otpVerify
//   POST   /credential-account/resend      → otpResend
//   POST   /forgot-password/initiate       → forgotPasswordInitiate
//   POST   /forgot-password/preview        → forgotPasswordPreview
//   POST   /forgot-password/resend         → forgotPasswordResend
//   POST   /forgot-password/verify         → forgotPasswordVerify
//   POST   /forgot-password/reset          → forgotPasswordReset
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @desc    Login a user
 * @route   POST /api/v1/auth/login
 * @access  Public
 *
 * Supports two modes (controlled by body flags):
 *   - isLoginWithPassword: true  → validates phone + password, returns JWT tokens
 *   - isLoginWithOtp: true       → sends OTP to the phone number, returns verification token
 *
 * Request body:
 *   {
 *     phoneNumber:       string   (required, E.164 format e.g. +919876543210)
 *     password:          string   (required if isLoginWithPassword = true)
 *     isLoginWithPassword: boolean
 *     isLoginWithOtp:    boolean
 *     loginRole:         "USER" | "ADMIN" | "SUPER_ADMIN"  (default: "USER")
 *     rememberMe:        boolean           (default: false)
 *     email:             string            (optional)
 *   }
 *
 * Response (password login success):
 *   Sets Authorization header: Bearer <accessToken>
 *   Sets Cookie: refreshToken=<token>
 *   Body: { success: true, message: "Login successful", data: { user, accessToken } }
 *   (`accessToken` duplicates the JWT for clients that read JSON only.)
 *
 * Response (OTP login):
 *   Body: { success: true, message: "OTP sent...", data: { tokens: [...] } }
 */
export const login = async (req: Request, res: Response) => {
  // Delegate entirely to authService.login which handles both
  // password-based and OTP-based login flows
  return authService.login(req, res);
};

/**
 * @desc    Register a new user
 * @route   POST /api/v1/auth/register
 * @access  Public
 *
 * Creates a new user with CREDENTIALS account and sends OTP for verification.
 *
 * Request body:
 *   {
 *     fullName:    string  (2–40 chars, letters only)
 *     phoneNumber: string  (E.164 format)
 *     password:    string  (min 8 chars, must include letter, number, special char)
 *     email:       string  (optional, valid email)
 *   }
 */
export const register = async (req: Request, res: Response) => {
  return authService.register(req, res);
};

export const SellerRegister = async (req: Request, res: Response) => {
  return authService.SellerRegister(req, res);
};

export const CreateSellerProfile = async (req: Request, res: Response) => {
  return authService.createSellerProfile(req, res);
};

export const GetSellerProfile = async (req: Request, res: Response) => {
  return authService.getSellerProfile(req, res);
};

export const CreateStoreForSeller = async (req: Request, res: Response) => {
  return authService.createStoreLocation(req, res);
};

/**
 * @desc    Logout the current user
 * @route   DELETE /api/v1/auth/logout
 * @access  Private
 *
 * Clears the refreshToken cookie from the client.
 */
export const logout = async (req: Request, res: Response) => {
  return authService.logout(req, res);
};

/**
 * @desc    Get the currently authenticated user's profile
 * @route   GET /api/v1/auth/user
 * @access  Private (requires authMiddleware)
 *
 * Returns the user payload attached to req.user by the auth middleware.
 */
export const getUser = async (req: Request, res: Response) => {
  return authService.getUser(req, res);
};

/**
 * @desc    Issue a new access token using the refresh token cookie
 * @route   POST /api/v1/auth/refresh-token
 * @access  Public (refresh token in cookie is the credential)
 *
 * Reads Cookie: refreshToken, verifies it, and returns a fresh access token
 * in the Authorization response header.
 */
export const refreshToken = async (req: Request, res: Response) => {
  return authService.getNewAccessTokenUsingRefreshToken(req, res);
};

// ─── OTP: Credential Account Verification ────────────────────────────────────

/**
 * @desc    Preview data for OTP verification (credential account)
 * @route   POST /api/v1/auth/credential-account/preview
 * @access  Public
 *
 * Returns user info (name, phone) for the given verification token,
 * allowing the UI to display a confirmation screen before the user enters OTP.
 */
export const otpPreview = async (req: Request, res: Response) => {
  return authService.otpVerificationForCredentialAccountPreviewData(req, res);
};

/**
 * @desc    Verify OTP and activate a credential account
 * @route   POST /api/v1/auth/credential-account/verify
 * @access  Public
 *
 * Validates the OTP, marks the account as ACTIVE, and returns JWT tokens.
 */
export const otpVerify = async (req: Request, res: Response) => {
  return authService.otpVerificationForCredentialAccount(req, res);
};

/**
 * @desc    Resend OTP for credential account verification
 * @route   POST /api/v1/auth/credential-account/resend
 * @access  Public
 *
 * Invalidates the previous verification token and sends a fresh OTP.
 */
export const otpResend = async (req: Request, res: Response) => {
  return authService.otpResendForCredentialAccount(req, res);
};

// ─── Forgot Password ──────────────────────────────────────────────────────────

/**
 * @desc    Initiate forgot password flow — send OTP to phone
 * @route   POST /api/v1/auth/forgot-password/initiate
 * @access  Public
 */
export const forgotPasswordInitiate = async (req: Request, res: Response) => {
  return authService.forgotPasswordForCredentialAccountTokenGenerate(req, res);
};

/**
 * @desc    Preview forgot password token (validate before showing reset form)
 * @route   POST /api/v1/auth/forgot-password/preview
 * @access  Public
 */
export const forgotPasswordPreview = async (req: Request, res: Response) => {
  return authService.forgotPasswordForCredentialAccountPreviewData(req, res);
};

/**
 * @desc    Resend OTP for forgot password
 * @route   POST /api/v1/auth/forgot-password/resend
 * @access  Public
 */
export const forgotPasswordResend = async (req: Request, res: Response) => {
  return authService.forgotPasswordForCredentialAccountTokenResend(req, res);
};

/**
 * @desc    Verify OTP for forgot password
 * @route   POST /api/v1/auth/forgot-password/verify
 * @access  Public
 */
export const forgotPasswordVerify = async (req: Request, res: Response) => {
  return authService.forgotPasswordForCredentialAccountOtpVerification(req, res);
};

/**
 * @desc    Reset password after OTP verification
 * @route   POST /api/v1/auth/forgot-password/reset
 * @access  Public
 */
export const forgotPasswordReset = async (req: Request, res: Response) => {
  return authService.resetPasswordForCredentialAccount(req, res);
};
