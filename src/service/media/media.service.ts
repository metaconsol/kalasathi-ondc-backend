import { db } from '../../lib/db';
import { ApiError } from '../../lib/response';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import type { FileType, StorageProvider } from '@prisma/client';

export class MediaService {
  /**
   * Helper to determine FileType based on mime type
   */
  private static determineFileType(mimeType: string): FileType {
    if (mimeType.startsWith('image/')) return 'IMAGE';
    if (mimeType === 'application/pdf') return 'PDF';
    if (
      mimeType === 'application/msword' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
      return 'DOC';
    return 'OTHER';
  }

  /**
   * Generate SHA-256 Checksum for a file
   */
  private static generateChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('error', (err) => reject(err));
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  /**
   * Upload and process a single file or multiple files
   */
  static async uploadMediaFiles(files: Express.Multer.File[], uploadedBy?: number) {
    if (!files || files.length === 0) {
      throw ApiError.BAD_REQUEST('No files provided');
    }

    const uploadedMedia = [];

    for (const file of files) {
      const filePath = path.join(file.destination, file.filename);
      const checksum = await this.generateChecksum(filePath);

      const fileType = this.determineFileType(file.mimetype);
      const publicUrl = `/uploads/${file.filename}`;

      const savedMedia = await db.mediaFile.create({
        data: {
          fileType,
          originalName: file.originalname,
          mimeType: file.mimetype,
          fileSizeBytes: file.size,
          storageProvider: 'LOCAL' as StorageProvider,
          storagePath: filePath,
          publicUrl,
          checksumSha256: checksum,
          uploadedBy: uploadedBy ?? null,
        },
      });

      uploadedMedia.push(savedMedia);
    }

    return uploadedMedia;
  }

  /**
   * Get all media with pagination
   */
  static async getMediaFiles(page: number = 1, limit: number = 10) {
    if (page < 1) page = 1;
    if (limit < 1) limit = 10;

    const skip = (page - 1) * limit;

    const [total, mediaFiles] = await Promise.all([
      db.mediaFile.count(),
      db.mediaFile.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      mediaFiles,
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  /**
   * Delete media by ID
   */
  static async deleteMediaFile(id: string) {
    const mediaFile = await db.mediaFile.findUnique({ where: { id } });
    if (!mediaFile) {
      throw ApiError.NOT_FOUND('Media file not found');
    }

    // Remove from local filesystem if it exists
    if (mediaFile.storageProvider === 'LOCAL' && mediaFile.storagePath) {
      if (fs.existsSync(mediaFile.storagePath)) {
        try {
          fs.unlinkSync(mediaFile.storagePath);
        } catch (err) {
          console.error(`Failed to delete file at ${mediaFile.storagePath}:`, err);
        }
      }
    }

    // Remove record from database
    await db.mediaFile.delete({ where: { id } });

    return { success: true, message: 'Media file deleted successfully' };
  }
}
