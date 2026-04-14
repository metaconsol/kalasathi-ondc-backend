import jwt from 'jsonwebtoken';

import { AuthUtil } from './auth.util';
import { env } from '~/config/env.config';
import { debugForDev } from '~/lib/utils';
import type { CookieOptions } from 'express';
import type { UserPayloadDAO } from './auth.types';

export class AuthTokenUtil {
  private constructor() {}
  public static getInstance(): AuthTokenUtil {
    return new AuthTokenUtil();
  }

  public static readonly REFRESH_TOKEN_KEY_NAME = 'refreshToken';
  public static readonly ACCESS_TOKEN_KEY_NAME = 'accessToken';
  public static readonly REFRESH_TOKEN_EXPIRE_TIME_IN_DAYS = 7;

  public static getInvalidRefreshTokenCookieOptions = (): CookieOptions => {
    return {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: env.isProduction,
      expires: new Date(0),
      domain: env.isProduction ? AuthUtil.getParentDomain(env?.serverUrl) : undefined,
    };
  };

  public static readonly getRefreshTokenCookieOptions = (
    rememberMe: boolean = false,
  ): CookieOptions => {
    return {
      path: '/',
      httpOnly: true, // Prevent client-side access to cookie
      sameSite: 'strict', // CSRF protection : Restrict cookie to same-site requests
      secure: env.isProduction, // Only send cookie over HTTPS
      expires: new Date(Date.now() + AuthTokenUtil.getRefreshTokenCookieMaxAgeMs(rememberMe)), // 30 days in milliseconds
      domain: env.isProduction ? AuthUtil.getParentDomain(env?.serverUrl) : undefined,
    };
  };

  private static getRefreshTokenCookieMaxAgeMs(rememberMe: boolean): number {
    const rememberMeMaxAgeMultiplier = 5;
    const isRememberMe = rememberMe && (rememberMe === true || rememberMe === 'true');
    const expiresIn = AuthTokenUtil.normalizeTokenExpiresIn(env.refreshTokenExpiresIn || '7d');
    if (expiresIn > 0) {
      return expiresIn * (isRememberMe ? rememberMeMaxAgeMultiplier : 1);
    }
    return 0;
  }

  private static normalizeTokenExpiresIn(expiresIn: string): number {
    const s = String(expiresIn).trim().toLowerCase();
    const compact = s.match(/^(\d+)\s*([smhdw])$/);
    if (compact) {
      const n = parseInt(compact[1] ?? '0', 10);
      const u = compact[2];
      const mult = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
        w: 7 * 24 * 60 * 60 * 1000,
      };
      return n * (mult[u as keyof typeof mult] ?? mult.d);
    }
    return 0;
  }

  public static generateAccessToken = (userPayload: UserPayloadDAO): string => {
    return jwt.sign(userPayload, env.accessTokenSecretKey, {
      expiresIn: AuthTokenUtil.normalizeTokenExpiresIn(env.accessTokenExpiresIn ?? '1h'),
    });
  };

  public static generateRefreshToken = (
    userPayload: UserPayloadDAO,
    rememberMe: boolean = false,
  ): string => {
    return jwt.sign(userPayload, env.refreshTokenSecretKey, {
      expiresIn: AuthTokenUtil.getRefreshTokenCookieMaxAgeMs(rememberMe),
    });
  };

  public static verifyAccessToken = (
    token: string,
  ): {
    success: boolean;
    payload: UserPayloadDAO | null;
  } => {
    try {
      const payload = jwt.verify(token, env.accessTokenSecretKey);
      return {
        success: true,
        payload: payload as UserPayloadDAO,
      };
    } catch (error) {
      debugForDev('Error verifying access token');
      return {
        success: false,
        payload: null,
      };
    }
  };

  public static verifyRefreshToken = (
    token: string,
  ): {
    success: boolean;
    payload: UserPayloadDAO | null;
  } => {
    try {
      const payload = jwt.verify(token, env.refreshTokenSecretKey);
      return {
        success: true,
        payload: payload as UserPayloadDAO,
      };
    } catch (error) {
      debugForDev('Error verifying refresh token');
      return {
        success: false,
        payload: null,
      };
    }
  };

  public static isRefreshTokenWillExpireInLessThan = (
    payload: UserPayloadDAO,
    days: number = AuthTokenUtil.REFRESH_TOKEN_EXPIRE_TIME_IN_DAYS,
  ): boolean => {
    const expiresAt = new Date((payload as any)?.exp ?? 0 * 1000);
    const now = new Date();
    const diff = expiresAt.getTime() - now.getTime();
    return diff < days * 24 * 60 * 60 * 1000;
  };
}
