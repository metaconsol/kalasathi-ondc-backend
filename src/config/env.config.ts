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

  serverPort: parseInt(process.env.SERVER_PORT || '5000', 10),
  serverUrl: process.env.SERVER_URL || 'http://localhost:5000',

  databaseUrl: process.env.DATABASE_URL!,

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

  githubClientId: process.env.GITHUB_CLIENT_ID!,
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET!,

  mailHost: process.env.MAIL_HOST!,
  mailPort: parseInt(process.env.MAIL_PORT || '587', 10),
  mailPortSecure: process.env.MAIL_PORT_SECURE === 'true',
  mailUser: process.env.MAIL_USER!,
  mailPassword: process.env.MAIL_PASSWORD!,
};
