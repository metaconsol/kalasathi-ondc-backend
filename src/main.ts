import 'dotenv/config';
import { createServer } from 'node:http';
import { logger } from '~/lib/logger';
import { env } from '~/config/env.config';
import { createApp } from './app';
import { sqlQuery } from '~/lib/sql';

async function startServer() {
  const app = createApp();
  const server = createServer(app);

  try {
    // 1. Verify Database Connection
    await sqlQuery('SELECT 1 as ok');
    logger.info('Database connected successfully');

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
