import express from 'express';
import { ApiError, ApiResponse } from '~/lib/response';
import type { Request, Response } from 'express';

const router = express.Router();

router.get('/', (_req: Request, _res: Response) => {
  throw new Error('Test error');
});

///////////////////////////////////////////////////////////////////////////////

router.get('/success-0', (_req: Request, res: Response) => {
  return ApiResponse.success(res, 'Test success 0', {
    message: 'Test success 0',
    data: {
      message: 'Test success 0',
    },
  });
});

router.get('/success-1', (_req: Request, res: Response) => {
  return ApiResponse.success(res, 'Test success 1', {
    message: 'Test success 1',
  });
});

///////////////////////////////////////////////////////////////////////////////

router.get('/created', (_req: Request, res: Response) => {
  return ApiResponse.created(res, 'Test created', {
    message: 'Test created',
  });
});

///////////////////////////////////////////////////////////////////////////////

router.get('/no-content', (_req: Request, res: Response) => {
  return ApiResponse.noContent(res);
});

///////////////////////////////////////////////////////////////////////////////

router.get('/custom', (_req: Request, res: Response) => {
  return ApiResponse.custom(res, 'Test custom', 200, {
    message: 'Test custom',
  });
});

///////////////////////////////////////////////////////////////////////////////

router.get('/error-1', (_req: Request, res: Response) => {
  return ApiResponse.badRequest(res, 'Test error', {
    message: 'Test error 1',
  });
});

router.get('/error-2', (_req: Request, res: Response) => {
  return ApiResponse.unauthorized(res, 'Test error 2');
});

router.get('/error-3', (_req: Request, res: Response) => {
  return ApiResponse.forbidden(res, 'Test error 3');
});

router.get('/error-4', (_req: Request, res: Response) => {
  return ApiResponse.notFound(res, 'Test error 4');
});

router.get('/error-5', (_req: Request, res: Response) => {
  return ApiResponse.conflict(res, 'Test error 5');
});

router.get('/error-6', (_req: Request, res: Response) => {
  return ApiResponse.error(res, 'Test error 6');
});

router.get('/error-7', (_req: Request, res: Response) => {
  return ApiResponse.error(res, 'Test error 7', 500, {
    message: 'Test error 7',
  });
});

///////////////////////////////////////////////////////////////////////////////

router.get('/error-8', (_req: Request, res: Response) => {
  throw ApiError.BAD_REQUEST('Test error 8');
});

router.get('/error-9', (_req: Request, res: Response) => {
  throw ApiError.UNAUTHORIZED('Test error 9');
});

router.get('/error-10', (_req: Request, res: Response) => {
  throw ApiError.FORBIDDEN('Test error 10');
});

///////////////////////////////////////////////////////////////////////////////

router.get('/error-11', (_req: Request, res: Response) => {
  return ApiError.NOT_FOUND('Test error 11');
});

router.get('/error-12', (_req: Request, res: Response) => {
  return ApiError.CONFLICT('Test error 12');
});

router.get('/error-13', (_req: Request, res: Response) => {
  return ApiError.INTERNAL_SERVER_ERROR('Test error 13');
});

router.get('/error-14', (_req: Request, res: Response) => {
  return ApiError.CUSTOM('Test error 14', 500);
});

router.get('/error-15', (_req: Request, res: Response) => {
  return ApiError.CUSTOM('Test error 15', 500, false, 'TEST_ERROR_15');
});

///////////////////////////////////////////////////////////////////////////////

export { router as testRouter };
