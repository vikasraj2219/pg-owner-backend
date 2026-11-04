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
exports.Tenant = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const TenantSchema = new mongoose_1.Schema({
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
    currentBed: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Bed',
        default: null,
    },
    fullName: {
        type: String,
        required: [true, 'Tenant full name is required'],
        trim: true,
        maxlength: 100,
    },
    phone: {
        type: String,
        required: [true, 'Tenant phone number is required'],
        trim: true,
    },
    emergencyPhone: {
        type: String,
        trim: true,
    },
    email: {
        type: String,
        trim: true,
        lowercase: true,
    },
    monthlyRentPaise: {
        type: Number,
        required: true,
        min: 0,
    },
    depositPaise: {
        type: Number,
        required: true,
        min: 0,
    },
    depositPaidPaise: {
        type: Number,
        default: 0,
        min: 0,
    },
    kycDocType: {
        type: String,
        enum: ['aadhaar', 'pan', 'passport', 'voter_id'],
    },
    kycMaskedNumber: {
        type: String,
        trim: true,
    },
    kycDocUrl: {
        type: String,
        trim: true,
    },
    kycConsent: {
        type: Boolean,
        default: false,
    },
    status: {
        type: String,
        enum: ['active', 'notice_period', 'checked_out'],
        default: 'active',
        index: true,
    },
    isDeleted: {
        type: Boolean,
        default: false,
        index: true,
    },
    deletedAt: {
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
TenantSchema.index({ organization: 1, phone: 1 });
exports.Tenant = mongoose_1.default.models.Tenant || mongoose_1.default.model('Tenant', TenantSchema);
