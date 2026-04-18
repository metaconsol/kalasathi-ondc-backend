import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { ApiError } from '../lib/response';

// Ensure uploads directory exists
const uploadDir = path.join(process.cwd(), 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});

// File filter (validate file type)
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      ApiError.BAD_REQUEST(
        'Invalid file type. Only images, PDF, and Word documents are allowed.',
      ) as any,
      false,
    );
  }
};

// Middleware setup — disk storage with type validation for the media feature.
// Limit is set to 15MB to accommodate larger files (images, PDFs, docs).
export const upload = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB
  },
  fileFilter,
});
