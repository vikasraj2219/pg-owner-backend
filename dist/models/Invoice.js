"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Invoice = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const InvoiceItemSchema = new mongoose_1.Schema({
    description: {
        type: String,
        required: [true, 'Item description is required'],
        trim: true,
        maxlength: 200,
    },
    amountPaise: {
        type: Number,
        required: [true, 'Amount in paise is required'],
        min: [0, 'Amount cannot be negative'],
    },
    category: {
        type: String,
        enum: ['rent', 'electricity', 'mess', 'late_fee', 'damage'],
        required: [true, 'Item category is required'],
        default: 'rent',
    },
}, { _id: false });
const InvoiceSchema = new mongoose_1.Schema({
    organization: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Organization',
        required: [true, 'Organization ID is required'],
        index: true,
    },
    property: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Property',
        required: [true, 'Property ID is required'],
        index: true,
    },
    tenant: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Tenant',
        required: [true, 'Tenant ID is required'],
        index: true,
    },
    invoiceNumber: {
        type: String,
        required: [true, 'Invoice number is required'],
        unique: true,
        trim: true,
    },
    month: {
        type: Number,
        required: [true, 'Month is required'],
        min: [1, 'Month must be between 1 and 12'],
        max: [12, 'Month must be between 1 and 12'],
    },
    year: {
        type: Number,
        required: [true, 'Year is required'],
        min: [2020, 'Year must be 2020 or later'],
    },
    dueDate: {
        type: Date,
        required: [true, 'Due date is required'],
    },
    periodStart: {
        type: Date,
        default: null,
    },
    periodEnd: {
        type: Date,
        default: null,
    },
    items: {
        type: [InvoiceItemSchema],
        required: [true, 'Invoice must have at least one line item'],
        validate: [
            (val) => val.length > 0,
            'Invoice must contain at least one line item',
        ],
    },
    totalAmountPaise: {
        type: Number,
        required: true,
        min: [0, 'Total amount cannot be negative'],
    },
    amountPaidPaise: {
        type: Number,
        required: true,
        default: 0,
        min: [0, 'Amount paid cannot be negative'],
    },
    balanceDuePaise: {
        type: Number,
        required: true,
        min: [0, 'Balance due cannot be negative'],
    },
    status: {
        type: String,
        enum: ['unpaid', 'partially_paid', 'paid', 'canceled'],
        default: 'unpaid',
        index: true,
    },
    paidAt: {
        type: Date,
        default: null,
    },
}, {
    timestamps: true,
    toJSON: {
        virtuals: true,
        transform: (_doc, ret) => {
            delete ret.__v;
            return ret;
        },
    },
});
// Compound unique index ensuring idempotent billing (prevent double-invoicing per tenant per month)
InvoiceSchema.index({ tenant: 1, month: 1, year: 1 }, { unique: true });
InvoiceSchema.index({ organization: 1, status: 1, dueDate: 1 });
InvoiceSchema.index({ property: 1, month: 1, year: 1 });
exports.Invoice = mongoose_1.default.models.Invoice || mongoose_1.default.model('Invoice', InvoiceSchema);
