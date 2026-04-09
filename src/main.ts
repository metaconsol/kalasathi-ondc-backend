import 'dotenv/config';

import { createServer } from 'node:http';

import { createApp } from './config/app.js';

const port = Number(process.env.PORT) || 3000;
const app = createApp();
const server = createServer(app);

try {
  server.listen(port, () => {
    console.log(`Listening on http://localhost:${port}`);
  });
} catch (error) {
  console.error(error);
  process.exit(1);
}
