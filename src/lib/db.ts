import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client';

import { env } from '~/config/env.config';

const databaseConfigs = () => {
  const databaseUrl = env.databaseUrl;
  const databaseUrlObject = new URL(databaseUrl);
  return {
    host: databaseUrlObject.hostname,
    port: parseInt(databaseUrlObject.port, 10),
    user: databaseUrlObject.username,
    password: databaseUrlObject.password,
    database: databaseUrlObject.pathname.slice(1),
    connectionLimit: parseInt(databaseUrlObject.searchParams.get('connectionLimit') || '5', 10),
  };
};

const adapter = new PrismaMariaDb({
  host: databaseConfigs().host,
  port: databaseConfigs().port,
  user: databaseConfigs().user,
  password: databaseConfigs().password,
  database: databaseConfigs().database,
  connectionLimit: databaseConfigs().connectionLimit,
});

const db = new PrismaClient({ adapter });

export { db };
