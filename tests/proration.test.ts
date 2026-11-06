import {
  calculateProratedRent,
  calculateJoinDateCycle,
  getDaysInMonth,
} from '../src/services/proration.service';

describe('Proration Service (Stage 3 Backend)', () => {
  describe('getDaysInMonth', () => {
    it('returns 31 days for January, March, May, July, August, October, December', () => {
      [1, 3, 5, 7, 8, 10, 12].forEach(month => {
        expect(getDaysInMonth(2026, month)).toBe(31);
      });
    });

    it('returns 30 days for April, June, September, November', () => {
      [4, 6, 9, 11].forEach(month => {
        expect(getDaysInMonth(2026, month)).toBe(30);
      });
    });

    it('returns 28 days for February in a common year (2026)', () => {
      expect(getDaysInMonth(2026, 2)).toBe(28);
    });

    it('returns 29 days for February in a leap year (2024)', () => {
      expect(getDaysInMonth(2024, 2)).toBe(29);
    });

    it('throws error for invalid month values', () => {
      expect(() => getDaysInMonth(2026, 0)).toThrow('Invalid month');
      expect(() => getDaysInMonth(2026, 13)).toThrow('Invalid month');
    });
  });

  describe('calculateProratedRent', () => {
    const monthlyRentPaise = 850000; // ₹8,500.00 in integer paise

    it('TestCase 1: Joining on Day 1 of a 31-day month gives 100% full rent without proration', () => {
      const joinDate = new Date(2026, 0, 1); // Jan 1, 2026
      const result = calculateProratedRent(monthlyRentPaise, joinDate);

      expect(result.isProrated).toBe(false);
      expect(result.payablePaise).toBe(850000);
      expect(result.totalDays).toBe(31);
      expect(result.billableDays).toBe(31);
      expect(result.joinDay).toBe(1);
    });

    it('TestCase 2: Joining on the last day of a 31-day month pays exactly 1 day', () => {
      const joinDate = new Date(2026, 0, 31); // Jan 31, 2026
      const result = calculateProratedRent(monthlyRentPaise, joinDate);

      // 850000 * 1 / 31 = 27419.3548... -> 27419 paise
      expect(result.isProrated).toBe(true);
      expect(result.billableDays).toBe(1);
      expect(result.payablePaise).toBe(27419);
    });

    it('TestCase 3: Joining on Day 15 of a 30-day month (April 15)', () => {
      const joinDate = new Date(2026, 3, 15); // Apr 15, 2026 (30 days total)
      const result = calculateProratedRent(monthlyRentPaise, joinDate);

      // Billable days = 30 - 15 + 1 = 16 days
      // 850000 * 16 / 30 = 453333.333... -> 453333 paise
      expect(result.totalDays).toBe(30);
      expect(result.billableDays).toBe(16);
      expect(result.payablePaise).toBe(453333);
    });

    it('TestCase 4: Joining on Day 1 of a 28-day February gives full rent', () => {
      const joinDate = new Date(2026, 1, 1); // Feb 1, 2026
      const result = calculateProratedRent(monthlyRentPaise, joinDate);

      expect(result.isProrated).toBe(false);
      expect(result.payablePaise).toBe(850000);
      expect(result.totalDays).toBe(28);
    });

    it('TestCase 5: Joining on Day 15 of a 28-day February', () => {
      const joinDate = new Date(2026, 1, 15); // Feb 15, 2026
      const result = calculateProratedRent(monthlyRentPaise, joinDate);

      // Billable days = 28 - 15 + 1 = 14 days (half of February)
      // 850000 * 14 / 28 = exactly 425000 paise
      expect(result.totalDays).toBe(28);
      expect(result.billableDays).toBe(14);
      expect(result.payablePaise).toBe(425000);
    });

    it('TestCase 6: Joining on Day 15 of a 29-day leap year February (2024)', () => {
      const joinDate = new Date(2024, 1, 15); // Feb 15, 2024
      const result = calculateProratedRent(monthlyRentPaise, joinDate);

      // Billable days = 29 - 15 + 1 = 15 days
      // 850000 * 15 / 29 = 439655.1724... -> 439655 paise
      expect(result.totalDays).toBe(29);
      expect(result.billableDays).toBe(15);
      expect(result.payablePaise).toBe(439655);
    });

    it('TestCase 7: Joining on the last day of a 28-day February pays 1 day', () => {
      const joinDate = new Date(2026, 1, 28); // Feb 28, 2026
      const result = calculateProratedRent(monthlyRentPaise, joinDate);

      // 850000 * 1 / 28 = 30357.14... -> 30357 paise
      expect(result.billableDays).toBe(1);
      expect(result.payablePaise).toBe(30357);
    });

    it('TestCase 8: Joining on the last day of a 29-day leap year February pays 1 day', () => {
      const joinDate = new Date(2024, 1, 29); // Feb 29, 2024
      const result = calculateProratedRent(monthlyRentPaise, joinDate);

      // 850000 * 1 / 29 = 29310.34... -> 29310 paise
      expect(result.billableDays).toBe(1);
      expect(result.payablePaise).toBe(29310);
    });

    it('TestCase 9: Round half up verification (rounds .5 up to next integer paise)', () => {
      // Rent of 100 paise over 30 days:
      // For 15 days: 100 * 15 / 30 = 50.0 -> 50 paise
      // For 1 day: 100 * 1 / 30 = 3.333 -> 3 paise
      // Rent of 15 paise for 1 day in 30 day month: 15 * 1 / 30 = 0.5 -> 1 paise
      const joinDate = new Date(2026, 3, 30); // 1 day billable in 30-day month
      const result = calculateProratedRent(15, joinDate);
      expect(result.payablePaise).toBe(1);
    });

    it('TestCase 10: Throws error when monthlyRentPaise is negative', () => {
      const joinDate = new Date(2026, 0, 15);
      expect(() => calculateProratedRent(-5000, joinDate)).toThrow(
        'Monthly rent cannot be negative',
      );
    });
  });

  describe('calculateJoinDateCycle (Anniversary Join-Date Billing)', () => {
    it('generates 1 full month cycle from mid-month join date (15 Nov to 14 Dec)', () => {
      const joinDate = new Date(2026, 10, 15); // Nov 15, 2026
      const cycle = calculateJoinDateCycle(joinDate);

      expect(cycle.billingDay).toBe(15);
      expect(cycle.periodStart.getDate()).toBe(15);
      expect(cycle.periodStart.getMonth()).toBe(10); // Nov
      expect(cycle.periodEnd.getDate()).toBe(14);
      expect(cycle.periodEnd.getMonth()).toBe(11); // Dec
      expect(cycle.month).toBe(11);
      expect(cycle.year).toBe(2026);
      expect(cycle.description).toContain('15 Nov 2026 - 14 Dec 2026');
    });

    it('generates accurate cycle from 1st of month (1 Jan to 31 Jan)', () => {
      const joinDate = new Date(2026, 0, 1); // Jan 1, 2026
      const cycle = calculateJoinDateCycle(joinDate);

      expect(cycle.billingDay).toBe(1);
      expect(cycle.periodStart.getDate()).toBe(1);
      expect(cycle.periodStart.getMonth()).toBe(0); // Jan
      expect(cycle.periodEnd.getDate()).toBe(31);
      expect(cycle.periodEnd.getMonth()).toBe(0); // Jan 31
    });

    it('handles year rollover (15 Dec 2026 to 14 Jan 2027)', () => {
      const joinDate = new Date(2026, 11, 15); // Dec 15, 2026
      const cycle = calculateJoinDateCycle(joinDate);

      expect(cycle.periodStart.getFullYear()).toBe(2026);
      expect(cycle.periodStart.getMonth()).toBe(11); // Dec
      expect(cycle.periodEnd.getFullYear()).toBe(2027);
      expect(cycle.periodEnd.getMonth()).toBe(0); // Jan
      expect(cycle.periodEnd.getDate()).toBe(14);
    });

    it('clamps 31st join date gracefully for shorter months (e.g. Feb in common year)', () => {
      const joinDate = new Date(2026, 0, 31); // Jan 31, 2026
      // Generate cycle for February (month 2)
      const cycle = calculateJoinDateCycle(joinDate, 2, 2026);

      expect(cycle.billingDay).toBe(28); // Clamped to 28 Feb
      expect(cycle.periodStart.getDate()).toBe(28);
      expect(cycle.periodStart.getMonth()).toBe(1); // Feb
    });
  });
});
