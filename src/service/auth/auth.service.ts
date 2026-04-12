import {
  UserRole,
  AccountType,
  AccountStatus,
  AuthTokenType,
  AccountProvider,
} from '~/generated/prisma/enums';
import { db } from '../../lib/db';
import { AuthUtil } from './auth.util';
import { debugForDev } from '~/lib/utils';
import { AuthTokenUtil } from './jwt.util';
import { authConstants } from '~/lib/constant';
import { otpService } from '../otp/otp.service';
import { ApiError, ApiResponse } from '~/lib/response';

import type { NextFunction, Request, Response } from 'express';
import type { UserPayloadDAO, UserPayloadDTO } from './auth.types';

class AuthService {
  private constructor() {}
  public static getInstance(): AuthService {
    return new AuthService();
  }

  private newAuthenticatedResponse = async (
    res: Response,
    options: {
      userId: number;
      message: string;
      status?: number;
      rememberMe?: boolean;
    },
  ) => {
    const user = await db.user.findUnique({
      where: {
        id: options.userId!,
      },
    });
    if (!user) {
      return ApiResponse.notFound(res, 'User not found');
    }

    const userPayloadDAO: UserPayloadDAO = {
      id: user.id,
      name: user.name,
      phoneNumber: user.phoneNumber,
      email: user.email,
      username: user.username,
      avatar: user.avatar,
      role: user.role,
      isTwoFactorEnabled: user.isTwoFactorEnabled,
      isRememberMe: options.rememberMe ?? false,
    };

    const userPayloadDTO: UserPayloadDTO = {
      name: user.name,
      phoneNumber: user.phoneNumber,
      email: user.email,
      username: user.username,
      avatar: user.avatar,
      role: user.role,
      isTwoFactorEnabled: user.isTwoFactorEnabled,
      isRememberMe: options.rememberMe ?? false,
    };

    const accessToken: string = AuthTokenUtil.generateAccessToken(userPayloadDAO);
    const refreshToken: string = AuthTokenUtil.generateRefreshToken(
      userPayloadDAO,
      options.rememberMe ?? false,
    );

    res.setHeader('Authorization', `Bearer ${accessToken}`);
    res.cookie('refreshToken', refreshToken, AuthTokenUtil.getRefreshTokenCookieOptions());
    return ApiResponse.success(res, options.message, {
      user: userPayloadDTO,
    });
  };

  public register = async (req: Request, res: Response) => {
    const { name, email, phoneNumber, password } = req.body;

    const isExist = await db.user.findUnique({
      select: {
        id: true,
      },
      where: {
        phoneNumber: phoneNumber,
      },
    });
    if (isExist) {
      return ApiResponse.badRequest(res, 'Phone number is already registered');
    }

    const hashedPassword: string = await AuthUtil.getHashedPassword(password);
    const user = await db.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email: email ?? null,
          name: name,
          phoneNumber: phoneNumber,
          password: hashedPassword,
          role: UserRole.USER,
          profile: {
            create: {},
          },
        },
        select: {
          id: true,
          email: true,
          name: true,
          phoneNumber: true,
        },
      });
      await tx.account.create({
        data: {
          userId: createdUser.id,
          type: AccountType.CREDENTIALS,
          provider: AccountProvider.CREDENTIALS,
          providerAccountId: createdUser.id.toString(),
          status: AccountStatus.PENDING,
        },
      });

      return createdUser;
    });

    if (!user) {
      throw ApiError.INTERNAL_SERVER_ERROR('Failed to user create');
    }

    const otp = await otpService.sendOTP({
      name: user.name,
      phoneNumber: user.phoneNumber!,
      tokenType: AuthTokenType.VERIFICATION,
    });
    if (!otp) {
      throw ApiError.INTERNAL_SERVER_ERROR('Failed to send OTP');
    }

    const token = await db.authToken.create({
      data: {
        phoneNumber: user.phoneNumber!,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
        type: AuthTokenType.VERIFICATION,
      },
    });
    if (!token) {
      throw ApiError.INTERNAL_SERVER_ERROR('Failed to create token');
    }

    return ApiResponse.created(res, 'Registered successfully', {
      tokens: [
        {
          key: AuthTokenType.VERIFICATION,
          value: token.token,
        },
      ],
    });
  };

  public login = async (req: Request, res: Response) => {
    const {
      phoneNumber,
      email,
      password,
      isLoginWithPassword,
      isLoginWithOtp,
      loginRole,
      rememberMe,
    } = req.body;

    if (isLoginWithPassword) {
      const user = await db.user.findUnique({
        where: {
          phoneNumber: phoneNumber,
          accounts: {
            some: {
              provider: AccountProvider.CREDENTIALS,
            },
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
          password: true,
          role: true,
          isTwoFactorEnabled: true,
          accounts: {
            select: {
              provider: true,
              providerAccountId: true,
              status: true,
            },
          },
        },
      });
      if (!user || !user.password) {
        return ApiResponse.notFound(res, 'User not found');
      }
      const isPasswordValid = await AuthUtil.compareHashedPassword(password, user.password);
      if (!isPasswordValid) {
        return ApiResponse.unauthorized(res, 'Invalid credentials');
      }

      const credentialsAccount = user.accounts.find(
        (account) => account.provider === AccountProvider.CREDENTIALS,
      );
      if (!credentialsAccount) {
        return ApiResponse.notFound(res, 'User not found');
      }

      if (
        credentialsAccount.status === AccountStatus.PENDING ||
        credentialsAccount.status === AccountStatus.INACTIVE
      ) {
        const token = await otpService.sendOTP({
          name: user.name,
          phoneNumber: phoneNumber,
          email: email,
          tokenType: AuthTokenType.VERIFICATION,
        });

        return ApiResponse.success(res, 'OTP sent successfully to your phone number', {
          tokens: [
            {
              key: AuthTokenType.VERIFICATION,
              value: token,
            },
          ],
        });
      } else if (credentialsAccount.status === AccountStatus.BLOCKED) {
        return ApiResponse.unauthorized(res, 'Account is blocked');
      } else {
        if (loginRole != UserRole.USER && user.role !== loginRole) {
          throw ApiError.UNAUTHORIZED(
            `You are not authorized to login with this ${loginRole} role`,
          );
        }

        return this.newAuthenticatedResponse(res, {
          userId: user.id,
          message: 'Login successful',
          rememberMe: rememberMe,
        });
      }
    }

    if (isLoginWithOtp) {
      type User = {
        id: number;
        name: string;
        email: string | null;
        phoneNumber: string;
      } | null;

      const user: User = await db.user.findUnique({
        where: {
          phoneNumber: phoneNumber,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phoneNumber: true,
        },
      });

      let newUser: User = user ?? null;
      if (!user) {
        newUser = await db.$transaction(async (tx) => {
          const createdUser = await tx.user.create({
            data: {
              phoneNumber: phoneNumber,
              email: email,
              name: phoneNumber.toString(),
              role: UserRole.USER,
              profile: {
                create: {},
              },
            },
            select: {
              id: true,
              name: true,
              email: true,
              phoneNumber: true,
            },
          });
          await tx.account.create({
            data: {
              userId: createdUser.id,
              type: AccountType.CREDENTIALS,
              provider: AccountProvider.CREDENTIALS,
              providerAccountId: createdUser.id.toString(),
              status: AccountStatus.PENDING,
            },
          });

          return createdUser;
        });
      }

      if (!newUser) {
        throw ApiError.INTERNAL_SERVER_ERROR('Failed to create user');
      }

      const token = await otpService.sendOTP({
        name: newUser.name,
        phoneNumber: newUser.phoneNumber,
        email: newUser?.email,
        tokenType: AuthTokenType.VERIFICATION,
      });

      return ApiResponse.success(res, 'OTP sent successfully to your phone number', {
        tokens: [
          {
            key: AuthTokenType.VERIFICATION,
            value: token,
          },
        ],
      });
    }
  };

  public logout = async (_req: Request, res: Response) => {
    res.cookie('refreshToken', null, AuthTokenUtil.getInvalidRefreshTokenCookieOptions());
    return ApiResponse.success(res, 'Logged out successfully');
  };

  public getUser = async (req: Request, res: Response) => {
    const { username } = req.query;
    const user = req?.user;
    delete (user as { id?: number }).id;
    return ApiResponse.success(res, 'User found', {
      user: user as UserPayloadDTO,
      isAuthByUsername: user?.username == (username as string),
    });
  };

  public authenticate = async (req: Request, res: Response, next: NextFunction) => {
    const accessToken: string | null = req.headers?.authorization?.split(' ')?.[1] ?? null;
    // const refreshToken = req.cookies?.refreshToken || null;
    const headerCookie = req.headers.cookie || null;

    if (!headerCookie) {
      return ApiResponse.unauthorized(res, 'Unauthorized');
    }

    const cookies = headerCookie.split(';');
    let refreshToken: string | null = null;

    cookies.forEach((cookie) => {
      const [key, value] = cookie.trim().split('=');
      if (key == AuthTokenUtil.REFRESH_TOKEN_KEY_NAME) {
        refreshToken = value as string | null;
      }
    });

    debugForDev(`accessToken => ${accessToken}`);
    debugForDev(`refreshToken => ${refreshToken}`);

    if (!refreshToken || refreshToken == '') {
      return ApiResponse.unauthorized(res, 'Unauthorized');
    }

    const userPayloadUsingAccessToken: UserPayloadDAO | null =
      accessToken && accessToken != '' ? AuthTokenUtil.verifyAccessToken(accessToken) : null;
    if (userPayloadUsingAccessToken && userPayloadUsingAccessToken?.id) {
      const newAccessToken: string = AuthTokenUtil.generateAccessToken(userPayloadUsingAccessToken);
      req.user = userPayloadUsingAccessToken;
      res.setHeader('Authorization', `Bearer ${newAccessToken}`);
      return next();
    }

    const userPayloadUsingRefreshToken: UserPayloadDAO =
      AuthTokenUtil.verifyRefreshToken(refreshToken);
    if (!userPayloadUsingRefreshToken || !userPayloadUsingRefreshToken?.id) {
      return ApiResponse.unauthorized(res, 'Invalid Refresh Token');
    }
    const newAccessToken: string = AuthTokenUtil.generateAccessToken(userPayloadUsingRefreshToken);
    req.user = userPayloadUsingRefreshToken;
    res.setHeader('Authorization', `Bearer ${newAccessToken}`);
    return next();
  };

  public authorize = (roleCheck: string[] | ((user: UserPayloadDAO) => boolean)) => {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        await this.authenticate(req, res, (err?: any) => {
          if (err) return next(err);

          if (!req.user) {
            return ApiResponse.unauthorized(res, 'Unauthorized');
          }

          let isAuthorized = false;

          if (Array.isArray(roleCheck)) {
            isAuthorized = roleCheck.includes(req.user.role);
          } else if (typeof roleCheck === 'function') {
            isAuthorized = roleCheck(req.user);
          }

          if (!isAuthorized) {
            return ApiResponse.forbidden(res, 'You do not have permission to access this resource');
          }

          next();
        });
      } catch (error) {
        next(error);
      }
    };
  };

  public authInterceptor = async (req: Request, res: Response, next: NextFunction) => {
    const accessToken: string | null = req.headers?.authorization?.split(' ')?.[1] ?? null;
    // const refreshToken = req.cookies?.refreshToken || null;
    const headerCookie = req.headers.cookie || null;

    if (!headerCookie) {
      return next();
    }

    const cookies = headerCookie.split(';');
    let refreshToken: string | null = null;

    cookies.forEach((cookie) => {
      const [key, value] = cookie.trim().split('=');
      if (key == AuthTokenUtil.REFRESH_TOKEN_KEY_NAME) {
        refreshToken = value as string | null;
      }
    });

    debugForDev(`accessToken => ${accessToken}`);
    debugForDev(`refreshToken => ${refreshToken}`);

    if (!refreshToken || refreshToken == '') {
      return next();
    }

    const userPayloadUsingAccessToken: UserPayloadDAO | null =
      accessToken && accessToken != '' ? AuthTokenUtil.verifyAccessToken(accessToken) : null;
    if (userPayloadUsingAccessToken && userPayloadUsingAccessToken?.id) {
      const newAccessToken: string = AuthTokenUtil.generateAccessToken(userPayloadUsingAccessToken);
      req.user = userPayloadUsingAccessToken;
      res.setHeader('Authorization', `Bearer ${newAccessToken}`);
      return next();
    }

    const userPayloadUsingRefreshToken: UserPayloadDAO =
      AuthTokenUtil.verifyRefreshToken(refreshToken);
    if (!userPayloadUsingRefreshToken || !userPayloadUsingRefreshToken?.id) {
      return next();
    }
    const newAccessToken: string = AuthTokenUtil.generateAccessToken(userPayloadUsingRefreshToken);
    req.user = userPayloadUsingRefreshToken;
    res.setHeader('Authorization', `Bearer ${newAccessToken}`);
    return next();
  };

  public getNewAccessTokenUsingRefreshToken = async (req: Request, res: Response) => {
    // const refreshToken = req.cookies?.refreshToken || null;
    const headerCookie = req.headers.cookie || null;

    if (!headerCookie) {
      return ApiResponse.unauthorized(res, 'Unauthorized');
    }

    const cookies = headerCookie.split(';');
    let refreshToken: string | null = null;

    cookies.forEach((cookie) => {
      const [key, value] = cookie.trim().split('=');
      if (key == AuthTokenUtil.REFRESH_TOKEN_KEY_NAME) {
        refreshToken = value as string | null;
      }
    });

    debugForDev(`refreshToken => ${refreshToken}`);

    if (!refreshToken || refreshToken == '') {
      return ApiResponse.unauthorized(res, 'Unauthorized');
    }

    const userPayloadUsingRefreshToken: UserPayloadDAO =
      AuthTokenUtil.verifyRefreshToken(refreshToken);
    if (!userPayloadUsingRefreshToken || !userPayloadUsingRefreshToken?.id) {
      return ApiResponse.unauthorized(res, 'Invalid Refresh Token');
    }
    const newAccessToken: string = AuthTokenUtil.generateAccessToken(userPayloadUsingRefreshToken);
    res.setHeader('Authorization', `Bearer ${newAccessToken}`);
    if (
      userPayloadUsingRefreshToken.isRememberMe &&
      AuthTokenUtil.isRefreshTokenWillExpireInLessThan(refreshToken)
    ) {
      const newRefreshToken: string = AuthTokenUtil.generateRefreshToken(
        userPayloadUsingRefreshToken,
        true,
      );
      res.cookie(
        AuthTokenUtil.REFRESH_TOKEN_KEY_NAME,
        newRefreshToken,
        AuthTokenUtil.getRefreshTokenCookieOptions(),
      );
    }

    return ApiResponse.success(res, 'New access token generated successfully');
  };

  public otpVerificationForCredentialAccountPreviewData = async (req: Request, res: Response) => {
    const { token } = req.query;
    if (!token) {
      return ApiResponse.badRequest(res, 'Token is required');
    }
    const authToken = await db.authToken.findUnique({
      where: {
        token: token as string,
      },
      select: {
        phoneNumber: true,
        expiresAt: true,
      },
    });

    if (!authToken) {
      return ApiResponse.notFound(res, 'Invalid token');
    }

    if (authToken.expiresAt < new Date()) {
      return ApiResponse.notFound(res, 'Token has expired');
    }

    const user = await db.user.findUnique({
      where: {
        phoneNumber: authToken.phoneNumber,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!user) {
      return ApiResponse.notFound(res, 'User not found');
    }

    return ApiResponse.success(res, 'Token verified successfully', {
      expiresAt: authToken.expiresAt,
      user: {
        name: user.name,
        phoneNumber: authToken.phoneNumber,
      },
    });
  };

  public otpVerificationForCredentialAccount = async (req: Request, res: Response) => {
    const { phoneNumber, otp, tokens, rememberMe } = req.body;

    debugForDev(tokens);
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return ApiError.BAD_REQUEST('Verification tokens are required');
    }

    const token = tokens.find((t) => t?.key === AuthTokenType.VERIFICATION)?.value;

    if (!token) {
      return ApiResponse.badRequest(res, 'Verification token not found');
    }

    const verifyOTPResponse = await otpService.verifyOTP(phoneNumber, otp, token);

    if (!verifyOTPResponse.success || !verifyOTPResponse.userId) {
      return ApiResponse.badRequest(res, verifyOTPResponse.message);
    }

    await db.account.update({
      where: {
        provider_providerAccountId: {
          provider: AccountProvider.CREDENTIALS,
          providerAccountId: verifyOTPResponse.userId.toString(),
        },
      },
      data: {
        status: AccountStatus.ACTIVE,
      },
    });

    return this.newAuthenticatedResponse(res, {
      userId: verifyOTPResponse.userId,
      message: 'OTP verified successfully',
      rememberMe: rememberMe ?? false,
    });
  };

  public otpResendForCredentialAccount = async (req: Request, res: Response) => {
    const { phoneNumber, tokens } = req.body;
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return ApiResponse.badRequest(res, 'Verification tokens are required');
    }

    const token = tokens.find((t) => t?.key === AuthTokenType.VERIFICATION)?.value;
    if (!token) {
      return ApiResponse.badRequest(res, 'Verification token not found');
    }

    const data = await db.authToken.findUnique({
      where: {
        token: token,
        phoneNumber: phoneNumber,
      },
      select: {
        phoneNumber: true,
        expiresAt: true,
        usedAt: true,
      },
    });

    if (!data) {
      return ApiResponse.notFound(res, 'Invalid token');
    }

    if (data?.usedAt) {
      return ApiResponse.notFound(res, 'Token has already been used');
    }

    await db.authToken.update({
      where: {
        token: token,
        phoneNumber: phoneNumber,
      },
      data: {
        usedAt: new Date(),
      },
    });

    const user = await db.user.findUnique({
      where: {
        phoneNumber: data.phoneNumber,
      },
      select: {
        name: true,
      },
    });

    if (!user) {
      return ApiResponse.notFound(res, 'User not found');
    }

    const newToken = await otpService.sendOTP({
      phoneNumber: data.phoneNumber,
      name: user.name,
      tokenType: AuthTokenType.VERIFICATION,
    });

    return ApiResponse.success(res, 'OTP sent successfully', {
      expiresAt: data.expiresAt,
      tokens: [
        {
          key: AuthTokenType.VERIFICATION,
          value: newToken,
        },
      ],
    });
  };

  public forgotPasswordForCredentialAccountTokenGenerate = async (req: Request, res: Response) => {
    const { phoneNumber } = req.body;

    const data = await db.user.findUnique({
      where: {
        phoneNumber: phoneNumber,
      },
    });

    if (!data) {
      return ApiResponse.notFound(res, 'User not found');
    }

    const token = await otpService.sendOTP({
      phoneNumber: phoneNumber,
      name: data.name,
      tokenType: AuthTokenType.FORGOT_PASSWORD,
    });

    return ApiResponse.success(res, 'Forgot password token generated successfully', {
      tokens: [
        {
          key: AuthTokenType.FORGOT_PASSWORD,
          value: token,
        },
      ],
    });
  };

  public forgotPasswordForCredentialAccountPreviewData = async (req: Request, res: Response) => {
    const { phoneNumber, tokens } = req.body;
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return ApiResponse.badRequest(res, 'Tokens are required');
    }

    const token = tokens.find((t) => t?.key === AuthTokenType.FORGOT_PASSWORD)?.value;
    if (!token) {
      return ApiResponse.badRequest(res, 'Token is required');
    }

    const data = await db.authToken.findUnique({
      where: {
        token: token,
        phoneNumber: phoneNumber,
      },
      select: {
        phoneNumber: true,
        expiresAt: true,
        usedAt: true,
      },
    });

    if (!data || data.usedAt) {
      return ApiResponse.badRequest(res, 'Invalid token');
    }

    if (data.expiresAt < new Date()) {
      return ApiResponse.badRequest(res, 'Token has expired');
    }

    const user = await db.user.findUnique({
      where: {
        phoneNumber: data.phoneNumber,
      },
      select: {
        name: true,
      },
    });

    if (!user) {
      return ApiResponse.notFound(res, 'User not found');
    }

    return ApiResponse.success(res, 'Forgot password token verified successfully', {
      expiresAt: data.expiresAt,
      user: {
        name: user.name,
        phoneNumber: data.phoneNumber,
      },
    });
  };

  public forgotPasswordForCredentialAccountTokenResend = async (req: Request, res: Response) => {
    const { phoneNumber, tokens } = req.body;
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return ApiResponse.badRequest(res, 'Tokens are required');
    }

    const token = tokens.find((t) => t?.key === AuthTokenType.FORGOT_PASSWORD)?.value;
    if (!token) {
      return ApiResponse.badRequest(res, 'Token is required');
    }

    const data = await db.authToken.findUnique({
      where: {
        token: token,
        phoneNumber: phoneNumber,
      },
      select: {
        phoneNumber: true,
        expiresAt: true,
      },
    });
    if (!data) {
      return ApiResponse.notFound(res, 'Invalid token');
    }

    const user = await db.user.findUnique({
      where: {
        phoneNumber: data.phoneNumber,
      },
      select: {
        name: true,
      },
    });
    if (!user) {
      return ApiResponse.notFound(res, 'User not found');
    }

    const newToken = await otpService.sendOTP({
      phoneNumber: data.phoneNumber,
      name: user.name,
      tokenType: AuthTokenType.FORGOT_PASSWORD,
    });

    return ApiResponse.success(res, 'Forgot password token sent successfully', {
      tokens: [
        {
          key: AuthTokenType.FORGOT_PASSWORD,
          value: newToken,
        },
      ],
    });
  };

  public forgotPasswordForCredentialAccountOtpVerification = async (
    req: Request,
    res: Response,
  ) => {
    const { phoneNumber, otp, tokens } = req.body;
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return ApiResponse.badRequest(res, 'Tokens are required');
    }

    const token = tokens.find((t) => t?.key === AuthTokenType.FORGOT_PASSWORD)?.value;
    if (!token) {
      return ApiResponse.badRequest(res, 'Token is required');
    }

    const verifyOTPResponse = await otpService.verifyOTP(phoneNumber, otp, token);
    if (!verifyOTPResponse.success || !verifyOTPResponse.userId) {
      return ApiResponse.badRequest(res, verifyOTPResponse.message);
    }

    const newToken = await db.authToken.create({
      data: {
        phoneNumber: phoneNumber,
        expiresAt: new Date(Date.now() + authConstants.RESET_PASSWORD_EXPIRATION_TIME),
        type: AuthTokenType.RESET_PASSWORD,
      },
    });
    if (!newToken) {
      throw ApiError.BAD_REQUEST('Failed to create token');
    }

    return ApiResponse.success(res, 'Forgot password token verified successfully', {
      tokens: [
        {
          key: AuthTokenType.RESET_PASSWORD,
          value: newToken,
        },
      ],
    });
  };

  public resetPasswordForCredentialAccount = async (req: Request, res: Response) => {
    const { phoneNumber, tokens, password } = req.body;

    if (!Array.isArray(tokens) || tokens.length === 0) {
      return ApiResponse.badRequest(res, 'Tokens are required');
    }

    const token = tokens.find((t) => t?.key === AuthTokenType.RESET_PASSWORD)?.value;
    if (!token) {
      return ApiResponse.badRequest(res, 'Token is required');
    }

    const data = await db.authToken.findUnique({
      where: {
        token: token,
        phoneNumber: phoneNumber,
      },
      select: {
        expiresAt: true,
        usedAt: true,
      },
    });

    if (!data || data?.usedAt) {
      return ApiResponse.badRequest(res, 'Invalid token');
    }

    await db.authToken.update({
      where: {
        token: token,
      },
      data: {
        usedAt: new Date(),
      },
    });

    if (data.expiresAt < new Date()) {
      return ApiResponse.badRequest(res, 'Token has expired');
    }

    const userId = await db.$transaction(async (tx) => {
      const hashedPassword = await AuthUtil.getHashedPassword(password);
      const user = await tx.user.update({
        where: {
          phoneNumber: phoneNumber,
        },
        data: {
          password: hashedPassword,
        },
      });

      if (!user) {
        return null;
      }

      await tx.account.update({
        where: {
          provider_providerAccountId: {
            provider: AccountProvider.CREDENTIALS,
            providerAccountId: user.id.toString(),
          },
        },
        data: {
          status: AccountStatus.ACTIVE,
        },
      });

      return user.id;
    });

    if (!userId) {
      return ApiResponse.notFound(res, 'User not found');
    }

    return this.newAuthenticatedResponse(res, {
      userId: userId,
      message: 'Password reset successfully',
    });
  };
}

export const authService = AuthService.getInstance();
