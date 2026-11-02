import crypto from 'crypto';
import { Invoice } from '../models/Invoice';

/**
 * Generate a unique sequential invoice number
 * Format: INV-YYYYMM-XXXXX (e.g. INV-202611-A1B2C-0001)
 */
export const generateInvoiceNumber = async (
  organizationId: string,
  year: number,
  month: number,
): Promise<string> => {
  const monthStr = String(month).padStart(2, '0');
  const count = await Invoice.countDocuments({
    organization: organizationId,
    year,
    month,
  });

  const seq = String(count + 1).padStart(4, '0');
  const entropy = crypto.randomBytes(2).toString('hex').toUpperCase();

  const invoiceNumber = `INV-${year}${monthStr}-${entropy}-${seq}`;
  return invoiceNumber;
};
