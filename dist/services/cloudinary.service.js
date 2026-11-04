"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteFromCloudinary = exports.uploadBufferToCloudinary = void 0;
const cloudinary_1 = require("../config/cloudinary");
const errorHandler_1 = require("../middleware/errorHandler");
const env_1 = require("../config/env");
/**
 * Upload a buffer directly to Cloudinary using upload_stream
 */
const uploadBufferToCloudinary = async (buffer, folder, originalFilename) => {
    const isTest = process.env.NODE_ENV === 'test' || env_1.env.NODE_ENV === 'test';
    // If running in test mode without Cloudinary keys, provide deterministic mock
    if (isTest && !(0, cloudinary_1.isCloudinaryConfigured)()) {
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
    if (!(0, cloudinary_1.isCloudinaryConfigured)()) {
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
        const uploadStream = cloudinary_1.cloudinary.uploader.upload_stream({
            folder,
            public_id: cleanOriginalName ? `${cleanOriginalName}_${Date.now()}` : undefined,
            resource_type: 'auto',
            transformation: [{ quality: 'auto:good' }],
        }, (error, result) => {
            if (error || !result) {
                return reject(new errorHandler_1.AppError(`Cloudinary upload failed: ${error?.message || 'Unknown error occurred'}`, 502));
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
        });
        uploadStream.end(buffer);
    });
};
exports.uploadBufferToCloudinary = uploadBufferToCloudinary;
/**
 * Delete a file from Cloudinary by public ID
 */
const deleteFromCloudinary = async (publicId, resourceType = 'image') => {
    const isTest = process.env.NODE_ENV === 'test' || env_1.env.NODE_ENV === 'test';
    if (isTest && !(0, cloudinary_1.isCloudinaryConfigured)()) {
        return true;
    }
    if (!(0, cloudinary_1.isCloudinaryConfigured)()) {
        return false;
    }
    try {
        const result = await cloudinary_1.cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
        return result.result === 'ok' || result.result === 'not found';
    }
    catch (_err) {
        return false;
    }
};
exports.deleteFromCloudinary = deleteFromCloudinary;
