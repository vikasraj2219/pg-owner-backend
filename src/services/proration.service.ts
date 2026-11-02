/**
 * Proration Service for PG Owner Application
 * Strictly operates in whole integer paise.
 * Formula: payablePaise = Math.round(monthlyRentPaise * (T - D + 1) / T)
 * where T = total days in month, D = day of month of joining.
 */

/**
 * Returns total days in a given month (1-indexed month: 1 = Jan, 12 = Dec).
 */
export const getDaysInMonth = (year: number, month: number): number => {
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month: ${month}. Month must be between 1 and 12.`);
  }
  // Passing 0 as day gets the last day of previous month
  return new Date(year, month, 0).getDate();
};

export interface ProrationResult {
  monthlyRentPaise: number;
  payablePaise: number;
  totalDays: number;
  billableDays: number;
  joinDay: number;
  month: number;
  year: number;
  isProrated: boolean;
}

/**
 * Calculate prorated rent in integer paise for a tenant joining on joinDate.
 */
export const calculateProratedRent = (
  monthlyRentPaise: number,
  joinDate: Date,
): ProrationResult => {
  if (monthlyRentPaise < 0) {
    throw new Error('Monthly rent cannot be negative');
  }

  const year = joinDate.getFullYear();
  const month = joinDate.getMonth() + 1; // 1-12
  const joinDay = joinDate.getDate(); // 1-31

  const totalDays = getDaysInMonth(year, month);
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
