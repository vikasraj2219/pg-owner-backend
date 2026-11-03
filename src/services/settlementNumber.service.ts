import crypto from 'crypto';
import { SettlementStatement } from '../models/SettlementStatement';

/**
 * Generate a unique sequential settlement statement number
 * Format: SET-YYYYMM-XXXX-SEQ (e.g. SET-202611-A1B2-0001)
 */
export const generateSettlementNumber = async (
  organizationId: string,
  date: Date = new Date(),
): Promise<string> => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const monthStr = String(month).padStart(2, '0');

  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

  const count = await SettlementStatement.countDocuments({
    organization: organizationId,
    checkoutDate: { $gte: startOfMonth, $lte: endOfMonth },
  });

  const seq = String(count + 1).padStart(4, '0');
  const entropy = crypto.randomBytes(2).toString('hex').toUpperCase();

  return `SET-${year}${monthStr}-${entropy}-${seq}`;
};
