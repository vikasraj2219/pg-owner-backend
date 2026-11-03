import { Router } from 'express';
import { protect } from '../middleware/auth';
import { enforceOrgScope } from '../middleware/enforceOrgScope';
import { recordReading, getReadings, getLatestRoomReading } from '../controllers/meter.controller';

const router = Router();

router.use(protect);
router.use(enforceOrgScope);

router.post('/reading', recordReading);
router.get('/readings', getReadings);
router.get('/room/:roomId/latest', getLatestRoomReading);

export default router;
