import type { Request, Response } from 'express';
import { MediaService } from '~/service/cms/media.service';
import { ApiResponse } from '~/lib/response';

/**
 * Controller for Media handling within CMS.
 */

export const uploadMedia = async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];
  const uploadedBy = req.body.uploadedBy ? parseInt(req.body.uploadedBy, 10) : undefined;

  const mediaList = await MediaService.uploadMediaFiles(files, uploadedBy);
  return ApiResponse.created(res, 'Files uploaded successfully', mediaList);
};

export const getMediaFiles = async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = parseInt(req.query.limit as string, 10) || 10;

  const { mediaFiles, meta } = await MediaService.getMediaFiles(page, limit);
  return ApiResponse.success(res, 'Media files retrieved successfully', mediaFiles, meta);
};

export const deleteMediaFile = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await MediaService.deleteMediaFile(id);
  return ApiResponse.success(res, result.message);
};
