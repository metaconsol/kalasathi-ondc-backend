import express from 'express';
import {
  submitBulkOrder,
  listBulkOrders,
  getBulkOrder,
  updateBulkOrderStatus,
} from '~/controller/bulkOrder.controller';

const router = express.Router();

router.post('/', submitBulkOrder);
router.get('/', listBulkOrders);
router.get('/:id', getBulkOrder);
router.patch('/:id/status', updateBulkOrderStatus);

export default router;
