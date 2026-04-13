import type { NextFunction, Response, Request } from 'express';

export interface IResponseData {
  success: boolean;
  message: string;
  data?: any;
  error?: any;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

export class ApiResponse {
  // Success response (200)
  static success(res: Response, message: string, data?: any, meta?: any): Response {
    const response: IResponseData = {
      success: true,
      message,
      data: this.processData(data),
      meta: this.processData(meta),
    };
    return res.status(200).json(response);
  }

  // Created response (201)
  static created(res: Response, message: string, data?: any): Response {
    const response: IResponseData = {
      success: true,
      message,
      data: this.processData(data),
    };
    return res.status(201).json(response);
  }

  // Accepted response (202)
  static accepted(res: Response, message: string, data?: any): Response {
    const response: IResponseData = {
      success: true,
      message,
      data: this.processData(data),
    };
    return res.status(202).json(response);
  }

  // No content response (204)
  static noContent(res: Response): Response {
    return res.status(204).send();
  }

  // Bad request response (400)
  static badRequest(res: Response, message: string, error?: any): Response {
    const response: IResponseData = {
      success: false,
      message,
      error: this.processError(error),
    };
    return res.status(400).json(response);
  }

  // Unauthorized response (401)
  static unauthorized(res: Response, message: string = 'Unauthorized access'): Response {
    const response: IResponseData = {
      success: false,
      message,
    };
    return res.status(401).json(response);
  }

  // Forbidden response (403)
  static forbidden(res: Response, message: string = 'Access forbidden'): Response {
    const response: IResponseData = {
      success: false,
      message,
    };
    return res.status(403).json(response);
  }

  // Not found response (404)
  static notFound(res: Response, message: string = 'Resource not found'): Response {
    const response: IResponseData = {
      success: false,
      message,
    };
    return res.status(404).json(response);
  }

  // Conflict response (409)
  static conflict(res: Response, message: string, error?: any): Response {
    const response: IResponseData = {
      success: false,
      message,
      error: this.processError(error),
    };
    return res.status(409).json(response);
  }

  // Internal server error (500)
  static error(
    res: Response,
    message: string = 'Internal server error',
    statusCode: number = 500,
    error?: any,
  ): Response {
    const response: IResponseData = {
      success: false,
      message,
      error: this.processError(error),
    };
    return res.status(statusCode).json(response);
  }

  // Custom status code response
  static custom(res: Response, message: string, statusCode: number = 500, data?: any): Response {
    const response: IResponseData = {
      success: statusCode >= 200 && statusCode < 300,
      message,
      data: this.processData(data),
    };
    return res.status(statusCode).json(response);
  }

  private static processData(data: any): any {
    return data === '' || data === null || data === undefined ? undefined : data;
  }

  private static processError(error: any): any {
    return error === '' || error === null || error === undefined ? undefined : error;
  }
}

export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;
  public errorCode?: string;

  constructor(message: string, statusCode: number, isOperational = true, errorCode?: string) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.errorCode = errorCode ?? '';
    Error.captureStackTrace(this, this.constructor);
  }
}

export const ApiError = {
  BAD_REQUEST: (
    message: string = 'Bad request',
    isOperational: boolean = true,
    errorCode?: string,
  ): AppError => new AppError(message, 400, isOperational, errorCode),
  UNAUTHORIZED: (
    message: string = 'Unauthorized access',
    isOperational: boolean = true,
    errorCode?: string,
  ): AppError => new AppError(message, 401, isOperational, errorCode),
  FORBIDDEN: (
    message: string = 'Access forbidden',
    isOperational: boolean = true,
    errorCode?: string,
  ): AppError => new AppError(message, 403, isOperational, errorCode),
  NOT_FOUND: (
    message: string = 'Resource not found',
    isOperational: boolean = true,
    errorCode?: string,
  ): AppError => new AppError(message, 404, isOperational, errorCode),
  CONFLICT: (
    message: string = 'Resource already exists',
    isOperational: boolean = true,
    errorCode?: string,
  ): AppError => new AppError(message, 409, isOperational, errorCode),
  INTERNAL_SERVER_ERROR: (
    message: string = 'Internal server error',
    isOperational: boolean = true,
    errorCode?: string,
  ): AppError => new AppError(message, 500, isOperational, errorCode),
  CUSTOM: (
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    errorCode?: string,
  ): AppError => new AppError(message, statusCode, isOperational, errorCode),
};

export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export function AsyncHandler(descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value;

  descriptor.value = function (...args: any[]) {
    const req = args[0] as Request;
    const res = args[1] as Response;
    const next = args[2] as NextFunction;

    return Promise.resolve(originalMethod.apply(this, args)).catch((error) => {
      next(error);
    });
  };

  return descriptor;
}
