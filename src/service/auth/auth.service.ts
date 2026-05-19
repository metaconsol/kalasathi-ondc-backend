import {
  UserRole,
  AccountType,
  AccountStatus,
  AuthTokenType,
  AccountProvider,
} from '~/generated/prisma/enums';
import { sqlExec, sqlQuery, type SqlTx, withSqlTransaction } from '~/lib/sql';
import { AuthUtil } from './auth.util';
import { AuthTokenUtil } from './jwt.util';
import { authConstants } from '~/lib/constant';
import { otpService } from '../otp/otp.service';
import { ApiError, ApiResponse } from '~/lib/response';
import { randomUUID } from 'crypto';

import type { NextFunction, Request, Response } from 'express';
import type { UserPayloadDAO, UserPayloadDTO } from './auth.types';
import { mailServiceAsync } from '../mail/mail.service';
import { BuyerMailTemplate } from '../mail/buyer.mail.template';
import { SellerMailTemplate } from '../mail/seller.mail.template';

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
    const users = await sqlQuery<{
      id: number;
      name: string;
      phoneNumber: string;
      email: string | null;
      username: string;
      avatar: string | null;
      role: UserRole;
      isTwoFactorEnabled: 0 | 1;
    }>('SELECT * FROM `User` WHERE `id` = ? LIMIT 1', [options.userId!]);
    const user = users[0] ?? null;
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
      isTwoFactorEnabled: Boolean(user.isTwoFactorEnabled),
      isRememberMe: options.rememberMe ?? false,
    };

    const userPayloadDTO: UserPayloadDTO = {
      name: user.name,
      phoneNumber: user.phoneNumber,
      email: user.email,
      username: user.username,
      avatar: user.avatar,
      role: user.role,
      isTwoFactorEnabled: Boolean(user.isTwoFactorEnabled),
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
      /** Same JWT as `Authorization` response header (for clients / Postman that read JSON only). */
      accessToken,
    });
  };

  public register = async (req: Request, res: Response) => {
    const { fullName: name, email, phoneNumber, password } = req.body;

    const existing = await sqlQuery<{ id: number }>(
      'SELECT `id` FROM `User` WHERE `phoneNumber` = ? LIMIT 1',
      [phoneNumber],
    );
    const isExist = existing[0] ?? null;

    if (isExist && isExist?.id) {
      return ApiResponse.badRequest(res, 'Phone number is already registered');
    }

    const hashedPassword: string = await AuthUtil.getHashedPassword(password);
    const token = await withSqlTransaction(async (tx) => {
      const username = randomUUID();
      const userRes = await sqlExec(
        'INSERT INTO `User` (`username`, `name`, `email`, `phoneNumber`, `password`, `role`) VALUES (?, ?, ?, ?, ?, ?)',
        [username, name, email ?? null, phoneNumber, hashedPassword, UserRole.USER],
        tx,
      );
      const userId = Number(userRes.insertId);
      if (!userId) {
        throw ApiError.INTERNAL_SERVER_ERROR('Failed to user create');
      }

      // Fix: Added updatedAt explicitly because DB field doesn't have a default value
      // await sqlExec('INSERT INTO `Profile` (`userId`) VALUES (?)', [userId], tx);
      await sqlExec(
        'INSERT INTO `Profile` (`userId`, `updatedAt`) VALUES (?, ?)',
        [userId, new Date()],
        tx,
      );

      await sqlExec(
        'INSERT INTO `Account` (`id`, `userId`, `type`, `provider`, `providerAccountId`, `status`) VALUES (?, ?, ?, ?, ?, ?)',
        [
          randomUUID(),
          userId,
          AccountType.CREDENTIALS,
          AccountProvider.CREDENTIALS,
          userId.toString(),
          AccountStatus.PENDING,
        ],
        tx,
      );

      const verificationToken = await otpService.sendOTP(
        {
          name,
          email: email ?? null,
          phoneNumber,
          tokenType: AuthTokenType.VERIFICATION,
        },
        tx,
      );
      if (!verificationToken) {
        throw ApiError.INTERNAL_SERVER_ERROR('Failed to send OTP');
      }

      return verificationToken;
    });

    return ApiResponse.created(res, 'Registered successfully', {
      tokens: [
        {
          key: AuthTokenType.VERIFICATION,
          value: token,
        },
      ],
    });
  };

  public SellerRegister = async (req: Request, res: Response) => {
    const { fullName: name, email, phoneNumber, password } = req.body;

    const existing = await sqlQuery<{ id: number }>(
      'SELECT `id` FROM `User` WHERE `phoneNumber` = ? LIMIT 1',
      [phoneNumber],
    );
    const isExist = existing[0] ?? null;

    if (isExist && isExist?.id) {
      return ApiResponse.badRequest(res, 'Phone number is already registered');
    }
    if (email) {
      const existingEmail = await sqlQuery<{ id: number }>(
        'SELECT `id` FROM `User` WHERE `email` = ? LIMIT 1',
        [email],
      );

      if (existingEmail[0]?.id) {
        return ApiResponse.badRequest(res, 'Email is already registered');
      }
    }
    const hashedPassword: string = await AuthUtil.getHashedPassword(password);
    const token = await withSqlTransaction(async (tx) => {
      const username = randomUUID();
      const userRes = await sqlExec(
        'INSERT INTO `User` (`username`, `name`, `email`, `phoneNumber`, `password`, `role`) VALUES (?, ?, ?, ?, ?, ?)',
        [username, name, email ?? null, phoneNumber, hashedPassword, UserRole.SELLER],
        tx,
      );
      const userId = Number(userRes.insertId);
      if (!userId) {
        throw ApiError.INTERNAL_SERVER_ERROR('Failed to user create');
      }

      // Fix: Added updatedAt explicitly because DB field doesn't have a default value
      // await sqlExec('INSERT INTO `Profile` (`userId`) VALUES (?)', [userId], tx);
      await sqlExec(
        'INSERT INTO `Profile` (`userId`, `updatedAt`) VALUES (?, ?)',
        [userId, new Date()],
        tx,
      );

      await sqlExec(
        'INSERT INTO `Account` (`id`, `userId`, `type`, `provider`, `providerAccountId`, `status`) VALUES (?, ?, ?, ?, ?, ?)',
        [
          randomUUID(),
          userId,
          AccountType.CREDENTIALS,
          AccountProvider.CREDENTIALS,
          userId.toString(),
          AccountStatus.PENDING,
        ],
        tx,
      );

      const verificationToken = await otpService.sendOTP(
        {
          name,
          email: email ?? null,
          phoneNumber,
          tokenType: AuthTokenType.VERIFICATION,
        },
        tx,
      );
      if (!verificationToken) {
        throw ApiError.INTERNAL_SERVER_ERROR('Failed to send OTP');
      }

      return verificationToken;
    });

    return ApiResponse.created(res, 'Registered successfully', {
      tokens: [
        {
          key: AuthTokenType.VERIFICATION,
          value: token,
        },
      ],
    });
  };

  public createSellerProfile = async (req: Request, res: Response) => {
    const { gstin, pan, bank_account_no, bank_ifsc, upi_id } = req.body;

    // ✅ AUTO USER ID (login user se)
    const user_id = req.user?.id; // ⚠️ middleware required

    if (!user_id) {
      return ApiResponse.badRequest(res, 'User not authenticated');
    }

    // ✅ Check if already exists
    const existing = await sqlQuery<{ user_id: number }>(
      'SELECT `user_id` FROM `seller_profiles` WHERE `user_id` = ? LIMIT 1',
      [user_id],
    );

    if (existing[0]?.user_id) {
      return ApiResponse.badRequest(res, 'Seller profile already exists');
    }

    // ✅ Insert
    await sqlExec(
      `INSERT INTO seller_profiles 
    (user_id, gstin, pan, bank_account_no, bank_ifsc, upi_id, kyc_status) 
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id,
        gstin ?? null,
        pan ?? null,
        bank_account_no ?? null,
        bank_ifsc ?? null,
        upi_id ?? null,
        'pending',
      ],
    );

    return ApiResponse.created(res, 'Seller profile created successfully');
  };

  public createStoreLocation = async (req: Request, res: Response) => {
    const user_id = (req as any).user?.id;

    if (!user_id) {
      return ApiResponse.badRequest(res, 'User not authenticated');
    }

    const {
      location_type,
      address_line1,
      address_line2,
      city,
      state,
      country,
      pincode,
      latitude,
      longitude,
      radius,
      opening_time,
      closing_time,
      serviceability,
      is_active,
    } = req.body;

    // ✅ Get store_id from logged-in user
    const store = await sqlQuery<{ id: number }>(
      'SELECT `id` FROM `stores` WHERE `seller_user_id` = ? LIMIT 1',
      [user_id],
    );

    if (!store[0]?.id) {
      return ApiResponse.badRequest(res, 'Store not found for this user');
    }

    const store_id = store[0].id;

    // ✅ Insert location
    await sqlExec(
      `INSERT INTO store_locations
    (
      store_id,
      location_type,
      address_line1,
      address_line2,
      city,
      state,
      country,
      pincode,
      latitude,
      longitude,
      radius,
      opening_time,
      closing_time,
      serviceability,
      is_active
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        store_id,
        location_type ?? null,
        address_line1 ?? null,
        address_line2 ?? null,
        city ?? null,
        state ?? null,
        country ?? 'India',
        pincode ?? null,
        latitude ?? null,
        longitude ?? null,
        radius ?? null,
        opening_time ?? null,
        closing_time ?? null,
        serviceability ?? null,
        is_active ?? true,
      ],
    );

    return ApiResponse.created(res, 'Store location created successfully');
  };

  /** Same as `register`, but creates the account with the SELLER role (no GSTIN/PAN verification). */
  public registerSeller = async (req: Request, res: Response) => {
    const { fullName: name, email, phoneNumber, password } = req.body;

    const existing = await sqlQuery<{ id: number }>(
      'SELECT `id` FROM `User` WHERE `phoneNumber` = ? LIMIT 1',
      [phoneNumber],
    );
    const isExist = existing[0] ?? null;

    if (isExist?.id) {
      return ApiResponse.badRequest(res, 'Phone number is already registered');
    }

    const hashedPassword: string = await AuthUtil.getHashedPassword(password);
    const token = await withSqlTransaction(async (tx) => {
      const username = randomUUID();
      const userRes = await sqlExec(
        'INSERT INTO `User` (`username`, `name`, `email`, `phoneNumber`, `password`, `role`) VALUES (?, ?, ?, ?, ?, ?)',
        [username, name, email ?? null, phoneNumber, hashedPassword, UserRole.SELLER],
        tx,
      );
      const userId = Number(userRes.insertId);
      if (!userId) {
        throw ApiError.INTERNAL_SERVER_ERROR('Failed to create user');
      }

      // Fix: Added updatedAt explicitly because DB field doesn't have a default value
      // await sqlExec('INSERT INTO `Profile` (`userId`) VALUES (?)', [userId], tx);
      await sqlExec(
        'INSERT INTO `Profile` (`userId`, `updatedAt`) VALUES (?, ?)',
        [userId, new Date()],
        tx,
      );

      await sqlExec(
        'INSERT INTO `Account` (`id`, `userId`, `type`, `provider`, `providerAccountId`, `status`) VALUES (?, ?, ?, ?, ?, ?)',
        [
          randomUUID(),
          userId,
          AccountType.CREDENTIALS,
          AccountProvider.CREDENTIALS,
          userId.toString(),
          AccountStatus.PENDING,
        ],
        tx,
      );

      const verificationToken = await otpService.sendOTP(
        { name, email: email ?? null, phoneNumber, tokenType: AuthTokenType.VERIFICATION },
        tx,
      );
      if (!verificationToken) {
        throw ApiError.INTERNAL_SERVER_ERROR('Failed to send OTP');
      }
      return verificationToken;
    });

    return ApiResponse.created(res, 'Seller registered successfully', {
      tokens: [
        {
          key: AuthTokenType.VERIFICATION,
          value: token,
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
      const users = await sqlQuery<{
        id: number;
        name: string;
        email: string | null;
        password: string | null;
        role: UserRole;
        isTwoFactorEnabled: 0 | 1;
      }>(
        'SELECT `id`, `name`, `email`, `password`, `role`, `isTwoFactorEnabled` FROM `User` WHERE `phoneNumber` = ? LIMIT 1',
        [phoneNumber],
      );
      const user = users[0] ?? null;
      if (!user || !user.password) {
        return ApiResponse.notFound(res, 'User not found');
      }
      const isPasswordValid = await AuthUtil.compareHashedPassword(password, user.password);
      if (!isPasswordValid) {
        return ApiResponse.unauthorized(res, 'Invalid credentials');
      }

      const accounts = await sqlQuery<{
        provider: AccountProvider;
        providerAccountId: string;
        status: AccountStatus;
      }>('SELECT `provider`, `providerAccountId`, `status` FROM `Account` WHERE `userId` = ?', [
        user.id,
      ]);
      const credentialsAccount = accounts.find((a) => a.provider === AccountProvider.CREDENTIALS);
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

      const users = await sqlQuery<{
        id: number;
        name: string;
        email: string | null;
        phoneNumber: string;
      }>(
        'SELECT `id`, `name`, `email`, `phoneNumber` FROM `User` WHERE `phoneNumber` = ? LIMIT 1',
        [phoneNumber],
      );
      const user: User = (users[0] as any) ?? null;

      let token: string | null = null;
      if (!user) {
        token = await withSqlTransaction(async (tx) => {
          const username = randomUUID();
          const createdUserRes = await sqlExec(
            'INSERT INTO `User` (`username`, `phoneNumber`, `email`, `name`, `role`) VALUES (?, ?, ?, ?, ?)',
            [username, phoneNumber, email ?? null, phoneNumber.toString(), UserRole.USER],
            tx,
          );
          const userId = Number(createdUserRes.insertId);
          if (!userId) {
            throw ApiError.INTERNAL_SERVER_ERROR('Failed to create user');
          }

          // Fix: Added updatedAt explicitly because DB field doesn't have a default value
          // await sqlExec('INSERT INTO `Profile` (`userId`) VALUES (?)', [userId], tx);
          await sqlExec(
            'INSERT INTO `Profile` (`userId`, `updatedAt`) VALUES (?, ?)',
            [userId, new Date()],
            tx,
          );
          await sqlExec(
            'INSERT INTO `Account` (`id`, `userId`, `type`, `provider`, `providerAccountId`, `status`) VALUES (?, ?, ?, ?, ?, ?)',
            [
              randomUUID(),
              userId,
              AccountType.CREDENTIALS,
              AccountProvider.CREDENTIALS,
              userId.toString(),
              AccountStatus.PENDING,
            ],
            tx,
          );

          return await otpService.sendOTP(
            {
              name: phoneNumber.toString(),
              phoneNumber,
              email: email ?? null,
              tokenType: AuthTokenType.VERIFICATION,
            },
            tx,
          );
        });
      } else {
        token = await otpService.sendOTP({
          name: user.name,
          phoneNumber: user.phoneNumber,
          email: user?.email,
          tokenType: AuthTokenType.VERIFICATION,
        });
      }

      if (!token) {
        throw ApiError.INTERNAL_SERVER_ERROR('Failed to send OTP');
      }

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
    const user = req?.user;
    delete (user as { id?: number }).id;
    return ApiResponse.success(res, 'User found', {
      user: user as UserPayloadDTO,
    });
  };

  public authenticate = async (req: Request, res: Response, next: NextFunction) => {
    const accessToken: string | null = req.headers?.authorization?.split(' ')?.[1] ?? null;

    // 1. Try Authenticating with Access Token first
    if (accessToken && accessToken !== '') {
      const result = AuthTokenUtil.verifyAccessToken(accessToken);
      if (result.success && result.payload) {
        // Strip iat and exp from payload before re-signing
        const { iat, exp, ...cleanPayload } = result.payload as any;
        req.user = cleanPayload as UserPayloadDAO;

        const newAccessToken = AuthTokenUtil.generateAccessToken(cleanPayload as UserPayloadDAO);
        res.setHeader('Authorization', `Bearer ${newAccessToken}`);
        return next();
      }
    }

    // 2. Fallback to Refresh Token (Cookie) if Access Token is missing or expired
    const headerCookie = req.headers.cookie || null;
    if (!headerCookie) {
      return ApiResponse.unauthorized(res, 'Unauthorized - Missing Token and Cookie');
    }

    const cookies = headerCookie.split(';');
    let refreshToken: string | null = null;

    cookies.forEach((cookie) => {
      const [key, value] = cookie.trim().split('=');
      if (key == AuthTokenUtil.REFRESH_TOKEN_KEY_NAME) {
        refreshToken = value as string | null;
      }
    });

    if (!refreshToken || refreshToken == '') {
      return ApiResponse.unauthorized(res, 'Unauthorized - Missing Refresh Token');
    }

    const userPayloadUsingRefreshToken = AuthTokenUtil.verifyRefreshToken(refreshToken);
    if (!userPayloadUsingRefreshToken.success || !userPayloadUsingRefreshToken.payload) {
      return ApiResponse.unauthorized(res, 'Invalid Refresh Token');
    }

    // Strip iat and exp from payload before re-signing
    const { iat, exp, ...cleanPayload } = userPayloadUsingRefreshToken.payload as any;
    const newAccessToken = AuthTokenUtil.generateAccessToken(cleanPayload as UserPayloadDAO);
    req.user = cleanPayload as UserPayloadDAO;
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

    if (!refreshToken || refreshToken == '') {
      return next();
    }

    const userPayloadUsingAccessToken: {
      success: boolean;
      payload: UserPayloadDAO | null;
    } | null =
      accessToken && accessToken != '' ? AuthTokenUtil.verifyAccessToken(accessToken) : null;
    if (
      userPayloadUsingAccessToken &&
      userPayloadUsingAccessToken?.success &&
      userPayloadUsingAccessToken?.payload
    ) {
      const newAccessToken: string = AuthTokenUtil.generateAccessToken(
        userPayloadUsingAccessToken.payload,
      );
      req.user = userPayloadUsingAccessToken.payload;
      res.setHeader('Authorization', `Bearer ${newAccessToken}`);
      return next();
    }

    const userPayloadUsingRefreshToken: {
      success: boolean;
      payload: UserPayloadDAO | null;
    } = AuthTokenUtil.verifyRefreshToken(refreshToken);
    if (
      !userPayloadUsingRefreshToken ||
      !userPayloadUsingRefreshToken?.success ||
      !userPayloadUsingRefreshToken?.payload
    ) {
      return next();
    }
    const newAccessToken: string = AuthTokenUtil.generateAccessToken(
      userPayloadUsingRefreshToken.payload,
    );
    req.user = userPayloadUsingRefreshToken.payload;
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

    if (!refreshToken || refreshToken == '') {
      return ApiResponse.unauthorized(res, 'Unauthorized');
    }

    const userPayloadUsingRefreshToken: {
      success: boolean;
      payload: UserPayloadDAO | null;
    } = AuthTokenUtil.verifyRefreshToken(refreshToken);

    if (
      !userPayloadUsingRefreshToken ||
      !userPayloadUsingRefreshToken?.success ||
      !userPayloadUsingRefreshToken?.payload
    ) {
      return ApiResponse.unauthorized(res, 'Invalid Refresh Token');
    }

    const newPayload = {
      id: userPayloadUsingRefreshToken.payload?.id,
      name: userPayloadUsingRefreshToken.payload?.name,
      email: userPayloadUsingRefreshToken.payload?.email,
      phoneNumber: userPayloadUsingRefreshToken.payload?.phoneNumber,
      username: userPayloadUsingRefreshToken.payload?.username,
      avatar: userPayloadUsingRefreshToken.payload?.avatar,
      role: userPayloadUsingRefreshToken.payload?.role,
      isTwoFactorEnabled: userPayloadUsingRefreshToken.payload?.isTwoFactorEnabled,
      isRememberMe: userPayloadUsingRefreshToken.payload?.isRememberMe,
    } satisfies UserPayloadDAO;

    const newAccessToken: string = AuthTokenUtil.generateAccessToken(newPayload);
    res.setHeader('Authorization', `Bearer ${newAccessToken}`);
    if (
      userPayloadUsingRefreshToken.payload?.isRememberMe &&
      AuthTokenUtil.isRefreshTokenWillExpireInLessThan(userPayloadUsingRefreshToken.payload)
    ) {
      const newRefreshToken: string = AuthTokenUtil.generateRefreshToken(newPayload, true);
      res.cookie(
        AuthTokenUtil.REFRESH_TOKEN_KEY_NAME,
        newRefreshToken,
        AuthTokenUtil.getRefreshTokenCookieOptions(),
      );
    }

    return ApiResponse.success(res, 'New access token generated successfully', {
      accessToken: newAccessToken,
    });
  };

  public otpVerificationForCredentialAccountPreviewData = async (req: Request, res: Response) => {
    const { phoneNumber, tokens } = req.body;

    if (!Array.isArray(tokens) || tokens.length === 0) {
      return ApiError.BAD_REQUEST('Verification tokens are required');
    }

    const token = AuthUtil.getTokenFromBody(tokens, AuthTokenType.VERIFICATION);

    if (!token) {
      return ApiResponse.badRequest(res, 'Verification token not found');
    }

    const authTokens = await sqlQuery<{
      phoneNumber: string;
      expiresAt: Date;
      usedAt: Date | null;
    }>('SELECT `phoneNumber`, `expiresAt`, `usedAt` FROM `AuthToken` WHERE `token` = ? LIMIT 1', [
      token as string,
    ]);
    const authToken = authTokens[0] ?? null;

    if (!authToken) {
      return ApiResponse.notFound(res, 'Invalid token');
    }

    if (authToken.expiresAt < new Date()) {
      return ApiResponse.notFound(res, 'Token has expired');
    }

    if (authToken.usedAt) {
      return ApiResponse.notFound(res, 'Token has already been used');
    }

    const users = await sqlQuery<{ id: number; name: string }>(
      'SELECT `id`, `name` FROM `User` WHERE `phoneNumber` = ? LIMIT 1',
      [authToken.phoneNumber],
    );
    const user = users[0] ?? null;

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

    if (!Array.isArray(tokens) || tokens.length === 0) {
      return ApiError.BAD_REQUEST('Verification tokens are required');
    }

    const token = AuthUtil.getTokenFromBody(tokens, AuthTokenType.VERIFICATION);

    if (!token) {
      return ApiResponse.badRequest(res, 'Verification token not found');
    }

    const verifyOTPResponse = await otpService.verifyOTP(phoneNumber, otp, token);

    if (!verifyOTPResponse.success || !verifyOTPResponse.userId) {
      return ApiResponse.badRequest(res, verifyOTPResponse.message);
    }

    await sqlExec(
      'UPDATE `Account` SET `status` = ? WHERE `provider` = ? AND `providerAccountId` = ?',
      [AccountStatus.ACTIVE, AccountProvider.CREDENTIALS, verifyOTPResponse.userId.toString()],
    );
    const users = await sqlQuery<{
      name: string;
      email: string | null;
      role: UserRole;
    }>('SELECT `name`, `email`, `role` FROM `User` WHERE `id` = ? LIMIT 1', [
      verifyOTPResponse.userId,
    ]);

    const user = users[0] ?? null;

    if (user?.email) {
      void mailServiceAsync({
        to: user.email,
        subject:
          user.role === UserRole.SELLER
            ? 'Welcome to ODOP Mart Seller Portal'
            : 'Welcome to ODOP Mart',
        html:
          user.role === UserRole.SELLER
            ? SellerMailTemplate.sellerWelcome(user.name)
            : BuyerMailTemplate.buyerWelcome(user.name),
        text: `Welcome to ODOP Mart, ${user.name}`,
      });
    }

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

    const token = AuthUtil.getTokenFromBody(tokens, AuthTokenType.VERIFICATION);
    if (!token) {
      return ApiResponse.badRequest(res, 'Verification token not found');
    }

    const authTokens = await sqlQuery<{
      phoneNumber: string;
      expiresAt: Date;
      usedAt: Date | null;
    }>(
      'SELECT `phoneNumber`, `expiresAt`, `usedAt` FROM `AuthToken` WHERE `token` = ? AND `phoneNumber` = ? LIMIT 1',
      [token, phoneNumber],
    );
    const data = authTokens[0] ?? null;

    if (!data) {
      return ApiResponse.notFound(res, 'Invalid token');
    }

    if (data?.usedAt) {
      return ApiResponse.notFound(res, 'Token has already been used');
    }

    await sqlExec('UPDATE `AuthToken` SET `usedAt` = NOW() WHERE `token` = ?', [token]);

    const users = await sqlQuery<{ name: string }>(
      'SELECT `name` FROM `User` WHERE `phoneNumber` = ? LIMIT 1',
      [data.phoneNumber],
    );
    const user = users[0] ?? null;

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

    const users = await sqlQuery<{ name: string }>(
      'SELECT `name` FROM `User` WHERE `phoneNumber` = ? LIMIT 1',
      [phoneNumber],
    );
    const data = users[0] ?? null;

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

    const token = AuthUtil.getTokenFromBody(tokens, AuthTokenType.FORGOT_PASSWORD);
    if (!token) {
      return ApiResponse.badRequest(res, 'Token is required');
    }

    const authTokens = await sqlQuery<{
      phoneNumber: string;
      expiresAt: Date;
      usedAt: Date | null;
    }>(
      'SELECT `phoneNumber`, `expiresAt`, `usedAt` FROM `AuthToken` WHERE `token` = ? AND `phoneNumber` = ? LIMIT 1',
      [token, phoneNumber],
    );
    const data = authTokens[0] ?? null;

    if (!data || data.usedAt) {
      return ApiResponse.badRequest(res, 'Invalid token');
    }

    if (data.expiresAt < new Date()) {
      return ApiResponse.badRequest(res, 'Token has expired');
    }

    const users = await sqlQuery<{ name: string }>(
      'SELECT `name` FROM `User` WHERE `phoneNumber` = ? LIMIT 1',
      [data.phoneNumber],
    );
    const user = users[0] ?? null;

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

    const token = AuthUtil.getTokenFromBody(tokens, AuthTokenType.FORGOT_PASSWORD);
    if (!token) {
      return ApiResponse.badRequest(res, 'Token is required');
    }

    const authTokens = await sqlQuery<{ phoneNumber: string; expiresAt: Date }>(
      'SELECT `phoneNumber`, `expiresAt` FROM `AuthToken` WHERE `token` = ? AND `phoneNumber` = ? LIMIT 1',
      [token, phoneNumber],
    );
    const data = authTokens[0] ?? null;
    if (!data) {
      return ApiResponse.notFound(res, 'Invalid token');
    }

    const users = await sqlQuery<{ name: string }>(
      'SELECT `name` FROM `User` WHERE `phoneNumber` = ? LIMIT 1',
      [data.phoneNumber],
    );
    const user = users[0] ?? null;
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

    const token = AuthUtil.getTokenFromBody(tokens, AuthTokenType.FORGOT_PASSWORD);
    if (!token) {
      return ApiResponse.badRequest(res, 'Token is required');
    }

    const verifyOTPResponse = await otpService.verifyOTP(phoneNumber, otp, token);
    if (!verifyOTPResponse.success || !verifyOTPResponse.userId) {
      return ApiResponse.badRequest(res, verifyOTPResponse.message);
    }

    const resetToken = randomUUID();
    const inserted = await sqlExec(
      'INSERT INTO `AuthToken` (`token`, `phoneNumber`, `expiresAt`, `type`) VALUES (?, ?, ?, ?)',
      [
        resetToken,
        phoneNumber,
        new Date(Date.now() + authConstants.RESET_PASSWORD_EXPIRATION_TIME),
        AuthTokenType.RESET_PASSWORD,
      ],
    );
    if (!inserted?.affectedRows) {
      throw ApiError.BAD_REQUEST('Failed to create token');
    }

    return ApiResponse.success(res, 'Forgot password token verified successfully', {
      tokens: [
        {
          key: AuthTokenType.RESET_PASSWORD,
          value: resetToken,
        },
      ],
    });
  };

  public resetPasswordForCredentialAccount = async (req: Request, res: Response) => {
    const { phoneNumber, tokens, password } = req.body;

    if (!Array.isArray(tokens) || tokens.length === 0) {
      return ApiResponse.badRequest(res, 'Tokens are required');
    }

    const token = AuthUtil.getTokenFromBody(tokens, AuthTokenType.RESET_PASSWORD);
    if (!token) {
      return ApiResponse.badRequest(res, 'Token is required');
    }

    const authTokens = await sqlQuery<{ expiresAt: Date; usedAt: Date | null }>(
      'SELECT `expiresAt`, `usedAt` FROM `AuthToken` WHERE `token` = ? AND `phoneNumber` = ? LIMIT 1',
      [token, phoneNumber],
    );
    const data = authTokens[0] ?? null;

    if (!data || data?.usedAt) {
      return ApiResponse.badRequest(res, 'Invalid token');
    }

    await sqlExec('UPDATE `AuthToken` SET `usedAt` = NOW() WHERE `token` = ?', [token]);

    if (data.expiresAt < new Date()) {
      return ApiResponse.badRequest(res, 'Token has expired');
    }

    const userId = await withSqlTransaction(async (tx) => {
      const hashedPassword = await AuthUtil.getHashedPassword(password);
      const users = await sqlQuery<{ id: number }>(
        'SELECT `id` FROM `User` WHERE `phoneNumber` = ? LIMIT 1',
        [phoneNumber],
        tx,
      );
      const user = users[0] ?? null;
      if (!user?.id) {
        return null;
      }

      await sqlExec(
        'UPDATE `User` SET `password` = ? WHERE `id` = ?',
        [hashedPassword, user.id],
        tx,
      );
      await sqlExec(
        'UPDATE `Account` SET `status` = ? WHERE `provider` = ? AND `providerAccountId` = ?',
        [AccountStatus.ACTIVE, AccountProvider.CREDENTIALS, user.id.toString()],
        tx,
      );
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
