"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateReceiptNumber = void 0;
const crypto_1 = __importDefault(require("crypto"));
const Payment_1 = require("../models/Payment");
/**
 * Generate a unique sequential receipt number
 * Format: RCP-YYYYMM-XXXX (e.g. RCP-202611-A1B2-0001)
 */
const generateReceiptNumber = async (organizationId, date = new Date()) => {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const monthStr = String(month).padStart(2, '0');
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);
    const count = await Payment_1.Payment.countDocuments({
        organization: organizationId,
        paymentDate: { $gte: startOfMonth, $lte: endOfMonth },
    });
    const seq = String(count + 1).padStart(4, '0');
    const entropy = crypto_1.default.randomBytes(2).toString('hex').toUpperCase();
    return `RCP-${year}${monthStr}-${entropy}-${seq}`;
};
exports.generateReceiptNumber = generateReceiptNumber;
