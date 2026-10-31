import { Router } from 'express';
import {
  createProperty,
  getProperties,
  getPropertyById,
  updateProperty,
  deleteProperty,
  createRoom,
  getPropertyRooms,
  updateRoom,
  getPropertyMatrix,
} from '../controllers/property.controller';
import { protect, requireRole } from '../middleware/auth';
import { enforceOrgScope } from '../middleware/enforceOrgScope';

const router = Router();

// All routes require authentication and organization scoping
router.use(protect);
router.use(enforceOrgScope);

// Property CRUD
router.route('/').post(createProperty).get(getProperties);

router
  .route('/:id')
  .get(getPropertyById)
  .put(updateProperty)
  .delete(requireRole('owner'), deleteProperty);

// Visual Bed Matrix endpoint
router.get('/:id/matrix', getPropertyMatrix);

// Rooms and Bed Generation
router.route('/:id/rooms').post(createRoom).get(getPropertyRooms);

router.put('/:id/rooms/:roomId', updateRoom);

export default router;

