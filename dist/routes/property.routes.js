"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const property_controller_1 = require("../controllers/property.controller");
const auth_1 = require("../middleware/auth");
const enforceOrgScope_1 = require("../middleware/enforceOrgScope");
const router = (0, express_1.Router)();
// All routes require authentication and organization scoping
router.use(auth_1.protect);
router.use(enforceOrgScope_1.enforceOrgScope);
// Property CRUD
router.route('/').post(property_controller_1.createProperty).get(property_controller_1.getProperties);
router
    .route('/:id')
    .get(property_controller_1.getPropertyById)
    .put(property_controller_1.updateProperty)
    .delete((0, auth_1.requireRole)('owner'), property_controller_1.deleteProperty);
// Visual Bed Matrix endpoint
router.get('/:id/matrix', property_controller_1.getPropertyMatrix);
// Rooms and Bed Generation
router.route('/:id/rooms').post(property_controller_1.createRoom).get(property_controller_1.getPropertyRooms);
router.put('/:id/rooms/:roomId', property_controller_1.updateRoom);
router.delete('/:id/rooms/:roomId', property_controller_1.deleteRoom);
router.post('/:id/rooms/:roomId/beds', property_controller_1.addBedToRoom);
exports.default = router;
