"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteExpense = exports.updateExpense = exports.getPnLSummary = exports.getExpenses = exports.createExpense = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const errorHandler_1 = require("../middleware/errorHandler");
const models_1 = require("../models");
const expense_validator_1 = require("../validators/expense.validator");
/**
 * Record a new operational expense in integer paise
 * POST /api/expenses
 */
const createExpense = async (req, res, next) => {
    try {
        const orgId = req.orgId;
        const userId = req.user?.id;
        const validated = expense_validator_1.createExpenseSchema.parse(req.body);
        const { propertyId, category, amountPaise, description, date, receiptUrl, paymentMethod, paidTo, } = validated;
        if (propertyId) {
            const property = await models_1.Property.findOne({ _id: propertyId, organization: orgId });
            if (!property) {
                throw new errorHandler_1.AppError('Property not found or does not belong to your organization', 404);
            }
        }
        const expense = await models_1.Expense.create({
            organization: orgId,
            property: propertyId ? new mongoose_1.default.Types.ObjectId(propertyId) : undefined,
            category,
            amountPaise,
            description,
            date: date ? new Date(date) : new Date(),
            receiptUrl,
            paymentMethod,
            paidTo,
            recordedBy: userId ? new mongoose_1.default.Types.ObjectId(userId) : undefined,
        });
        res.status(201).json({
            success: true,
            message: 'Expense recorded successfully',
            data: expense,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.createExpense = createExpense;
/**
 * List expenses with category, property, and date filters
 * GET /api/expenses
 */
const getExpenses = async (req, res, next) => {
    try {
        const orgId = req.orgId;
        const { propertyId, category, startDate, endDate } = req.query;
        const query = { organization: orgId };
        if (propertyId &&
            typeof propertyId === 'string' &&
            mongoose_1.default.Types.ObjectId.isValid(propertyId)) {
            query.property = propertyId;
        }
        if (category && typeof category === 'string') {
            query.category = category;
        }
        if (startDate || endDate) {
            const dateFilter = {};
            if (startDate)
                dateFilter.$gte = new Date(startDate);
            if (endDate)
                dateFilter.$lte = new Date(endDate);
            query.date = dateFilter;
        }
        const expenses = await models_1.Expense.find(query)
            .populate('property', 'name code')
            .populate('recordedBy', 'name')
            .sort({ date: -1 });
        const totalExpensesPaise = expenses.reduce((sum, exp) => sum + exp.amountPaise, 0);
        res.status(200).json({
            success: true,
            data: {
                expenses,
                count: expenses.length,
                totalExpensesPaise,
            },
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getExpenses = getExpenses;
/**
 * Live Profit & Loss (P&L) calculation: Collections - Expenses = Net Cashflow
 * GET /api/expenses/pnl
 */
const getPnLSummary = async (req, res, next) => {
    try {
        const orgId = req.orgId;
        const { propertyId, month, year } = req.query;
        const now = new Date();
        const queryYear = year ? parseInt(year, 10) : now.getFullYear();
        const queryMonth = month ? parseInt(month, 10) : now.getMonth() + 1;
        const startOfMonth = new Date(queryYear, queryMonth - 1, 1);
        const endOfMonth = new Date(queryYear, queryMonth, 0, 23, 59, 59, 999);
        const paymentQuery = {
            organization: orgId,
            paymentDate: { $gte: startOfMonth, $lte: endOfMonth },
        };
        const expenseQuery = {
            organization: orgId,
            date: { $gte: startOfMonth, $lte: endOfMonth },
        };
        if (propertyId &&
            typeof propertyId === 'string' &&
            mongoose_1.default.Types.ObjectId.isValid(propertyId)) {
            paymentQuery.property = propertyId;
            expenseQuery.property = propertyId;
        }
        // 1. Total Collections from Payments
        const payments = await models_1.Payment.find(paymentQuery);
        const collectionsPaise = payments.reduce((sum, p) => sum + p.amountPaidPaise, 0);
        // 2. Total Expenses
        const expenses = await models_1.Expense.find(expenseQuery);
        const expensesPaise = expenses.reduce((sum, exp) => sum + exp.amountPaise, 0);
        // 3. Net Cashflow (P&L)
        const netCashflowPaise = collectionsPaise - expensesPaise;
        // 4. Category breakdown
        const categoryTotals = {};
        expenses.forEach(exp => {
            categoryTotals[exp.category] = (categoryTotals[exp.category] || 0) + exp.amountPaise;
        });
        const categoryBreakdown = Object.entries(categoryTotals).map(([category, amountPaise]) => ({
            category,
            amountPaise,
            percentage: expensesPaise > 0 ? Math.round((amountPaise / expensesPaise) * 100) : 0,
        }));
        res.status(200).json({
            success: true,
            data: {
                period: {
                    month: queryMonth,
                    year: queryYear,
                    start: startOfMonth,
                    end: endOfMonth,
                },
                collectionsPaise,
                expensesPaise,
                netCashflowPaise,
                profitMarginRate: collectionsPaise > 0 ? Number((netCashflowPaise / collectionsPaise).toFixed(4)) : 0,
                categoryBreakdown,
                totalExpensesCount: expenses.length,
                totalPaymentsCount: payments.length,
            },
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getPnLSummary = getPnLSummary;
/**
 * Update an existing expense
 * PUT /api/expenses/:id
 */
const updateExpense = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid expense ID format', 400);
        }
        const expense = await models_1.Expense.findOne({ _id: id, organization: orgId });
        if (!expense) {
            throw new errorHandler_1.AppError('Expense not found or does not belong to your organization', 404);
        }
        const validated = expense_validator_1.updateExpenseSchema.parse(req.body);
        if (validated.propertyId !== undefined) {
            if (validated.propertyId) {
                const prop = await models_1.Property.findOne({ _id: validated.propertyId, organization: orgId });
                if (!prop) {
                    throw new errorHandler_1.AppError('Property not found or does not belong to your organization', 404);
                }
                expense.property = new mongoose_1.default.Types.ObjectId(validated.propertyId);
            }
            else {
                expense.property = undefined;
            }
        }
        if (validated.category !== undefined)
            expense.category = validated.category;
        if (validated.amountPaise !== undefined)
            expense.amountPaise = validated.amountPaise;
        if (validated.description !== undefined)
            expense.description = validated.description;
        if (validated.date !== undefined)
            expense.date = new Date(validated.date);
        if (validated.paymentMethod !== undefined)
            expense.paymentMethod = validated.paymentMethod;
        if (validated.paidTo !== undefined)
            expense.paidTo = validated.paidTo.trim() || undefined;
        if (validated.receiptUrl !== undefined)
            expense.receiptUrl = validated.receiptUrl;
        await expense.save();
        res.status(200).json({
            success: true,
            message: 'Expense updated successfully',
            data: expense,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.updateExpense = updateExpense;
/**
 * Delete single expense
 * DELETE /api/expenses/:id
 */
const deleteExpense = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid expense ID format', 400);
        }
        const expense = await models_1.Expense.findOneAndDelete({ _id: id, organization: orgId });
        if (!expense) {
            throw new errorHandler_1.AppError('Expense not found or does not belong to your organization', 404);
        }
        res.status(200).json({
            success: true,
            message: 'Expense deleted successfully',
        });
    }
    catch (error) {
        next(error);
    }
};
exports.deleteExpense = deleteExpense;
