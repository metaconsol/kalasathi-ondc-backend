import 'dotenv/config';

import { createServer } from 'node:http';

import { db } from '~/lib/db';
import { logger } from '~/lib/logger';
import { env } from '~/config/env.config';
import { createApp } from '~/config/app.config';

const app = createApp();
const server = createServer(app);

const resolveListenPort = (): number => {
  const fromPassenger = parseInt(process.env.PORT || '', 10);
  if (!Number.isNaN(fromPassenger) && fromPassenger > 0) {
    return fromPassenger;
  }
  return env.serverPort > 0 ? env.serverPort : 3000;
};

const startServer = async () => {
  try {
    await db.$connect();
    logger.info('Prisma connected to the database successfully');

    const port = resolveListenPort();

    server.listen(port, () => {
      logger.info(`Server is running on port ${port} in ${env.nodeEnv} mode`);
    });
  } catch (error) {
    logger.error('Startup failed:', error);
    process.exit(1);
  }
};

void startServer();
