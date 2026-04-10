import express, { type Application, type Request, type Response, type NextFunction } from 'express';

class SafeExpress {
  private app: Application;

  constructor() {
    this.app = express();
    this.wrapMethods();
  }

  private wrapMethods() {
    const methods = ['get', 'post', 'put', 'delete', 'patch', 'use', 'all'];
    const appMethods = ['get', 'post', 'put', 'delete', 'patch', 'all'];

    // Wrap app methods
    appMethods.forEach((method) => {
      const original = this.app[method as keyof Application];
      this.app[method as keyof Application] = (path: string, ...handlers: Function[]) => {
        const wrapped = handlers.map((h: Function) => SafeExpress.wrapHandler(h));
        return original?.call(this.app, path, ...wrapped);
      };
    });

    // Wrap router methods
    const router = express.Router;
    express.Router = function () {
      const r = router();
      const routerMethods = ['get', 'post', 'put', 'delete', 'patch', 'all'];

      routerMethods.forEach((method) => {
        const original = (r as any)[method as keyof typeof r];
        (r as any)[method as keyof typeof r] = (path: string, ...handlers: Function[]) => {
          const wrapped = handlers.map((h: Function) => SafeExpress.wrapHandler(h));
          return original?.call(r, path, ...wrapped);
        };
      });

      return r;
    } as any;
  }

  private static wrapHandler(handler: Function): Function {
    if (typeof handler !== 'function') return handler;

    // Check if it's an async function
    const isAsync =
      handler.constructor.name === 'AsyncFunction' ||
      handler.toString().includes('return __awaiter');

    if (isAsync) {
      return async (req: Request, res: Response, next: NextFunction) => {
        try {
          await handler(req, res, next);
        } catch (error) {
          next(error);
        }
      };
    }

    return handler;
  }

  getApp(): Application {
    return this.app;
  }
}

export function createSafeApp(): Application {
  return new SafeExpress().getApp();
}
