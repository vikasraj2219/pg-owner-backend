import { Router } from 'express';
import { protect } from '../middleware/auth';
import { enforceOrgScope } from '../middleware/enforceOrgScope';
import {
  createExpense,
  getExpenses,
  getPnLSummary,
  deleteExpense,
} from '../controllers/expense.controller';

const router = Router();

router.use(protect);
router.use(enforceOrgScope);

router.post('/', createExpense);
router.get('/', getExpenses);
router.get('/pnl', getPnLSummary);
router.delete('/:id', deleteExpense);

export default router;
