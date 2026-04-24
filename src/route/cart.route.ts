import express from 'express';

import { optionalCartBearerUser, requireCartOwner } from '~/middleware/cart.middleware';
import { authMiddleware } from '~/middleware/auth.middleware';
import {
  addItem,
  checkout,
  clearCart,
  getCart,
  getSummary,
  merge,
  patchItem,
  removeItem,
} from '~/controller/cart.controller';

const router = express.Router();

router.use(optionalCartBearerUser);

/** Auth required: merge guest cart after login. */
router.post('/merge', authMiddleware, merge);

/** Auth required: checkout / payment step (guests must log in first). */
router.post('/checkout', authMiddleware, checkout);

/** Guest or logged-in: standard cart CRUD. */
router.get('/summary', requireCartOwner, getSummary);
router.post('/items', requireCartOwner, addItem);
router.patch('/items/:itemId', requireCartOwner, patchItem);
router.delete('/items/:itemId', requireCartOwner, removeItem);
router.delete('/', requireCartOwner, clearCart);
/** Same payload as `GET /` — common client expectation for listing line items. */
router.get('/items', requireCartOwner, getCart);
router.get('/', requireCartOwner, getCart);

export const cartRouter = router;
