import express, { type Application, type Request, type Response } from 'express';
import { createRequire } from 'node:module';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import 'dotenv/config';

import routes from '~/route';
import { env } from '~/config/env.config';
import { logger } from '~/lib/logger';
import { createSafeApp } from '~/lib/SafeExpress';
import { globalErrorHandler, notFoundHandler } from '~/middleware/error.middleware';
import { ApiResponse } from '~/lib/response';

const require = createRequire(import.meta.url);
const { version: appVersion } = require('../package.json');

/**
 * Creates and configures the Express application.
 * Follows Production-Ready Layered Architecture.
 */
export function createApp(): Application {
  const app = createSafeApp();

  // Handle process-level events
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error });
  });
  process.on('unhandledRejection', (ex) => {
    logger.error('Unhandled rejection', { ex });
  });

  // Basic security and scalability settings
  app.enable('trust proxy');
  app.disable('x-powered-by');

  // Security & Optimization Middleware
  app.use(
    cors({
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Cart-Session'],
      exposedHeaders: ['Authorization', 'X-Total-Count'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
      origin: (origin, callback) => {
        if (!origin || env.nodeEnv === 'development' || env.clients.includes(origin)) {
          callback(null, true);
        } else {
          logger.warn('CORS origin not allowed', { origin });
          callback(new Error('Not allowed by CORS'));
        }
      },
    }),
  );
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    }),
  );

  app.use(compression());

  /**
   * Custom Body Parsing Logic
   * Skips built-in parsers for multipart/form-data to allow Multer to handle streams.
   */
  const urlencodedParser = express.urlencoded({ extended: true, limit: '5mb' });
  const jsonParser = express.json({
    limit: '10mb',
    strict: true,
    // ONDC signature verification MUST hash the exact bytes the sender signed.
    // JSON.parse→stringify does not round-trip whitespace/unicode-escapes, so we
    // keep the raw body for /ondc auth (see ondcAuth.middleware.ts).
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: string }).rawBody = buf.toString('utf8');
    },
  });

  app.use((req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
      return next();
    }
    urlencodedParser(req, res, (err) => {
      if (err) return next(err);
      jsonParser(req, res, next);
    });
  });

  // Static files and public assets
  app.use(express.static('public'));

  // Health check / Root endpoint
  app.get('/', (_req: Request, res: Response) => {
    return ApiResponse.success(res, 'ODOP API is running');
  });

  // Diagnostic endpoint for production verification
  app.get('/api/version', (_req: Request, res: Response) => {
    return ApiResponse.success(res, 'ODOP API version info', {
      version: appVersion,
      nodeEnv: env.nodeEnv,
      serverUrl: env.serverUrl,
      time: new Date().toISOString(),
    });
  });

  // Beckn short-path aliases: POST /search → /api/v1/ondc/search, etc.
  // Lets the BPP_SUBSCRIBER_URL be the bare domain without /api/v1/ondc prefix.
  const BECKN_ACTIONS = new Set([
    'search',
    'select',
    'init',
    'confirm',
    'cancel',
    'update',
    'status',
    'track',
    'rating',
    'issue',
    'issue_status',
    'recon',
    'on_recon',
    'on_receiver_recon',
    'on_search',
    'on_select',
    'on_init',
    'on_confirm',
    'on_cancel',
    'on_update',
    'on_status',
    'on_track',
    'on_rating',
    'on_issue',
    'on_issue_status',
  ]);
  app.use((req, _res, next) => {
    const action = req.path.replace(/^\//, '').split('/')[0] ?? '';
    if (BECKN_ACTIONS.has(action)) {
      req.url = `/api/v1/ondc${req.url}`;
    } else if (action === 'ppf') {
      // Admin UI / Postman sometimes call /ppf/* without /api/v1/ondc/admin prefix
      req.url = `/api/v1/ondc/admin${req.url}`;
    }
    next();
  });

  // Mount API Routes under /api/v1
  app.use('/api/v1', routes);

  // Global Handlers for 404 and Errors
  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
}
