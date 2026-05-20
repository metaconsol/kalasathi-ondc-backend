import type { Request, Response } from 'express';
import { ApiResponse } from '~/lib/response';
import { allowedStatuses } from '~/service/bulkOrder.service';
import {
  saveBulkOrder,
  getBulkOrders,
  getBulkOrderById,
  updateBulkOrderStatusById,
  type BulkOrderStatus,
} from '~/service/bulkOrder.service';
import { logger } from '~/lib/logger';
import {
  isS3Enabled,
  putS3Object,
  buildObjectKey,
  resolveS3KeyToUrl,
  getSignedGetUrl,
} from '~/lib/s3';
import { env } from '~/config/env.config';

export async function submitBulkOrder(req: Request, res: Response) {
  try {
    const data = req.body;

    // Basic validation
    if (!data.departmentName || !data.email || !data.mobileNumber || !data.contactPerson) {
      return ApiResponse.error(res, 'Required fields are missing', 400);
    }

    let attachmentUrl = null;
    const file = req.file;

    if (file) {
      if (isS3Enabled()) {
        const key = buildObjectKey('uploads/bulk-orders', file.originalname);
        await putS3Object(key, file.buffer, file.mimetype);
        attachmentUrl = await resolveS3KeyToUrl(key);
      } else {
        attachmentUrl = `/uploads/${file.filename}`;
      }
    }

    await saveBulkOrder({ ...data, attachmentUrl });

    return ApiResponse.success(res, 'Bulk order enquiry submitted successfully');
  } catch (error) {
    logger.error('Error submitting bulk order:', error);
    return ApiResponse.error(res, 'Failed to submit enquiry. Please try again later.');
  }
}

export async function listBulkOrders(_req: Request, res: Response) {
  try {
    const orders = await getBulkOrders();
    return ApiResponse.success(res, 'Bulk order enquiries fetched successfully', orders);
  } catch (error) {
    logger.error('Error fetching bulk orders:', error);
    return ApiResponse.error(res, 'Failed to fetch enquiries.');
  }
}

export async function getBulkOrder(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    const order = await getBulkOrderById(id);

    if (!order) {
      return ApiResponse.error(res, 'Enquiry not found', 404);
    }

    return ApiResponse.success(res, 'Bulk order enquiry fetched successfully', order);
  } catch (error) {
    logger.error('Error fetching bulk order:', error);
    return ApiResponse.error(res, 'Failed to fetch enquiry.');
  }
}

export async function updateBulkOrderStatus(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    const { status } = req.body as { status: BulkOrderStatus };

    if (!allowedStatuses.includes(status)) {
      return ApiResponse.error(res, 'Invalid status value', 400);
    }

    const existing = await getBulkOrderById(id);
    if (!existing) {
      return ApiResponse.error(res, 'Enquiry not found', 404);
    }

    await updateBulkOrderStatusById(id, status);
    return ApiResponse.success(res, 'Status updated successfully', { id, status });
  } catch (error) {
    logger.error('Error updating bulk order status:', error);
    return ApiResponse.error(res, 'Failed to update status.');
  }
}

/**
 * Returns a short-lived pre-signed GET URL for the attachment stored in S3.
 * This avoids requiring the S3 bucket / objects to be publicly readable.
 */
export async function getAttachmentSignedUrl(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    const order = await getBulkOrderById(id);

    if (!order) {
      return ApiResponse.error(res, 'Enquiry not found', 404);
    }

    if (!order.attachment_url) {
      return ApiResponse.error(res, 'No attachment for this enquiry', 404);
    }

    if (!isS3Enabled()) {
      // Local uploads — just return the stored URL as-is
      return ApiResponse.success(res, 'Attachment URL', { url: order.attachment_url });
    }

    // Derive the S3 object key from the stored virtual-host public URL.
    // Stored format: https://<bucket>.s3.<region>.amazonaws.com/<key>
    const stored: string = order.attachment_url;
    const prefix = `https://${env.awsBucketName}.s3.${env.awsRegion}.amazonaws.com/`;
    if (!stored.startsWith(prefix)) {
      // Fallback: just return the URL as-is (e.g. already a signed URL or local path)
      return ApiResponse.success(res, 'Attachment URL', { url: stored });
    }

    const objectKey = decodeURIComponent(stored.slice(prefix.length));
    const signedUrl = await getSignedGetUrl(objectKey, 3600); // 1-hour expiry

    return ApiResponse.success(res, 'Attachment URL', { url: signedUrl });
  } catch (error) {
    logger.error('Error generating attachment signed URL:', error);
    return ApiResponse.error(res, 'Failed to generate attachment URL.');
  }
}
