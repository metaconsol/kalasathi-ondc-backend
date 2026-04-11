import { db } from '~/lib/db';
import { logger } from '~/lib/logger';

import { OTPTemplate } from './otp.template';
import { AuthTokenType } from '~/generated/prisma/enums';
import { MailService } from '~/service/mail/mail.service';

type SendOTPType = {
  phoneNumber: string;
  name: string;
  token: AuthTokenType;
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

  public sendOTP = async (data: SendOTPType): Promise<string | null> => {
    try {
      const mailService = new MailService();
      const expires = Date.now() + 10 * 60 * 1000; // 10 minutes expiry
      const token = await db.authToken.create({
        data: {
          phoneNumber: data.phoneNumber,
          expiresAt: new Date(expires),
          type: data.token,
        },
        select: {
          token: true,
        },
      });

      if (!token || !token.token) {
        throw new Error('Failed to create token');
      }

      const code = this.generateOTP();

      await db.oTP.create({
        data: {
          phoneNumber: data.phoneNumber,
          code: code,
          expiresAt: new Date(expires),
          authToken: token.token,
        },
      });

      mailService.sendMailAndClose({
        to: data.phoneNumber,
        subject: 'Your Verification Code',
        html: OTPTemplate.verificationForEmail(code, data.name),
      });

      return token.token;
    } catch (error) {
      logger.error('Error sending OTP:', error);
      throw error;
    }
  };

  private updateUsedOtp = async (otpId: string): Promise<void> => {
    try {
      await db.oTP.update({
        where: {
          id: parseInt(otpId),
        },
        data: {
          usedAt: new Date(),
        },
        select: {
          expiresAt: true,
        },
      });
    } catch (error) {
      logger.error('Error updating used OTP:', error);
    }
  };

  public verifyOTP = async (phoneNumber: string, code: string) => {
    try {
      const user = await db.user.findUnique({
        where: {
          phoneNumber: phoneNumber,
        },
        select: {
          id: true,
        },
      });

      if (!user) {
        throw new Error('User not found');
      }

      const otp = await db.oTP.findFirstOrThrow({
        where: {
          phoneNumber: phoneNumber,
          code,
        },
        select: {
          id: true,
          expiresAt: true,
          authTokenRef: {
            select: {
              type: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (!otp) {
        throw new Error('Invalid OTP');
      }

      if (otp.expiresAt < new Date()) {
        throw new Error('OTP has expired');
      }

      this.updateUsedOtp(otp.id.toString());

      return otp?.authTokenRef?.type || null;
    } catch (error) {
      logger.error('Error verifying OTP:', error);
      return null;
    }
  };
}

export const otpService = OTPService.getInstance();
