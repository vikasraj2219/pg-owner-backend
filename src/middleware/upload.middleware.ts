import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { AppError } from './errorHandler';

// Use in-memory storage so temporary files are never left on the host disk
const memoryStorage = multer.memoryStorage();

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg',
  'application/pdf',
];

const multerInstance = multer({
  storage: memoryStorage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(
        new AppError(
          `Invalid file format (${file.mimetype}). Only JPEG, PNG, WEBP, and PDF files are allowed.`,
          400,
        ),
      );
    }
  },
});

/**
 * Flexible middleware that accepts a single file upload from any field name ('file', 'idProof', 'document', 'kycPhoto', etc.)
 */
export const uploadSingleDocument = (req: Request, res: Response, next: NextFunction): void => {
  multerInstance.any()(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(`File exceeds maximum allowed size of 10 MB`, 400));
      }
      return next(new AppError(`File upload error: ${err.message}`, 400));
    } else if (err) {
      return next(err);
    }

    // Attach single file to req.file if passed via array
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      req.file = req.files[0];
    }

    next();
  });
};

