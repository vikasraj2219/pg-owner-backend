"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateInvoiceNumber = void 0;
const crypto_1 = __importDefault(require("crypto"));
const Invoice_1 = require("../models/Invoice");
/**
 * Generate a unique sequential invoice number
 * Format: INV-YYYYMM-XXXXX (e.g. INV-202611-A1B2C-0001)
 */
const generateInvoiceNumber = async (organizationId, year, month) => {
    const monthStr = String(month).padStart(2, '0');
    const count = await Invoice_1.Invoice.countDocuments({
        organization: organizationId,
        year,
        month,
    });
    const seq = String(count + 1).padStart(4, '0');
    const entropy = crypto_1.default.randomBytes(2).toString('hex').toUpperCase();
    const invoiceNumber = `INV-${year}${monthStr}-${entropy}-${seq}`;
    return invoiceNumber;
};
exports.generateInvoiceNumber = generateInvoiceNumber;
