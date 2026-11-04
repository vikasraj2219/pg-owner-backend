import { Router } from 'express';
import { protect } from '../middleware/auth';
import { enforceOrgScope } from '../middleware/enforceOrgScope';
import { uploadSingleDocument } from '../middleware/upload.middleware';
import {
  uploadKycDocument,
  getUploadStatus,
  deleteDocument,
} from '../controllers/upload.controller';

const router = Router();

// Storage status check
router.get('/status', protect, enforceOrgScope, getUploadStatus);

// Upload KYC document (ID proof photo or PDF) to Cloudinary
router.post('/kyc', protect, enforceOrgScope, uploadSingleDocument, uploadKycDocument);

// Delete uploaded document by public ID
router.delete('/:publicId', protect, enforceOrgScope, deleteDocument);

export default router;

