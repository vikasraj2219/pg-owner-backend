"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSettlementNumber = void 0;
const crypto_1 = __importDefault(require("crypto"));
const SettlementStatement_1 = require("../models/SettlementStatement");
/**
 * Generate a unique sequential settlement statement number
 * Format: SET-YYYYMM-XXXX-SEQ (e.g. SET-202611-A1B2-0001)
 */
const generateSettlementNumber = async (organizationId, date = new Date()) => {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const monthStr = String(month).padStart(2, '0');
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);
    const count = await SettlementStatement_1.SettlementStatement.countDocuments({
        organization: organizationId,
        checkoutDate: { $gte: startOfMonth, $lte: endOfMonth },
    });
    const seq = String(count + 1).padStart(4, '0');
    const entropy = crypto_1.default.randomBytes(2).toString('hex').toUpperCase();
    return `SET-${year}${monthStr}-${entropy}-${seq}`;
};
exports.generateSettlementNumber = generateSettlementNumber;
