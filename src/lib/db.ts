import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client';

import { env } from '~/config/env.config';

const databaseConfigs = () => {
  const databaseUrl = env.databaseUrl;
  const databaseUrlObject = new URL(databaseUrl);
  return {
    host: databaseUrlObject.hostname === 'localhost' ? '127.0.0.1' : databaseUrlObject.hostname,
    port: parseInt(databaseUrlObject.port, 10),
    user: databaseUrlObject.username,
    password: databaseUrlObject.password,
    database: databaseUrlObject.pathname.slice(1),
    connectionLimit: parseInt(databaseUrlObject.searchParams.get('connectionLimit') || '5', 10),
  };
};

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const createPrismaClient = () => {
  const configs = databaseConfigs();
  console.log(
    `[Prisma] Initializing client with host: ${configs.host}, port: ${configs.port}, user: ${configs.user}, db: ${configs.database}`,
  );

  const adapter = new PrismaMariaDb({
    host: configs.host,
    port: configs.port,
    user: configs.user,
    password: configs.password,
    database: configs.database,
    connectionLimit: configs.connectionLimit,
  });

  return new PrismaClient({ adapter });
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (env.nodeEnv !== 'production') globalForPrisma.prisma = db;
