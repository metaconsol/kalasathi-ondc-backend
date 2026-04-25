import { Router } from 'express';
import * as orderController from '~/controller/order.controller';
import { authMiddleware } from '~/middleware/auth.middleware';

const orderRouter = Router();

// Order routes (Buyer)
// Explicitly requiring authMiddleware for all buyer methods

orderRouter.post('/', authMiddleware, orderController.createOrder);
orderRouter.get('/', authMiddleware, orderController.listOrders);
orderRouter.get('/:id', authMiddleware, orderController.getOrderDetails);
orderRouter.patch('/:id/cancel', authMiddleware, orderController.cancelOrder);
orderRouter.get('/:id/tracking', authMiddleware, orderController.orderTracking);
orderRouter.get('/:id/returns', authMiddleware, orderController.listReturns);
orderRouter.post('/:id/returns', authMiddleware, orderController.requestReturn);

export { orderRouter };
