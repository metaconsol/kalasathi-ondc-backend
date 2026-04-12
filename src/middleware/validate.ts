import type { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { ApiResponse } from '~/lib/response';

export type ValidationSchemas = {
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
  headers?: z.ZodTypeAny;
};

export type ErrorFormatter = (error: ZodError) => any;

export interface ValidateOptions {
  /** Custom function to format errors (default uses flatten) */
  errorFormatter?: ErrorFormatter;
  /** Whether to continue to next() even on validation error (useful with global error handler) */
  continueOnError?: boolean;
  /** Custom error message */
  errorMessage?: string;
}

/**
 * Flexible Zod validation middleware for Express
 */
export const validate = (schemas: ValidationSchemas, options: ValidateOptions = {}) => {
  const {
    errorFormatter = (error) => z.flattenError(error).fieldErrors, // or z.flattenError if using older Zod
    continueOnError = false,
    errorMessage = 'Invalid data',
  } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const validationErrors: Record<string, any> = {};

    // Validate body
    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        validationErrors.body = errorFormatter(result.error);
      } else {
        req.body = result.data; // Apply transformations + parsed data
      }
    }

    // Validate query
    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        validationErrors.query = errorFormatter(result.error);
      } else {
        req.query = result.data as any;
      }
    }

    // Validate params
    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        validationErrors.params = errorFormatter(result.error);
      } else {
        req.params = result.data as any;
      }
    }

    // Validate headers (useful for custom headers)
    if (schemas.headers) {
      const result = schemas.headers.safeParse(req.headers);
      if (!result.success) {
        validationErrors.headers = errorFormatter(result.error);
      } else {
        // Note: req.headers is usually not mutated, but you can store in req if needed
        (req as any).validatedHeaders = result.data;
      }
    }

    // If any validation failed
    if (Object.keys(validationErrors).length > 0) {
      if (continueOnError) {
        (req as any).validationErrors = validationErrors;
        return next();
      }

      // Use your ApiResponse helper (as in your example)
      return ApiResponse.badRequest(
        res,
        errorMessage,
        validationErrors, // This will contain { body: {...}, query: {...} } etc.
      );
    }

    next();
  };
};
