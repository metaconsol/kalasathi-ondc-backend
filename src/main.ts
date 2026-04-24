import 'dotenv/config';
import { createServer } from 'node:http';
import { db } from '~/lib/db';
import { logger } from '~/lib/logger';
import { env } from '~/config/env.config';
import { createApp } from './app';

async function startServer() {
  const app = createApp();
  const server = createServer(app);

  try {
    // 1. Establish Database Connection
    await db.$connect();
    logger.info('Prisma connected to the database successfully');

    // 2. Resolve Port
    const port = parseInt(process.env.PORT || env.serverPort.toString() || '5001', 10);

    // 3. Start Server
    server.listen(port, () => {
      logger.info(`Server is running on port ${port} in ${env.nodeEnv} mode`);
    });

    server.on('error', (err) => {
      logger.error('Critical server error:', err);
      process.exit(1);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

void startServer();
