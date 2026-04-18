import express from 'express';
import type { Request, Response } from 'express';
import { upload } from '../middleware/multer';
import { MediaService } from '../service/media/media.service';
import { ApiResponse, asyncHandler } from '../lib/response';

const router = express.Router();

/**
 * @route POST /media/upload
 * @desc Upload single or multiple media files
 */
router.post(
  '/upload',
  upload.array('files', 10), // Allow up to 10 files per request
  asyncHandler(async (req: Request, res: Response) => {
    // uploaded files are in req.files
    const files = req.files as Express.Multer.File[];
    const uploadedBy = req.body.uploadedBy ? parseInt(req.body.uploadedBy, 10) : undefined;

    const mediaList = await MediaService.uploadMediaFiles(files, uploadedBy);
    return ApiResponse.created(res, 'Files uploaded successfully', mediaList);
  }),
);

/**
 * @route GET /media
 * @desc Get all media files with pagination
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 10;

    const { mediaFiles, meta } = await MediaService.getMediaFiles(page, limit);
    return ApiResponse.success(res, 'Media files retrieved successfully', mediaFiles, meta);
  }),
);

/**
 * @route DELETE /media/:id
 * @desc Delete a media file by ID
 */
router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const result = await MediaService.deleteMediaFile(id);
    return ApiResponse.success(res, result.message);
  }),
);

export const mediaRouter = router;
