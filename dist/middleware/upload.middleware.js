"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadSingleDocument = void 0;
const multer_1 = __importDefault(require("multer"));
const errorHandler_1 = require("./errorHandler");
// Use in-memory storage so temporary files are never left on the host disk
const memoryStorage = multer_1.default.memoryStorage();
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit
const ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/jpg',
    'application/pdf',
];
const multerInstance = (0, multer_1.default)({
    storage: memoryStorage,
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: 1,
    },
    fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME_TYPES.includes(file.mimetype.toLowerCase())) {
            cb(null, true);
        }
        else {
            cb(new errorHandler_1.AppError(`Invalid file format (${file.mimetype}). Only JPEG, PNG, WEBP, and PDF files are allowed.`, 400));
        }
    },
});
/**
 * Flexible middleware that accepts a single file upload from any field name ('file', 'idProof', 'document', 'kycPhoto', etc.)
 */
const uploadSingleDocument = (req, res, next) => {
    // If request is JSON, skip multer and let json parser handle req.body
    if (!req.is('multipart/form-data')) {
        return next();
    }
    multerInstance.any()(req, res, (err) => {
        if (err instanceof multer_1.default.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return next(new errorHandler_1.AppError(`File exceeds maximum allowed size of 10 MB`, 400));
            }
            return next(new errorHandler_1.AppError(`File upload error: ${err.message}`, 400));
        }
        else if (err) {
            return next(err);
        }
        // Attach single file to req.file if passed via array
        if (req.files && Array.isArray(req.files) && req.files.length > 0) {
            req.file = req.files[0];
        }
        next();
    });
};
exports.uploadSingleDocument = uploadSingleDocument;
