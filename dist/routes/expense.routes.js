"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const enforceOrgScope_1 = require("../middleware/enforceOrgScope");
const expense_controller_1 = require("../controllers/expense.controller");
const router = (0, express_1.Router)();
router.use(auth_1.protect);
router.use(enforceOrgScope_1.enforceOrgScope);
// Create expense
router.post('/', expense_controller_1.createExpense);
router.post('/expense', expense_controller_1.createExpense);
// Read expenses & PnL
router.get('/', expense_controller_1.getExpenses);
router.get('/pnl', expense_controller_1.getPnLSummary);
router.get('/monthly', expense_controller_1.getPnLSummary);
router.get('/summary', expense_controller_1.getPnLSummary);
// Update expense
router.put('/expense/:id', expense_controller_1.updateExpense);
router.put('/:id', expense_controller_1.updateExpense);
// Delete expense
router.delete('/expense/:id', expense_controller_1.deleteExpense);
router.delete('/:id', expense_controller_1.deleteExpense);
exports.default = router;
