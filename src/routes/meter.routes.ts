import { Router } from 'express';
import { protect } from '../middleware/auth';
import { enforceOrgScope } from '../middleware/enforceOrgScope';
import {
  recordReading,
  updateReading,
  deleteReading,
  getReadings,
  getLatestRoomReading,
} from '../controllers/meter.controller';

const router = Router();

router.use(protect);
router.use(enforceOrgScope);

// Record reading (supports /reading, /readings, /)
router.post('/reading', recordReading);
router.post('/readings', recordReading);
router.post('/', recordReading);

// Update reading (supports /reading/:id, /readings/:id, /:id)
router.put('/reading/:id', updateReading);
router.put('/readings/:id', updateReading);
router.put('/:id', updateReading);

// Delete reading (supports /reading/:id, /readings/:id, /:id)
router.delete('/reading/:id', deleteReading);
router.delete('/readings/:id', deleteReading);
router.delete('/:id', deleteReading);

// List readings
router.get('/readings', getReadings);
router.get('/reading', getReadings);
router.get('/', getReadings);

// Latest reading for room
router.get('/room/:roomId/latest', getLatestRoomReading);

export default router;
