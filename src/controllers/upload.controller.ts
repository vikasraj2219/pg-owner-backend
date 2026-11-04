import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { uploadBufferToCloudinary, deleteFromCloudinary } from '../services/cloudinary.service';
import { isCloudinaryConfigured } from '../config/cloudinary';

/**
 * Upload tenant KYC ID proof or document to Cloudinary
 * POST /api/uploads/kyc
 */
export const uploadKycDocument = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.file) {
      throw new AppError('No file uploaded. Please attach a file (JPEG, PNG, WEBP, or PDF).', 400);
    }

    const orgId = req.orgId ? req.orgId.toString() : 'general';
    const folder = `pg-owner/${orgId}/kyc`;

    const result = await uploadBufferToCloudinary(req.file.buffer, folder, req.file.originalname);

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
  } catch (err) {
    next(err);
  }
};

/**
 * Check Cloudinary storage service status
 * GET /api/uploads/status
 */
export const getUploadStatus = async (
  _req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const configured = isCloudinaryConfigured();
    res.status(200).json({
      success: true,
      data: {
        isConfigured: configured,
        provider: 'cloudinary',
        maxFileSizeMb: 10,
        allowedFormats: ['jpeg', 'png', 'webp', 'pdf'],
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete a document from Cloudinary by public ID
 * DELETE /api/uploads/:publicId
 */
export const deleteDocument = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { publicId } = req.params;
    if (!publicId) {
      throw new AppError('Public ID is required for deletion', 400);
    }

    const orgId = req.orgId ? req.orgId.toString() : '';
    // Prevent deleting files outside of organization folder
    if (orgId && !publicId.startsWith(`pg-owner/${orgId}/`)) {
      throw new AppError('Unauthorized: You cannot delete files from another organization', 403);
    }

    const success = await deleteFromCloudinary(publicId);

    res.status(200).json({
      success,
      message: success
        ? 'Document deleted from Cloudinary'
        : 'Document deletion failed or not found',
    });
  } catch (err) {
    next(err);
  }
};
