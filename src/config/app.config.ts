import express, { type Application, type Request, type Response } from 'express';

import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';

import routes from '~/route';
import { env } from './env.config';
import { logger } from '~/lib/logger';
import { createSafeApp } from '~/lib/SafeExpress';
import { globalErrorHandler, notFoundHandler } from './error.config';
import { ApiResponse } from '~/lib/response';

const api = '/api/v1';

export function createApp(): Application {
  const app = createSafeApp();

  // Process events (can be anywhere, but fine here)
  process.on('uncaughtException', async (error) => {
    logger.error('Uncaught exception', { error });
  });
  process.on('unhandledRejection', async (ex) => {
    logger.error('Unhandled rejection', { ex });
  });

  // Trust proxy (first if needed)
  app.enable('trust proxy');

  // Security middleware (CORS, Helmet)
  app.use(
    cors({
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Cart-Session'],
      exposedHeaders: ['Authorization', 'X-Total-Count'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
      optionsSuccessStatus: 200,
      origin: (origin, callback) => {
        if (!origin || env.clients.includes(origin)) {
          callback(null, true);
        } else {
          logger.warn('CORS origin not allowed', { origin });
          callback(new Error('Not allowed by CORS'));
        }
      },
      preflightContinue: false,
    }),
  );

  app.use(helmet());

  // Body parsing (before routes)
  app.use(
    express.urlencoded({
      extended: true,
      limit: '5mb',
      type: 'application/x-www-form-urlencoded',
    }),
  );
  app.use(
    express.json({
      limit: '10mb',
      strict: true,
      type: 'application/json',
    }),
  );

  // Compression (after body parsing)
  app.use(compression());

  // Static files
  app.use(express.static('public'));

  // Disable headers
  app.disable('x-powered-by');
  // app.disable("etag");

  // Routes
  app.get('/', (_req: Request, res: Response) => {
    return ApiResponse.success(res, 'API is running');
  });
  app.use(api, routes);

  // 404 handler
  app.use(notFoundHandler);

  // Global error handler
  app.use(globalErrorHandler);

  return app;
}
