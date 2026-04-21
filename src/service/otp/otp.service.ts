import { db } from '~/lib/db';
import { logger } from '~/lib/logger';
import { debugForDev } from '~/lib/utils';
import { AppError } from '~/lib/response';
import { OTPTemplate } from './otp.template';
import { authConstants } from '~/lib/constant';
import { smsService } from '../sms/sms.service';
import { errorCodes } from '~/middleware/error.middleware';
import type { Prisma } from '~/generated/prisma/client';
import { AuthTokenType } from '~/generated/prisma/enums';
import { mailServiceAsync } from '~/service/mail/mail.service';

type SendOTPType = {
  phoneNumber: string;
  name: string;
  tokenType: AuthTokenType;
  email?: string | null;
};

/** Same mobile in different surface forms (e.g. spacing) should still verify when session token matches. */
function phoneNumbersMatch(stored: string, submitted: string): boolean {
  const a = String(stored ?? '').trim();
  const b = String(submitted ?? '').trim();
  if (a === b) {
    return true;
  }
  const digitsA = a.replace(/\D/g, '');
  const digitsB = b.replace(/\D/g, '');
  return digitsA.length >= 10 && digitsA === digitsB;
}

const TemplateMap = {
  [AuthTokenType.VERIFICATION]: {
    email: OTPTemplate.verificationForEmail,
    sms: OTPTemplate.verificationForSMS,
  },
  [AuthTokenType.FORGOT_PASSWORD]: {
    email: OTPTemplate.forgotPasswordForEmail,
    sms: OTPTemplate.forgotPasswordForSMS,
  },
};

class OTPService {
  private constructor() {}
  public static getInstance(): OTPService {
    return new OTPService();
  }

  private generateOTP = () => {
    const otp = Math.floor(100000 + Math.random() * 900000);
    return otp.toString();
  };

  /** Inserts AuthToken + Otp atomically so we never persist a token without its OTP row. */
  private createAuthTokenAndOtpRow = async (
    data: SendOTPType,
    expiresAtMs: number,
    client: Prisma.TransactionClient,
  ): Promise<{ token: string; code: string }> => {
    const tokenRow = await client.authToken.create({
      data: {
        phoneNumber: data.phoneNumber,
        expiresAt: new Date(expiresAtMs),
        type: data.tokenType,
      },
      select: { token: true },
    });

    if (!tokenRow?.token) {
      throw new AppError('Failed to create token', 500, true, errorCodes.OTP_CREATE_FAILURE);
    }

    const code = this.generateOTP();

    await client.otp.create({
      data: {
        phoneNumber: data.phoneNumber,
        code,
        expiresAt: new Date(expiresAtMs),
        authToken: tokenRow.token,
      },
    });

    return { token: tokenRow.token, code };
  };

  public sendOTP = async (
    data: SendOTPType,
    dbTransaction?: Prisma.TransactionClient,
  ): Promise<string> => {
    const expiresAtMs = Date.now() + authConstants.OTP_EXPIRATION_TIME;

    const { token: tokenStr, code } = dbTransaction
      ? await this.createAuthTokenAndOtpRow(data, expiresAtMs, dbTransaction)
      : await db.$transaction((tx) => this.createAuthTokenAndOtpRow(data, expiresAtMs, tx));

    const smsResponse = await smsService.sendSMS({
      phoneNumber: data.phoneNumber,
      message: TemplateMap[data.tokenType as keyof typeof TemplateMap].sms(code),
    });

    debugForDev('SMS Response', smsResponse);

    // Email is best-effort; do not block OTP. Skip when SMTP is not configured to avoid noisy errors in local dev.
    if (data?.email && process.env.MAIL_HOST) {
      void mailServiceAsync({
        to: data.email,
        subject: 'Your Verification Code',
        html: TemplateMap[data.tokenType as keyof typeof TemplateMap].email(code, data.name),
      });
    }

    return tokenStr;
  };

  private updateUsedOtp = async (otpId: number, token: string): Promise<void> => {
    try {
      await db.otp.update({
        where: {
          id: otpId,
        },
        data: {
          usedAt: new Date(),
        },
        select: {
          expiresAt: true,
        },
      });

      await db.authToken.update({
        where: {
          token: token,
        },
        data: {
          usedAt: new Date(),
        },
      });
    } catch (error) {
      logger.error('Error updating used OTP:', error);
    }
  };

  public verifyOTP = async (phoneNumber: string, code: string, token: string) => {
    const normalizedPhone = String(phoneNumber ?? '').trim();
    const normalizedCode = String(code ?? '').trim();
    const submittedToken = String(token ?? '').trim();
    const tokenLookupVariants = Array.from(
      new Set([submittedToken, submittedToken.toLowerCase(), submittedToken.toUpperCase()]),
    );

    const user = await db.user.findUnique({
      where: {
        phoneNumber: normalizedPhone,
      },
      select: {
        id: true,
      },
    });

    if (!user || !user.id) {
      return {
        success: false,
        message: 'User not found',
      };
    }

    // Use DB-canonical token for Otp.authToken: MySQL often matches AuthToken.token case-insensitively
    // while Otp.authToken compares case-sensitively, so the client string can find AuthToken but miss Otp.
    const authSession = await db.authToken.findFirst({
      where: { token: { in: tokenLookupVariants } },
      select: {
        token: true,
        phoneNumber: true,
        expiresAt: true,
        usedAt: true,
      },
    });

    if (!authSession) {
      return {
        success: false,
        message:
          'Invalid verification session. Use the latest token from the last OTP or login response (after Resend, update tokens).',
      };
    }

    const dbToken = authSession.token;

    if (!phoneNumbersMatch(authSession.phoneNumber, normalizedPhone)) {
      return {
        success: false,
        message: 'Phone number does not match this verification session.',
      };
    }

    if (authSession.usedAt) {
      return {
        success: false,
        message: 'This verification session was already used. Request a new OTP.',
      };
    }

    if (authSession.expiresAt < new Date()) {
      return {
        success: false,
        message: 'OTP has expired',
      };
    }

    // Resolve OTP by canonical FK value stored with the row (see dbToken / collation note above).
    const otp = await db.otp.findFirst({
      where: {
        authToken: dbToken,
      },
      select: {
        id: true,
        phoneNumber: true,
        code: true,
        expiresAt: true,
        usedAt: true,
        authTokenRef: {
          select: {
            type: true,
            usedAt: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!otp) {
      logger.warn(
        `verifyOTP: AuthToken exists but no Otp row (stale/orphan session), dbToken=${dbToken}; removing token so a new OTP can be requested.`,
      );
      try {
        await db.authToken.delete({ where: { token: dbToken } });
      } catch {
        // ignore (e.g. concurrent delete)
      }
      return {
        success: false,
        message:
          'This verification session was incomplete on the server. A new OTP has been required—request a code again, then verify with the latest SMS and token only.',
      };
    }

    if (otp.usedAt || otp.authTokenRef?.usedAt) {
      return {
        success: false,
        message: 'OTP has already been used',
      };
    }

    if (otp.expiresAt < new Date()) {
      return {
        success: false,
        message: 'OTP has expired',
      };
    }

    if (!phoneNumbersMatch(otp.phoneNumber, normalizedPhone)) {
      return {
        success: false,
        message: 'Phone number does not match this verification session.',
      };
    }

    const storedCode = String(otp.code ?? '').trim();
    if (storedCode !== normalizedCode) {
      return {
        success: false,
        message:
          'Invalid verification code. Use the 6-digit code from the latest SMS for this session, or tap Resend and use the new code and token.',
      };
    }

    this.updateUsedOtp(otp.id, dbToken);
    return {
      success: true,
      message: 'OTP verified successfully',
      userId: user.id,
    };
  };
}

export const otpService = OTPService.getInstance();
