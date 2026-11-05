"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bed_controller_1 = require("../controllers/bed.controller");
const auth_1 = require("../middleware/auth");
const enforceOrgScope_1 = require("../middleware/enforceOrgScope");
const router = (0, express_1.Router)();
// All routes require authentication and organization scoping
router.use(auth_1.protect);
router.use(enforceOrgScope_1.enforceOrgScope);
router.get('/:id', bed_controller_1.getBedById);
router.put('/:id/status', bed_controller_1.updateBedStatus);
router.delete('/:id', bed_controller_1.deleteBed);
exports.default = router;
