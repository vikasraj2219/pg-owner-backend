import { Router } from 'express';
import { protect } from '../middleware/auth';
import { enforceOrgScope } from '../middleware/enforceOrgScope';
import {
  createExpense,
  getExpenses,
  getPnLSummary,
  updateExpense,
  deleteExpense,
} from '../controllers/expense.controller';

const router = Router();

router.use(protect);
router.use(enforceOrgScope);

// Create expense
router.post('/', createExpense);
router.post('/expense', createExpense);

// Read expenses & PnL
router.get('/', getExpenses);
router.get('/pnl', getPnLSummary);
router.get('/monthly', getPnLSummary);
router.get('/summary', getPnLSummary);

// Update expense
router.put('/expense/:id', updateExpense);
router.put('/:id', updateExpense);

// Delete expense
router.delete('/expense/:id', deleteExpense);
router.delete('/:id', deleteExpense);

export default router;
