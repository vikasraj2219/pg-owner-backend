"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteDocument = exports.getUploadStatus = exports.uploadKycDocument = void 0;
const errorHandler_1 = require("../middleware/errorHandler");
const cloudinary_service_1 = require("../services/cloudinary.service");
const cloudinary_1 = require("../config/cloudinary");
/**
 * Upload tenant KYC ID proof or document to Cloudinary
 * POST /api/uploads/kyc
 */
const uploadKycDocument = async (req, res, next) => {
    try {
        if (!req.file) {
            throw new errorHandler_1.AppError('No file uploaded. Please attach a file (JPEG, PNG, WEBP, or PDF).', 400);
        }
        const orgId = req.orgId ? req.orgId.toString() : 'general';
        const folder = `pg-owner/${orgId}/kyc`;
        const result = await (0, cloudinary_service_1.uploadBufferToCloudinary)(req.file.buffer, folder, req.file.originalname);
        res.status(201).json({
            success: true,
            message: 'KYC document uploaded successfully to Cloudinary',
            data: {
                url: result.secureUrl,
                secureUrl: result.secureUrl,
                publicId: result.publicId,
                format: result.format,
                bytes: result.bytes,
                width: result.width,
                height: result.height,
                resourceType: result.resourceType,
                originalName: req.file.originalname,
            },
        });
    }
    catch (err) {
        next(err);
    }
};
exports.uploadKycDocument = uploadKycDocument;
/**
 * Check Cloudinary storage service status
 * GET /api/uploads/status
 */
const getUploadStatus = async (_req, res, next) => {
    try {
        const configured = (0, cloudinary_1.isCloudinaryConfigured)();
        res.status(200).json({
            success: true,
            data: {
                isConfigured: configured,
                provider: 'cloudinary',
                maxFileSizeMb: 10,
                allowedFormats: ['jpeg', 'png', 'webp', 'pdf'],
            },
        });
    }
    catch (err) {
        next(err);
    }
};
exports.getUploadStatus = getUploadStatus;
/**
 * Delete a document from Cloudinary by public ID
 * DELETE /api/uploads/:publicId
 */
const deleteDocument = async (req, res, next) => {
    try {
        const { publicId } = req.params;
        if (!publicId) {
            throw new errorHandler_1.AppError('Public ID is required for deletion', 400);
        }
        const orgId = req.orgId ? req.orgId.toString() : '';
        // Prevent deleting files outside of organization folder
        if (orgId && !publicId.startsWith(`pg-owner/${orgId}/`)) {
            throw new errorHandler_1.AppError('Unauthorized: You cannot delete files from another organization', 403);
        }
        const success = await (0, cloudinary_service_1.deleteFromCloudinary)(publicId);
        res.status(200).json({
            success,
            message: success
                ? 'Document deleted from Cloudinary'
                : 'Document deletion failed or not found',
        });
    }
    catch (err) {
        next(err);
    }
};
exports.deleteDocument = deleteDocument;
