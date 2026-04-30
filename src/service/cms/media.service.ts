import { sqlExec, sqlQuery } from '~/lib/sql';
import { ApiError } from '~/lib/response';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

type FileType = 'IMAGE' | 'PDF' | 'DOC' | 'OTHER';
type StorageProvider = 'LOCAL' | 'S3' | 'CDN';

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
      const publicUrl = `/uploads/productImages/${file.filename}`;

      const id = crypto.randomUUID();
      await sqlExec(
        'INSERT INTO `media_files` (`id`, `file_type`, `original_name`, `mime_type`, `file_size_bytes`, `storage_provider`, `storage_path`, `public_url`, `checksum_sha256`, `uploaded_by`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          fileType,
          file.originalname,
          file.mimetype,
          file.size,
          'LOCAL' as StorageProvider,
          filePath,
          publicUrl,
          checksum,
          uploadedBy ?? null,
        ],
      );
      const rows = await sqlQuery('SELECT * FROM `media_files` WHERE `id` = ? LIMIT 1', [id]);
      const savedMedia = rows[0] ?? null;

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

    const [totalRows, mediaFiles] = await Promise.all([
      sqlQuery<{ total: number }>(
        'SELECT COUNT(*) as total FROM `media_files` WHERE `deleted_at` IS NULL',
      ),
      sqlQuery(
        'SELECT * FROM `media_files` WHERE `deleted_at` IS NULL ORDER BY `created_at` DESC LIMIT ? OFFSET ?',
        [limit, skip],
      ),
    ]);
    const total = Number(totalRows?.[0]?.total ?? 0);

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
   * Delete media by ID (Soft Delete)
   */
  static async deleteMediaFile(id: string) {
    const rows = await sqlQuery(
      'SELECT * FROM `media_files` WHERE `id` = ? AND `deleted_at` IS NULL LIMIT 1',
      [id],
    );
    const mediaFile = rows[0] ?? null;

    if (!mediaFile) {
      throw ApiError.NOT_FOUND('Media file not found');
    }

    // Note: We keep the physical file for Soft Delete.
    // To hard delete and cleanup disk space, we would unlink the file.

    await sqlExec('UPDATE `media_files` SET `deleted_at` = NOW() WHERE `id` = ?', [id]);

    return { success: true, message: 'Media file deleted successfully' };
  }
}
