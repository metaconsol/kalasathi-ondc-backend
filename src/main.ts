import 'dotenv/config';

import { createServer } from 'node:http';

import { db } from '~/lib/db';
import { logger } from '~/lib/logger';
import { env } from '~/config/env.config';
import { createApp } from '~/config/app.config';

const app = createApp();
const server = createServer(app);

try {
  if (env.serverPort) {
    server.listen(env.serverPort, () => {
      logger.info(`Server is running on port ${env.serverPort} in ${env.nodeEnv} mode`);
    });
  }
  try {
    await db.$connect();
    logger.info('Prisma connected to the database successfully');
  } catch (error) {
    logger.error('Prisma connection failed:', error);
    process.exit(1);
  }
} catch (error) {
  logger.error(error);
  process.exit(1);
}
