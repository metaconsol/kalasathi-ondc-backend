import 'dotenv/config';

const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

export const env = {
  nodeEnv: process.env.NODE_ENV,
  isProduction: process.env.NODE_ENV === 'production',

  /**
   * When true (non-production), missing store/category rows used in seller product APIs
   * are auto-created so local Postman tests work without seed data.
   * Set DEV_BOOTSTRAP_STORE=false to disable.
   */
  devBootstrapStore:
    process.env.NODE_ENV !== 'production' && process.env.DEV_BOOTSTRAP_STORE !== 'false',

  serverPort: parseInt(process.env.SERVER_PORT || '5000', 10),
  serverUrl: process.env.SERVER_URL || 'http://localhost:5000',

  databaseUrl: process.env.DATABASE_URL!,
  shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL || '',

  clients: Object.keys(process.env)
    .filter((key) => key.startsWith('CLIENT_'))
    .map((key) => process.env[key] as string)
    .filter((client) => client && isValidUrl(client)),

  accessTokenSecretKey: process.env.ACCESS_TOKEN_SECRET_KEY!,
  accessTokenExpiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN!,
  refreshTokenSecretKey: process.env.REFRESH_TOKEN_SECRET_KEY!,
  refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN!,

  googleClientId: process.env.GOOGLE_CLIENT_ID!,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET!,

  mailService: process.env.MAIL_SERVICE || 'smtp',
  mailHost: process.env.MAIL_HOST!,
  mailPort: parseInt(process.env.MAIL_PORT || '587', 10),
  mailPortSecure: process.env.MAIL_PORT_SECURE === 'true',
  mailUser: process.env.MAIL_USER!,
  mailPassword: process.env.MAIL_PASSWORD!,

  /** @see https://www.smsgateway.center/docs/api/send-sms-curl/ */
  smsGatewayUrl: process.env.SMS_GATEWAY_URL!,
  smsGatewaySendUrl:
    process.env.SMS_GATEWAY_SEND_URL || 'https://www.smsgateway.center/SMSApi/rest/send',
  smsGatewayUserId: process.env.SMS_GATEWAY_USERID!,
  smsGatewayPassword: process.env.SMS_GATEWAY_PASSWORD!,
  smsSenderId: process.env.SMS_SENDER_ID!,
  /** Principal entity ID (India DLT); optional if saved in SMSGateway.Center profile */
  smsDltEntityId: process.env.SMS_DLT_ENTITY_ID || '',
  /** Template ID registered on DLT; required by many Indian routes if not in dashboard */
  smsDltTemplateId: process.env.SMS_DLT_TEMPLATE_ID || '',
};
