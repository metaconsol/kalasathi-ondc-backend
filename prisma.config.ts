import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';
import { env as appEnv } from './src/config/env.config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'bun run ./prisma/seed.ts',
  },
  engine: 'classic',
  datasource: {
    url: env('DATABASE_URL'),
    ...(!appEnv.isProduction &&
      appEnv.shadowDatabaseUrl && {
        shadowDatabaseUrl: appEnv.shadowDatabaseUrl,
        // https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/shadow-database
      }),
  },
});
