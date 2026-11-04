import { UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';
import { cloudinary, isCloudinaryConfigured } from '../config/cloudinary';
import { AppError } from '../middleware/errorHandler';
import { env } from '../config/env';

export interface CloudinaryUploadResult {
  url: string;
  secureUrl: string;
  publicId: string;
  format: string;
  bytes: number;
  width?: number;
  height?: number;
  resourceType: string;
}

/**
 * Upload a buffer directly to Cloudinary using upload_stream
 */
export const uploadBufferToCloudinary = async (
  buffer: Buffer,
  folder: string,
  originalFilename?: string,
): Promise<CloudinaryUploadResult> => {
  const isTest = process.env.NODE_ENV === 'test' || env.NODE_ENV === 'test';

  // If running in test mode without Cloudinary keys, provide deterministic mock
  if (isTest && !isCloudinaryConfigured()) {
    const mockPublicId = `${folder}/mock_${Date.now()}`;
    return {
      url: `http://res.cloudinary.com/mock-cloud/image/upload/${mockPublicId}.jpg`,
      secureUrl: `https://res.cloudinary.com/mock-cloud/image/upload/${mockPublicId}.jpg`,
      publicId: mockPublicId,
      format: 'jpg',
      bytes: buffer.length,
      width: 1024,
      height: 768,
      resourceType: 'image',
    };
  }

  if (!isCloudinaryConfigured()) {
    const base64Data = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    const mockPublicId = `${folder}/doc_${Date.now()}`;
    return {
      url: base64Data,
      secureUrl: base64Data,
      publicId: mockPublicId,
      format: 'jpg',
      bytes: buffer.length,
      width: 1024,
      height: 768,
      resourceType: 'image',
    };
  }

  const cleanOriginalName = originalFilename
    ? originalFilename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_')
    : undefined;

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: cleanOriginalName ? `${cleanOriginalName}_${Date.now()}` : undefined,
        resource_type: 'auto',
        transformation: [{ quality: 'auto:good' }],
      },
      (error: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
        if (error || !result) {
          return reject(
            new AppError(
              `Cloudinary upload failed: ${error?.message || 'Unknown error occurred'}`,
              502,
            ),
          );
        }

        resolve({
          url: result.url,
          secureUrl: result.secure_url,
          publicId: result.public_id,
          format: result.format || 'jpg',
          bytes: result.bytes,
          width: result.width,
          height: result.height,
          resourceType: result.resource_type || 'image',
        });
      },
    );

    uploadStream.end(buffer);
  });
};

/**
 * Delete a file from Cloudinary by public ID
 */
export const deleteFromCloudinary = async (
  publicId: string,
  resourceType: 'image' | 'raw' | 'video' = 'image',
): Promise<boolean> => {
  const isTest = process.env.NODE_ENV === 'test' || env.NODE_ENV === 'test';
  if (isTest && !isCloudinaryConfigured()) {
    return true;
  }

  if (!isCloudinaryConfigured()) {
    return false;
  }

  try {
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    return result.result === 'ok' || result.result === 'not found';
  } catch (_err) {
    return false;
  }
};
