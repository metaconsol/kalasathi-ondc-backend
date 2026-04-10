import 'dotenv/config';

import { createServer } from 'node:http';

import { logger } from './lib/logger.js';
import { env } from './config/env.config.js';
import { createApp } from './config/app.config.js';

const app = createApp();
const server = createServer(app);

try {
  if (env.serverPort) {
    server.listen(env.serverPort, () => {
      logger.info(`Server is running on port ${env.serverPort} in ${env.nodeEnv} mode`);
    });
  }
} catch (error) {
  logger.error(error);
  process.exit(1);
}
