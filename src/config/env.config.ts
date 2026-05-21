import 'dotenv/config';

const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};
const parseBoolean = (value: string | undefined, defaultValue = false): boolean => {
  if (value === undefined) return defaultValue;
  return value.trim().toLowerCase() === 'true';
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
  mailPortSecure: parseBoolean(process.env.MAIL_PORT_SECURE),
  mailUser: process.env.MAIL_USER!,
  mailPassword: process.env.MAIL_PASSWORD!,
  mailFrom: process.env.MAIL_FROM || process.env.META_APP_NAME || '',

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

  /** S3 object storage (optional). Uses `AWS_ACCESS_KEY` / `AWS_SECRET_KEY` aliases if standard names unset. */
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY || '',
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_KEY || '',
  awsBucketName: process.env.AWS_BUCKET_NAME || '',
  awsRegion: process.env.AWS_REGION || '',
  /** Presigned GET expiry (seconds). S3 SigV4 presigned URLs cannot exceed 7 days. */
  awsS3SignedUrlExpiresSeconds: parseInt(
    process.env.AWS_S3_SIGNED_URL_EXPIRES_SECONDS || '604800',
    10,
  ),
  /** Public object URLs are always returned for uploaded media. Kept for backward-compatible env parsing. */
  awsS3UsePublicUrl: process.env.AWS_S3_USE_PUBLIC_URL !== 'false',
  /** Cache metadata applied to uploaded objects. */
  awsS3ObjectCacheControl:
    process.env.AWS_S3_OBJECT_CACHE_CONTROL || 'public, max-age=31536000, immutable',
  /** HTTP Expires metadata applied to uploaded objects. Default 10 years. */
  awsS3ObjectExpiresDays: parseInt(process.env.AWS_S3_OBJECT_EXPIRES_DAYS || '3650', 10),

  isS3Configured: !!(
    (process.env.AWS_BUCKET_NAME || '').trim() &&
    (process.env.AWS_REGION || '').trim() &&
    (process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY || '').trim() &&
    (process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_KEY || '').trim()
  ),
};
