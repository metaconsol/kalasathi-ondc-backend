import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { ApiError } from '../lib/response';

const uploadsRootDir = path.join(process.cwd(), 'public', 'uploads');
const productImagesDir = path.join(uploadsRootDir, 'productImages');

const ensureDir = (dirPath: string) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

ensureDir(uploadsRootDir);
ensureDir(productImagesDir);

const createDiskStorage = (destinationDir: string) =>
  multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, destinationDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, `${uniqueSuffix}-${file.originalname}`);
    },
  });

// Storage configuration
const storage = createDiskStorage(uploadsRootDir);
const productImageStorage = createDiskStorage(productImagesDir);

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
export const upload = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB
  },
  fileFilter,
});
export const productImageUpload = multer({
  storage: productImageStorage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB
  },
  fileFilter,
});

// Memory storage for features that need to process buffers manually (e.g. Sliders)
export const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit for sliders
  },
  fileFilter,
});
