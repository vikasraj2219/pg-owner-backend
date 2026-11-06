"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const enforceOrgScope_1 = require("../middleware/enforceOrgScope");
const meter_controller_1 = require("../controllers/meter.controller");
const router = (0, express_1.Router)();
router.use(auth_1.protect);
router.use(enforceOrgScope_1.enforceOrgScope);
// Record reading (supports /reading, /readings, /)
router.post('/reading', meter_controller_1.recordReading);
router.post('/readings', meter_controller_1.recordReading);
router.post('/', meter_controller_1.recordReading);
// Update reading (supports /reading/:id, /readings/:id, /:id)
router.put('/reading/:id', meter_controller_1.updateReading);
router.put('/readings/:id', meter_controller_1.updateReading);
router.put('/:id', meter_controller_1.updateReading);
// Delete reading (supports /reading/:id, /readings/:id, /:id)
router.delete('/reading/:id', meter_controller_1.deleteReading);
router.delete('/readings/:id', meter_controller_1.deleteReading);
router.delete('/:id', meter_controller_1.deleteReading);
// List readings
router.get('/readings', meter_controller_1.getReadings);
router.get('/reading', meter_controller_1.getReadings);
router.get('/', meter_controller_1.getReadings);
// Latest reading for room
router.get('/room/:roomId/latest', meter_controller_1.getLatestRoomReading);
exports.default = router;
