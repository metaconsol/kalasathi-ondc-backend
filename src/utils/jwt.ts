import jwt from 'jsonwebtoken';
import { env } from '~/config/env.config';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  [key: string]: any;
}

export interface TokenResult<T = JwtPayload> {
  success: boolean;
  payload: T | null;
  error?: string;
}

// ─── Sign ─────────────────────────────────────────────────────────────────────

/**
 * Sign an access token using the project's ACCESS_TOKEN_SECRET_KEY.
 * Expiry defaults to ACCESS_TOKEN_EXPIRES_IN from env (e.g. "15m").
 */
export const signAccessToken = (payload: JwtPayload, expiresIn?: string): string => {
  return jwt.sign(payload, env.accessTokenSecretKey, {
    expiresIn: expiresIn ?? env.accessTokenExpiresIn ?? '15m',
  } as jwt.SignOptions);
};

/**
 * Sign a refresh token using the project's REFRESH_TOKEN_SECRET_KEY.
 * Expiry defaults to REFRESH_TOKEN_EXPIRES_IN from env (e.g. "7d").
 */
export const signRefreshToken = (payload: JwtPayload, expiresIn?: string): string => {
  return jwt.sign(payload, env.refreshTokenSecretKey, {
    expiresIn: expiresIn ?? env.refreshTokenExpiresIn ?? '7d',
  } as jwt.SignOptions);
};

/**
 * Sign a token with a custom secret and expiry.
 * Useful for one-off tokens (e.g. email verification, password reset).
 */
export const signToken = (
  payload: JwtPayload,
  secret: string,
  expiresIn: string = '1h',
): string => {
  return jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions);
};

// ─── Verify ───────────────────────────────────────────────────────────────────

/**
 * Verify an access token. Returns { success, payload } — never throws.
 */
export const verifyAccessToken = <T = JwtPayload>(token: string): TokenResult<T> => {
  try {
    const payload = jwt.verify(token, env.accessTokenSecretKey);
    return { success: true, payload: payload as T };
  } catch (err: any) {
    return { success: false, payload: null, error: err?.message };
  }
};

/**
 * Verify a refresh token. Returns { success, payload } — never throws.
 */
export const verifyRefreshToken = <T = JwtPayload>(token: string): TokenResult<T> => {
  try {
    const payload = jwt.verify(token, env.refreshTokenSecretKey);
    return { success: true, payload: payload as T };
  } catch (err: any) {
    return { success: false, payload: null, error: err?.message };
  }
};

/**
 * Verify a token signed with a custom secret. Returns { success, payload } — never throws.
 */
export const verifyToken = <T = JwtPayload>(token: string, secret: string): TokenResult<T> => {
  try {
    const payload = jwt.verify(token, secret);
    return { success: true, payload: payload as T };
  } catch (err: any) {
    return { success: false, payload: null, error: err?.message };
  }
};

// ─── Decode (no verification) ─────────────────────────────────────────────────

/**
 * Decode a JWT without verifying its signature.
 * Use only for reading non-sensitive claims (e.g. exp, iat).
 */
export const decodeToken = <T = JwtPayload>(token: string): T | null => {
  const decoded = jwt.decode(token);
  return decoded as T | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check if a token is expired without throwing.
 * Returns true if expired or invalid.
 */
export const isTokenExpired = (token: string): boolean => {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  if (!decoded?.exp) return true;
  return Date.now() >= decoded.exp * 1000;
};

/**
 * Get the expiry date of a token.
 * Returns null if the token is invalid or has no exp claim.
 */
export const getTokenExpiry = (token: string): Date | null => {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  if (!decoded?.exp) return null;
  return new Date(decoded.exp * 1000);
};
