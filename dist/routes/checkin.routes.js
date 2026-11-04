"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const checkin_controller_1 = require("../controllers/checkin.controller");
const auth_1 = require("../middleware/auth");
const enforceOrgScope_1 = require("../middleware/enforceOrgScope");
const router = (0, express_1.Router)();
// Protect all check-in routes with JWT authentication and organization context
router.use(auth_1.protect);
router.use(enforceOrgScope_1.enforceOrgScope);
router.post('/quick', checkin_controller_1.quickCheckin);
exports.default = router;
