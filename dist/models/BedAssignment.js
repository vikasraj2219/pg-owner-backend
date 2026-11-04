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
exports.BedAssignment = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const BedAssignmentSchema = new mongoose_1.Schema({
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
    room: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Room',
        required: [true, 'Room ID is required'],
    },
    bed: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Bed',
        required: [true, 'Bed ID is required'],
        index: true,
    },
    tenant: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Tenant',
        required: [true, 'Tenant ID is required'],
        index: true,
    },
    startDate: {
        type: Date,
        required: [true, 'Start date is required'],
        default: Date.now,
    },
    endDate: {
        type: Date,
        default: null,
    },
    status: {
        type: String,
        enum: ['active', 'vacated', 'transferred'],
        default: 'active',
        index: true,
    },
    monthlyRentPaise: {
        type: Number,
        required: [true, 'Monthly rent in paise is required'],
        min: [0, 'Rent cannot be negative'],
    },
    notes: {
        type: String,
        trim: true,
        maxlength: 500,
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
BedAssignmentSchema.index({ organization: 1, tenant: 1, status: 1 });
BedAssignmentSchema.index({ bed: 1, status: 1 });
exports.BedAssignment = mongoose_1.default.models.BedAssignment ||
    mongoose_1.default.model('BedAssignment', BedAssignmentSchema);
