"use strict";
/**
 * Proration Service for PG Owner Application
 * Strictly operates in whole integer paise.
 * Formula: payablePaise = Math.round(monthlyRentPaise * (T - D + 1) / T)
 * where T = total days in month, D = day of month of joining.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateJoinDateCycle = exports.calculateProratedRent = exports.getDaysInMonth = void 0;
/**
 * Returns total days in a given month (1-indexed month: 1 = Jan, 12 = Dec).
 */
const getDaysInMonth = (year, month) => {
    if (month < 1 || month > 12) {
        throw new Error(`Invalid month: ${month}. Month must be between 1 and 12.`);
    }
    // Passing 0 as day gets the last day of previous month
    return new Date(year, month, 0).getDate();
};
exports.getDaysInMonth = getDaysInMonth;
/**
 * Calculate prorated rent in integer paise for a tenant joining on joinDate.
 */
const calculateProratedRent = (monthlyRentPaise, joinDate) => {
    if (monthlyRentPaise < 0) {
        throw new Error('Monthly rent cannot be negative');
    }
    const year = joinDate.getFullYear();
    const month = joinDate.getMonth() + 1; // 1-12
    const joinDay = joinDate.getDate(); // 1-31
    const totalDays = (0, exports.getDaysInMonth)(year, month);
    const billableDays = totalDays - joinDay + 1;
    if (billableDays <= 0 || joinDay > totalDays) {
        throw new Error(`Invalid join day ${joinDay} for month ${month}/${year}`);
    }
    // If joining on the 1st of the month, full month is payable
    if (joinDay === 1) {
        return {
            monthlyRentPaise,
            payablePaise: monthlyRentPaise,
            totalDays,
            billableDays: totalDays,
            joinDay: 1,
            month,
            year,
            isProrated: false,
        };
    }
    // Round half up to nearest integer paise
    const payablePaise = Math.round((monthlyRentPaise * billableDays) / totalDays);
    return {
        monthlyRentPaise,
        payablePaise,
        totalDays,
        billableDays,
        joinDay,
        month,
        year,
        isProrated: true,
    };
};
exports.calculateProratedRent = calculateProratedRent;
/**
 * Calculates the exact anniversary billing cycle for a tenant based on their joining date.
 * (e.g. 15 Nov to 14 Dec, 1 full month).
 */
const calculateJoinDateCycle = (joinDate, targetMonth, targetYear) => {
    const joinDay = joinDate.getDate();
    const year = targetYear ?? joinDate.getFullYear();
    const month = targetMonth ?? joinDate.getMonth() + 1; // 1-12
    // Handle month length (e.g. day is 31, but Feb only has 28 days)
    const daysInCycleMonth = (0, exports.getDaysInMonth)(year, month);
    const startDay = Math.min(joinDay, daysInCycleMonth);
    const periodStart = new Date(year, month - 1, startDay, 0, 0, 0, 0);
    // Period end is 1 month later minus 1 day
    const nextMonthYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const daysInNextMonth = (0, exports.getDaysInMonth)(nextMonthYear, nextMonth);
    const endDay = Math.min(startDay, daysInNextMonth);
    const periodEnd = new Date(nextMonthYear, nextMonth - 1, endDay, 23, 59, 59, 999);
    periodEnd.setDate(periodEnd.getDate() - 1);
    const formatShort = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const description = `Rent (${formatShort(periodStart)} - ${formatShort(periodEnd)})`;
    return {
        periodStart,
        periodEnd,
        billingDay: startDay,
        month,
        year,
        description,
    };
};
exports.calculateJoinDateCycle = calculateJoinDateCycle;
