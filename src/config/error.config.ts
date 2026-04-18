import type { Request, Response, NextFunction } from 'express';
import { logger } from '~/lib/logger';
import { ApiError, ApiResponse, AppError } from '~/lib/response';

// Global error handler middleware
export const globalErrorHandler = (
  error: any,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  // Express 5 fires "Request aborted" when the client disconnects.
  // We cannot respond to a gone client, so silently ignore it.
  if (
    error.message === 'Request aborted' ||
    error.code === 'ECONNRESET' ||
    error.type === 'request.aborted'
  ) {
    return;
  }

  // Log full error details for debugging
  console.error('[GlobalErrorHandler]', {
    message: error.message,
    code: error.code,
    type: error.type,
    name: error.name,
    stack: error.stack,
    url: req.url,
    method: req.method,
  });

  // Log error
  logger.error({
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    statusCode: error.statusCode || 500,
    errorCode: error.errorCode,
    isOperational: error.isOperational,
  });

  // Handle specific error types
  if (error.type === 'entity.too.large') {
    return ApiResponse.custom(res, 'Request body is too large', 413);
  }

  if (error.name === 'SyntaxError' && error.type === 'entity.parse.failed') {
    return ApiResponse.badRequest(res, 'Invalid JSON payload');
  }

  if (error.name === 'MulterError') {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return ApiResponse.badRequest(res, 'File too large');
    }
    return ApiResponse.badRequest(res, `Upload error: ${error.message}`);
  }

  // Prisma errors (if using Prisma)
  if (error.code === 'P2002') {
    return ApiResponse.conflict(res, 'Unique constraint failed', error.meta);
  }

  if (error.code === 'P2025') {
    return ApiResponse.notFound(res, 'Record not found');
  }

  // JWT errors
  if (error.name === 'JsonWebTokenError') {
    return ApiResponse.unauthorized(res, 'Invalid token');
  }

  if (error.name === 'TokenExpiredError') {
    return ApiResponse.unauthorized(res, 'Token expired');
  }

  // Our custom AppError
  if (error instanceof AppError) {
    return ApiResponse.custom(res, error.message, error.statusCode, error.errorCode);
  }

  // Default error response
  const statusCode = error?.statusCode || 500;
  const message = error?.message || 'Internal server error';
  const errorCode = error?.errorCode || 'INTERNAL_SERVER_ERROR';
  return ApiResponse.custom(res, message, statusCode, errorCode);
};

// 404 handler for unmatched routes
export const notFoundHandler = (req: Request, _res: Response, next: NextFunction) => {
  const error = ApiError.NOT_FOUND(`Cannot ${req.method}`);
  next(error);
};
