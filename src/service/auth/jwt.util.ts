import jwt from 'jsonwebtoken';

import { AuthUtil } from './auth.util';
import { env } from '~/config/env.config';
import type { CookieOptions } from 'express';
import type { UserPayloadDAO } from './auth.types';

export class AuthTokenUtil {
  private constructor() {}
  public static getInstance(): AuthTokenUtil {
    return new AuthTokenUtil();
  }

  public static readonly getRefreshTokenCookieOptions = (
    rememberMe: boolean = false,
  ): CookieOptions => {
    return {
      path: '/',
      httpOnly: true, // Prevent client-side access to cookie
      sameSite: 'lax', // CSRF protection : Restrict cookie to same-site requests
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

  public static verifyAccessToken = (token: string): UserPayloadDAO => {
    const payload = jwt.verify(token, env.accessTokenSecretKey);
    delete (payload as { iat?: number }).iat;
    delete (payload as { exp?: number }).exp;
    return payload as UserPayloadDAO;
  };

  public static verifyRefreshToken = (token: string): UserPayloadDAO => {
    const payload = jwt.verify(token, env.refreshTokenSecretKey);
    delete (payload as { iat?: number }).iat;
    delete (payload as { exp?: number }).exp;
    return payload as UserPayloadDAO;
  };
}
