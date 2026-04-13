import { env } from '~/config/env.config';
import { errorCodes } from '~/config/error.config';
import { AppError } from '~/lib/response';
import { debugForDev } from '~/lib/utils';

interface SendSMSRequest {
  phoneNumber: string;
  message: string;
  senderId?: string;
  dltEntityId?: string;
  duplicateCheck?: boolean;
}

interface SendSMSResponse {
  success: boolean;
  message: string;
  data: any;
}

function normalizeIndianMobile(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, '');
  if (digits.length === 10) {
    return `91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return `91${digits.slice(1)}`;
  }
  return digits || phoneNumber;
}

class SMSService {
  private constructor() {}
  public static getInstance(): SMSService {
    return new SMSService();
  }
  public sendSMS = async (data: SendSMSRequest): Promise<SendSMSResponse> => {
    try {
      const params = new URLSearchParams();
      params.append('userid', env.smsGatewayUserId);
      params.append('password', env.smsGatewayPassword);
      params.append('mobile', normalizeIndianMobile(data.phoneNumber));
      params.append('senderid', data?.senderId ?? env.smsSenderId);
      params.append('msg', data.message);
      params.append('sendMethod', 'quick');
      params.append('msgType', 'text');
      params.append('output', 'json');
      params.append('dltEntityId', data?.dltEntityId ?? env.smsDltEntityId);

      if (data.duplicateCheck ?? true) {
        params.append('duplicatecheck', 'true');
      }

      debugForDev('SMS Request Body', params.toString());

      const response = await fetch(env.smsGatewaySendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        signal: AbortSignal.timeout(10000),
      });
      // debugForDev('Response', response);
      const text = await response.text();
      try {
        // debugForDev('Text', text);
        return JSON.parse(text) as SendSMSResponse;
      } catch {
        throw new AppError(
          `SMS gateway returned non-JSON (HTTP ${response.status}): ${text.slice(0, 200)}`,
          502,
          true,
          errorCodes.SMS_SEND_FAILURE,
        );
      }
    } catch (error) {
      // debugForDev('Error', error);
      throw new AppError('Failed to send SMS', 500, true, errorCodes.SMS_SEND_FAILURE);
    }
  };
}

export const smsService = SMSService.getInstance();
