import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';
import { ApiError, ApiResponse, AppError } from '../lib/response';

/**
 * 404 handler for unmatched routes.
 */
export const notFoundHandler = (req: Request, _res: Response, next: NextFunction) => {
  const error = ApiError.NOT_FOUND(`Route ${req.method} ${req.url} not found`);
  next(error);
};

/**
 * Global error handler middleware.
 */
export const globalErrorHandler = (
  error: any,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  // Handle client disconnects
  if (
    error.message === 'Request aborted' ||
    error.code === 'ECONNRESET' ||
    error.code === 'ECONNABORTED' ||
    error.type === 'request.aborted' ||
    (error.message && error.message.toLowerCase().includes('request aborted'))
  ) {
    return res.status(499).end();
  }

  // Log error
  const sql = (error as any)?.query;
  const sqlParams = (error as any)?.params;
  const extras =
    sql != null
      ? `\nSQL: ${String(sql)}\nSQL params: ${(() => {
          try {
            return JSON.stringify(sqlParams);
          } catch {
            return String(sqlParams);
          }
        })()}`
      : '';
  logger.error(
    `${error.message}${extras}\n${req.method} ${req.url}${process.env.NODE_ENV === 'development' ? `\n${error.stack ?? ''}` : ''}`,
  );

  // Prisma errors
  if (error.code === 'P2002')
    return ApiResponse.conflict(res, 'Unique constraint failed', error.meta);
  if (error.code === 'P2025') return ApiResponse.notFound(res, 'Record not found');

  // App errors
  if (error instanceof AppError) {
    return ApiResponse.custom(res, error.message, error.statusCode, error.errorCode);
  }

  // Default to 500
  const statusCode = error?.statusCode || 500;
  const message = error?.message || 'Server error';
  return ApiResponse.custom(res, message, statusCode);
};

export const errorCodes = {
  MAIL_CONNECTION_FAILURE: 'MAIL_CONNECTION_FAILURE',
  MAIL_SEND_FAILURE: 'MAIL_SEND_FAILURE',
  SMS_SEND_FAILURE: 'SMS_SEND_FAILURE',
  SMS_CONNECTION_FAILURE: 'SMS_CONNECTION_FAILURE',
  OTP_CREATE_FAILURE: 'OTP_CREATE_FAILURE',
};
