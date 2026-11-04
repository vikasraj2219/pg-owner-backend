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
exports.SettlementStatement = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const SettlementStatementSchema = new mongoose_1.Schema({
    organization: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Organization',
        required: true,
        index: true,
    },
    property: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Property',
        required: true,
        index: true,
    },
    tenant: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Tenant',
        required: true,
        index: true,
    },
    bed: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Bed',
    },
    room: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Room',
    },
    settlementNumber: {
        type: String,
        required: true,
        unique: true,
        trim: true,
    },
    checkinDate: {
        type: Date,
    },
    checkoutDate: {
        type: Date,
        default: Date.now,
        required: true,
    },
    depositPaidPaise: {
        type: Number,
        required: true,
        min: 0,
    },
    unpaidDuesPaise: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
    },
    damageDeductionsPaise: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
    },
    electricityDeductionsPaise: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
    },
    otherDeductionsPaise: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
    },
    totalDeductionsPaise: {
        type: Number,
        required: true,
        min: 0,
    },
    netRefundPaise: {
        type: Number,
        required: true,
        min: 0,
    },
    paymentMethod: {
        type: String,
        enum: ['cash', 'upi', 'bank_transfer'],
        default: 'cash',
        required: true,
    },
    transactionReference: {
        type: String,
        trim: true,
    },
    notes: {
        type: String,
        trim: true,
    },
    recordedBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
    },
}, {
    timestamps: true,
});
SettlementStatementSchema.index({ organization: 1, property: 1, checkoutDate: -1 });
exports.SettlementStatement = mongoose_1.default.model('SettlementStatement', SettlementStatementSchema);
