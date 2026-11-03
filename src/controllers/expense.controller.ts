import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { AuthenticatedRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { Expense, Payment, Property } from '../models';
import { createExpenseSchema } from '../validators/expense.validator';

/**
 * Record a new operational expense in integer paise
 * POST /api/expenses
 */
export const createExpense = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const orgId = req.orgId;
    const userId = req.user?.id;

    const validated = createExpenseSchema.parse(req.body);
    const {
      propertyId,
      category,
      amountPaise,
      description,
      date,
      receiptUrl,
      paymentMethod,
      paidTo,
    } = validated;

    if (propertyId) {
      const property = await Property.findOne({ _id: propertyId, organization: orgId });
      if (!property) {
        throw new AppError('Property not found or does not belong to your organization', 404);
      }
    }

    const expense = await Expense.create({
      organization: orgId,
      property: propertyId ? new mongoose.Types.ObjectId(propertyId) : undefined,
      category,
      amountPaise,
      description,
      date: date ? new Date(date) : new Date(),
      receiptUrl,
      paymentMethod,
      paidTo,
      recordedBy: userId ? new mongoose.Types.ObjectId(userId) : undefined,
    });

    res.status(201).json({
      success: true,
      message: 'Expense recorded successfully',
      data: expense,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List expenses with category, property, and date filters
 * GET /api/expenses
 */
export const getExpenses = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const orgId = req.orgId;
    const { propertyId, category, startDate, endDate } = req.query;

    const query: Record<string, unknown> = { organization: orgId };

    if (
      propertyId &&
      typeof propertyId === 'string' &&
      mongoose.Types.ObjectId.isValid(propertyId)
    ) {
      query.property = propertyId;
    }
    if (category && typeof category === 'string') {
      query.category = category;
    }
    if (startDate || endDate) {
      const dateFilter: Record<string, unknown> = {};
      if (startDate) dateFilter.$gte = new Date(startDate as string);
      if (endDate) dateFilter.$lte = new Date(endDate as string);
      query.date = dateFilter;
    }

    const expenses = await Expense.find(query)
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
  } catch (error) {
    next(error);
  }
};

/**
 * Live Profit & Loss (P&L) calculation: Collections - Expenses = Net Cashflow
 * GET /api/expenses/pnl
 */
export const getPnLSummary = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const orgId = req.orgId;
    const { propertyId, month, year } = req.query;

    const now = new Date();
    const queryYear = year ? parseInt(year as string, 10) : now.getFullYear();
    const queryMonth = month ? parseInt(month as string, 10) : now.getMonth() + 1;

    const startOfMonth = new Date(queryYear, queryMonth - 1, 1);
    const endOfMonth = new Date(queryYear, queryMonth, 0, 23, 59, 59, 999);

    const paymentQuery: Record<string, unknown> = {
      organization: orgId,
      paymentDate: { $gte: startOfMonth, $lte: endOfMonth },
    };

    const expenseQuery: Record<string, unknown> = {
      organization: orgId,
      date: { $gte: startOfMonth, $lte: endOfMonth },
    };

    if (
      propertyId &&
      typeof propertyId === 'string' &&
      mongoose.Types.ObjectId.isValid(propertyId)
    ) {
      paymentQuery.property = propertyId;
      expenseQuery.property = propertyId;
    }

    // 1. Total Collections from Payments
    const payments = await Payment.find(paymentQuery);
    const collectionsPaise = payments.reduce((sum, p) => sum + p.amountPaidPaise, 0);

    // 2. Total Expenses
    const expenses = await Expense.find(expenseQuery);
    const expensesPaise = expenses.reduce((sum, exp) => sum + exp.amountPaise, 0);

    // 3. Net Cashflow (P&L)
    const netCashflowPaise = collectionsPaise - expensesPaise;

    // 4. Category breakdown
    const categoryTotals: Record<string, number> = {};
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
        profitMarginRate:
          collectionsPaise > 0 ? Number((netCashflowPaise / collectionsPaise).toFixed(4)) : 0,
        categoryBreakdown,
        totalExpensesCount: expenses.length,
        totalPaymentsCount: payments.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete single expense
 * DELETE /api/expenses/:id
 */
export const deleteExpense = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid expense ID format', 400);
    }

    const expense = await Expense.findOneAndDelete({ _id: id, organization: orgId });
    if (!expense) {
      throw new AppError('Expense not found or does not belong to your organization', 404);
    }

    res.status(200).json({
      success: true,
      message: 'Expense deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
