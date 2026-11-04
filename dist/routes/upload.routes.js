"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const enforceOrgScope_1 = require("../middleware/enforceOrgScope");
const upload_middleware_1 = require("../middleware/upload.middleware");
const upload_controller_1 = require("../controllers/upload.controller");
const router = (0, express_1.Router)();
// Storage status check
router.get('/status', auth_1.protect, enforceOrgScope_1.enforceOrgScope, upload_controller_1.getUploadStatus);
// Upload KYC document (ID proof photo or PDF) to Cloudinary
router.post('/kyc', auth_1.protect, enforceOrgScope_1.enforceOrgScope, upload_middleware_1.uploadSingleDocument, upload_controller_1.uploadKycDocument);
// Delete uploaded document by public ID
router.delete('/:publicId', auth_1.protect, enforceOrgScope_1.enforceOrgScope, upload_controller_1.deleteDocument);
exports.default = router;
