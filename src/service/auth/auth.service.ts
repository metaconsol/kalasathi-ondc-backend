import {
  LoginSchema,
  RegisterSchema,
  OTPResendSchema,
  OTPVerifySchema,
  ResetPasswordSchema,
} from './auth.schema';

import {
  UserRole,
  AccountType,
  AccountStatus,
  AuthTokenType,
  AccountProvider,
} from '~/generated/prisma/enums';
import { db } from '../../lib/db';
import { env } from '~/config/env.config';
import { AuthUtil } from './auth.util';
import { otpService } from '../otp/otp.service';
import { AuthTokenUtil } from './jwt.util';

import type { CookieOptions, NextFunction, Request, Response } from 'express';
import type { OAuthResponse, UserPayloadDAO, UserPayloadDTO } from './auth.types';
import z from 'zod';
import { ApiError, ApiResponse } from '~/lib/response';
import { logger } from '~/lib/logger';

class AuthService {
  private static instance: AuthService;

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
    const userPayloadPrivateSchema: { [K in keyof UserPayloadDAO]: true } = {
      id: true,
      name: true,
      phoneNumber: true,
      email: true,
      username: true,
      avatar: true,
      role: true,
      isTwoFactorEnabled: true,
    };
    const userPayloadPublicSchema: { [K in keyof UserPayloadDTO]: true } = {
      name: true,
      phoneNumber: true,
      email: true,
      username: true,
      avatar: true,
      role: true,
      isTwoFactorEnabled: true,
    };
    const userPayloadPrivate: UserPayloadDAO = AuthUtil.convertToType<any, UserPayloadDAO>(
      user,
      userPayloadPrivateSchema,
    );
    const userPayloadPublic: UserPayloadDTO = AuthUtil.convertToType<any, UserPayloadDTO>(
      user,
      userPayloadPublicSchema,
    );

    const accessToken: string = AuthTokenUtil.generateAccessToken(userPayloadPrivate);
    const refreshToken: string = AuthTokenUtil.generateRefreshToken(userPayloadPrivate);

    res.setHeader('Authorization', `Bearer ${accessToken}`);
    res.cookie('refreshToken', refreshToken, AuthTokenUtil.getRefreshTokenCookieOptions());
    return ApiResponse.success(res, options.message, {
      user: userPayloadPublic,
    });
  };

  public register = async (req: Request, res: Response) => {
    const { name, email, phoneNumber, password } = req.body;
    const validatedData = RegisterSchema.safeParse({
      name,
      email,
      phoneNumber,
      password,
    });
    if (!validatedData.success) {
      return ApiResponse.badRequest(
        res,
        'Invalid data',
        z.flattenError(validatedData.error).fieldErrors,
      );
    }

    const isExist = await db.user.findUnique({
      select: {
        id: true,
      },
      where: {
        phoneNumber: validatedData.data.phoneNumber,
      },
    });
    if (isExist) {
      return ApiResponse.badRequest(res, 'Email is already registered.');
    }

    const hashedPassword: string = await AuthUtil.getHashedPassword(validatedData.data.password);
    const user = await db.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email: validatedData.data.email ?? null,
          name: validatedData.data.name,
          phoneNumber: validatedData.data.phoneNumber,
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
      token: AuthTokenType.VERIFICATION,
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
          name: AuthTokenType.VERIFICATION,
          value: token.token,
        },
      ],
    });
  };

  public login = async (req: Request, res: Response) => {
    const requestData = req.body;

    const validatedData = LoginSchema.safeParse({
      phoneNumber: requestData.phoneNumber,
      password: requestData.password,
      isLoginWithPassword: requestData.isLoginWithPassword,
      isLoginWithOtp: requestData.isLoginWithOtp ?? false,
      loginRole: requestData.loginRole ?? UserRole.USER,
      rememberMe: requestData.rememberMe ?? false,
    });
    if (!validatedData.success) {
      return ApiResponse.badRequest(
        res,
        'Invalid data',
        z.flattenError(validatedData.error).fieldErrors,
      );
    }

    const { phoneNumber, password, isLoginWithPassword, isLoginWithOtp, loginRole, rememberMe } =
      validatedData.data;

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
        const otp = await otpService.sendOTP({
          name: user.name,
          phoneNumber: phoneNumber,
          token: AuthTokenType.VERIFICATION,
        });
        if (!otp) {
          throw ApiError.INTERNAL_SERVER_ERROR('Failed to send OTP');
        }

        const token = await db.authToken.create({
          data: {
            phoneNumber: phoneNumber,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
            type: AuthTokenType.VERIFICATION,
          },
        });
        if (!token) {
          throw ApiError.INTERNAL_SERVER_ERROR('Failed to create token');
        }

        return ApiResponse.success(res, 'OTP sent successfully to your phone number', {
          tokens: [
            {
              name: AuthTokenType.VERIFICATION,
              value: token.token,
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
        });
      }
    }

    if (isLoginWithOtp) {
      const user = await db.user.findUnique({
        where: {
          phoneNumber: phoneNumber,
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
      let newUser: any | null = null;
      if (!user) {
        newUser = await db.$transaction(async (tx) => {
          const createdUser = await tx.user.create({
            data: {
              phoneNumber: phoneNumber,
              name: phoneNumber.toString(),
              role: UserRole.USER,
              profile: {
                create: {},
              },
            },
            select: {
              id: true,
              name: true,
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

        if (!newUser) {
          throw ApiError.INTERNAL_SERVER_ERROR('Failed to create user');
        }
      }

      const otp = await otpService.sendOTP({
        name: newUser.name,
        phoneNumber: phoneNumber,
        token: AuthTokenType.VERIFICATION,
      });
      if (!otp) {
        throw ApiError.INTERNAL_SERVER_ERROR('Failed to create OTP');
      }

      const token = await db.authToken.create({
        data: {
          phoneNumber: phoneNumber,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
          type: AuthTokenType.VERIFICATION,
        },
      });
      if (!token) {
        throw ApiError.INTERNAL_SERVER_ERROR('Failed to create auth token');
      }

      return ApiResponse.success(res, 'OTP sent successfully to your phone number', {
        tokens: [
          {
            name: AuthTokenType.VERIFICATION,
            value: token.token,
          },
        ],
      });
    }
  };

  public logout = async (_req: Request, res: Response) => {
    res.cookie('refreshToken', null, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      expires: new Date(0),
      secure: env.isProduction,
      domain: env.isProduction ? AuthUtil.getParentDomain(env?.serverUrl) : undefined,
    });

    return ApiResponse.success(res, 'Logged out successfully');
  };

  public getUser = async (req: Request, res: Response) => {
    const { username } = req.query;
    const user = req?.user;
    delete (user as { id?: string }).id;
    return ApiResponse.success(res, 'User found', {
      user: user as UserPayloadDTO,
      isAuthByUsername: user?.username == (username as string),
    });
  };

  public otpVerificationForCredentialAccount = async (req: Request, res: Response) => {
    const { phoneNumber, otp, tokens } = req.body;
    const validatedData = OTPVerifySchema.safeParse({
      phoneNumber,
      otp,
      tokens,
    });
    if (!validatedData.success) {
      return ApiResponse.badRequest(
        res,
        'Invalid data',
        z.flattenError(validatedData.error).fieldErrors,
      );
    }

    if (!Array.isArray(tokens) || tokens.length === 0) {
      return ApiError.BAD_REQUEST('Verification tokens are required');
    }

    const token = tokens.find((t) => t?.name === AuthTokenType.VERIFICATION)?.value;

    if (!token) {
      return ApiResponse.badRequest(res, 'Verification token not found');
    }

    const tokenType = await otpService.verifyOTP(
      validatedData.data.phoneNumber,
      validatedData.data.otp,
    );
    if (!tokenType) {
      return ApiResponse.badRequest(res, 'Invalid OTP');
    }

    const user0 = await db.user.findUnique({
      where: {
        phoneNumber: validatedData.data.phoneNumber,
      },
      select: {
        id: true,
        role: true,
      },
    });

    if (!user0) {
      return ApiResponse.notFound(res, 'User not found');
    }

    await db.account.update({
      where: {
        provider_providerAccountId: {
          provider: AccountProvider.CREDENTIALS,
          providerAccountId: user0.id.toString(),
        },
      },
      data: {
        status: AccountStatus.ACTIVE,
      },
    });

    return this.newAuthenticatedResponse(res, {
      userId: user0.id,
      message: 'OTP verified successfully',
    });
  };

  public authenticate = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const accessToken: string | null = req.headers.authorization?.split(' ')[1] || null;
      const { message } = req.query;
      console.log(`accessToken ${message}=>>`, accessToken);

      if (!accessToken || accessToken == '' || accessToken == null || accessToken == 'null') {
        throw new Error('Access token not found');
      }

      const userPayload: UserPayloadDAO = AuthTokenUtil.verifyAccessToken(accessToken);
      if (!userPayload || !userPayload?.id) {
        throw new Error('Invalid Access Token');
      }

      const accessToken_neo: string = AuthTokenUtil.generateAccessToken(userPayload);

      req.user = userPayload;
      res.setHeader('Authorization', `Bearer ${accessToken_neo}`);
      next();
      return;
    } catch (error) {
      // const refreshToken = req.cookies?.refreshToken || null;
      const headerCookie = req.headers.cookie || null;
      // console.log("headerCookie =>>", headerCookie);

      if (!headerCookie) {
        return res.status(404).json({ error: 'No user found' });
      }

      try {
        const cookies = headerCookie.split(';');
        let refreshToken: string | null = null;

        cookies.forEach((cookie) => {
          const [key, value] = cookie.trim().split('=');
          if (key == 'refreshToken') {
            refreshToken = value as string | null;
          }
        });

        const { message } = req.query;
        console.log(`refreshToken ${message}=>>`, refreshToken);

        if (!refreshToken || refreshToken == '' || refreshToken == null || refreshToken == 'null') {
          return res.status(404).json({ error: 'No user found' });
        }

        const userPayload: UserPayloadDAO = AuthTokenUtil.verifyRefreshToken(refreshToken);

        if (!userPayload || !userPayload?.id) {
          throw new Error('Invalid Refresh Token');
        }

        const accessToken_neo: string = AuthTokenUtil.generateAccessToken(userPayload);
        const refreshToken_neo: string = AuthTokenUtil.generateRefreshToken(userPayload, false);

        req.user = userPayload;
        res
          .setHeader('Authorization', `Bearer ${accessToken_neo}`)
          .cookie('refreshToken', refreshToken_neo, AuthTokenUtil.getRefreshTokenCookieOptions());
        return next();
      } catch (error: any) {
        return next(error);
      }
    }
  };

  public authorize = (roleCheck: string[] | ((user: UserPayloadDAO) => boolean)) => {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        await this.authenticate(req, res, (err?: any) => {
          if (err) return next(err);

          if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
          }

          let isAuthorized = false;

          if (Array.isArray(roleCheck)) {
            isAuthorized = roleCheck.includes(req.user.role);
          } else if (typeof roleCheck === 'function') {
            isAuthorized = roleCheck(req.user);
          }

          if (!isAuthorized) {
            return res.status(403).json({
              error: 'Unauthorized access',
              message: 'You do not have permission to access this resource.',
            });
          }

          next();
        });
      } catch (error) {
        next(error);
      }
    };
  };

  public authInterceptor = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const accessToken: string | null = req.headers.authorization?.split(' ')[1] || null;

      if (!accessToken || accessToken == '' || accessToken == null || accessToken == 'null') {
        throw new Error('Access token not found');
      }

      const userPayload: UserPayloadDAO = AuthTokenUtil.verifyAccessToken(accessToken);

      if (!userPayload || !userPayload?.id) {
        throw new Error('Invalid Access Token');
      }

      const accessToken_neo: string = AuthTokenUtil.generateAccessToken(userPayload);

      req.user = userPayload;
      res.setHeader('Authorization', `Bearer ${accessToken_neo}`);
      return next();
    } catch (error) {
      const headerCookie = req.headers.cookie || null;

      if (!headerCookie) {
        return next();
      }

      try {
        const cookies = headerCookie.split(';');
        let refreshToken: string | null = null;

        cookies.forEach((cookie) => {
          const [key, value] = cookie.trim().split('=');
          if (key == 'refreshToken') {
            refreshToken = value as string | null;
          }
        });

        if (!refreshToken || refreshToken == '' || refreshToken == null || refreshToken == 'null') {
          return next();
        }

        const userPayload: UserPayloadDAO = AuthTokenUtil.verifyRefreshToken(refreshToken);

        if (!userPayload || !userPayload?.id) {
          return next();
        }

        const accessToken_neo: string = AuthTokenUtil.generateAccessToken(userPayload);
        const refreshToken_neo: string = AuthTokenUtil.generateRefreshToken(userPayload, false);

        req.user = userPayload;
        res
          .setHeader('Authorization', `Bearer ${accessToken_neo}`)
          .cookie(
            'refreshToken',
            refreshToken_neo,
            AuthTokenUtil.getRefreshTokenCookieOptions(false),
          );
        return next();
      } catch (error: any) {
        return next(error);
      }
    }
  };
}

export const authService = AuthService.getInstance();
