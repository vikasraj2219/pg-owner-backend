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
exports.Subscription = exports.PLAN_LIMITS = void 0;
const mongoose_1 = __importStar(require("mongoose"));
exports.PLAN_LIMITS = {
    starter: { maxProperties: 1, maxBeds: 30 },
    growth: { maxProperties: 3, maxBeds: 100 },
    pro: { maxProperties: 999, maxBeds: 9999 },
};
const SubscriptionSchema = new mongoose_1.Schema({
    organization: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Organization',
        required: [true, 'Organization ID is required'],
        unique: true,
        index: true,
    },
    plan: {
        type: String,
        enum: ['starter', 'growth', 'pro'],
        default: 'starter',
        required: true,
    },
    status: {
        type: String,
        enum: ['trialing', 'active', 'past_due', 'canceled', 'expired'],
        default: 'trialing',
        required: true,
    },
    trialEndsAt: {
        type: Date,
        required: true,
        default: () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // +14 days
    },
    currentPeriodEnd: {
        type: Date,
        required: true,
        default: () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
    maxProperties: {
        type: Number,
        default: exports.PLAN_LIMITS.starter.maxProperties,
        required: true,
    },
    maxBeds: {
        type: Number,
        default: exports.PLAN_LIMITS.starter.maxBeds,
        required: true,
    },
    razorpayOrderId: {
        type: String,
        default: '',
    },
    razorpayPaymentId: {
        type: String,
        default: '',
    },
    razorpaySignature: {
        type: String,
        default: '',
    },
    lastPaymentAmount: {
        type: Number,
        default: 0,
    },
    lastPaymentDate: {
        type: Date,
    },
}, {
    timestamps: true,
});
exports.Subscription = mongoose_1.default.model('Subscription', SubscriptionSchema);
