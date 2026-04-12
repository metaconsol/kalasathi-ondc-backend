import { db } from '~/lib/db';
import { logger } from '~/lib/logger';

import { env } from '~/config/env.config';
import { AppError } from '~/lib/response';
import { OTPTemplate } from './otp.template';
import { authConstants } from '~/lib/constant';
import { smsService } from '../sms/sms.service';
import { AuthTokenType } from '~/generated/prisma/enums';
import { mailServiceAsync } from '~/service/mail/mail.service';
import { errorCodes } from '~/config/error.config';

type SendOTPType = {
  phoneNumber: string;
  name: string;
  tokenType: AuthTokenType;
  email?: string | null;
};

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

  public sendOTP = async (data: SendOTPType): Promise<string> => {
    const expires = Date.now() + authConstants.OTP_EXPIRATION_TIME;

    const token = await db.authToken.create({
      data: {
        phoneNumber: data.phoneNumber,
        expiresAt: new Date(expires),
        type: data.tokenType,
      },
      select: {
        token: true,
      },
    });

    if (!token || !token.token) {
      throw new AppError('Failed to create token', 500, true, errorCodes.OTP_CREATE_FAILURE);
    }

    const code = this.generateOTP();

    await db.otp.create({
      data: {
        phoneNumber: data.phoneNumber,
        code: code,
        expiresAt: new Date(expires),
        authToken: token.token,
      },
    });

    await smsService.sendSMS({
      phoneNumber: data.phoneNumber,
      message: TemplateMap[data.tokenType as keyof typeof TemplateMap].sms(code),
      senderId: env.smsSenderId,
      dltEntityId: env.smsDltEntityId,
    });

    if (data?.email) {
      mailServiceAsync({
        to: data.email,
        subject: 'Your Verification Code',
        html: TemplateMap[data.tokenType as keyof typeof TemplateMap].email(code, data.name),
      });
    }

    return token.token;
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
    const user = await db.user.findUnique({
      where: {
        phoneNumber: phoneNumber,
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

    const otp = await db.otp.findFirst({
      where: {
        phoneNumber: phoneNumber,
        code,
        authToken: token,
      },
      select: {
        id: true,
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
      return {
        success: false,
        message: 'Invalid OTP',
      };
    }

    if (otp.expiresAt < new Date()) {
      return {
        success: false,
        message: 'OTP has expired',
      };
    }

    if (otp?.usedAt || otp?.authTokenRef?.usedAt) {
      return {
        success: false,
        message: 'OTP has already been used',
      };
    }

    this.updateUsedOtp(otp.id, token);
    return {
      success: true,
      message: 'OTP verified successfully',
      userId: user.id,
    };
  };
}

export const otpService = OTPService.getInstance();
