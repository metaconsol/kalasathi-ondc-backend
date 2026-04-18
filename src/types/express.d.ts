import * as express from 'express';

import type { UserPayloadDAO } from '~/service/auth/auth.types';

declare global {
  namespace Express {
    interface Request {
      user?: UserPayloadDAO;
    }
  }
}
