import express from 'express';
import {
  submitBulkOrder,
  listBulkOrders,
  getBulkOrder,
  updateBulkOrderStatus,
  getAttachmentSignedUrl,
} from '~/controller/bulkOrder.controller';
import { upload } from '~/middleware/multer';

const router = express.Router();

router.post('/', upload.single('attachment'), submitBulkOrder);
router.get('/', listBulkOrders);
router.get('/:id/attachment-url', getAttachmentSignedUrl);
router.get('/:id', getBulkOrder);
router.patch('/:id/status', updateBulkOrderStatus);

export default router;
