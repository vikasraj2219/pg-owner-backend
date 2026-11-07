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
exports.Bed = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const BedSchema = new mongoose_1.Schema({
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
        index: true,
    },
    bedNumber: {
        type: String,
        required: [true, 'Bed number is required'],
        trim: true,
        maxlength: [30, 'Bed number cannot exceed 30 characters'],
    },
    status: {
        type: String,
        enum: {
            values: ['available', 'occupied', 'notice_period', 'maintenance'],
            message: '{VALUE} is not a valid bed status (available, occupied, notice_period, maintenance)',
        },
        default: 'available',
        index: true,
    },
    baseRentPaise: {
        type: Number,
        min: [0, 'Base rent cannot be negative'],
        default: null,
    },
    currentTenant: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Tenant',
        default: null,
    },
    noticeEndDate: {
        type: Date,
        default: null,
    },
    maintenanceNote: {
        type: String,
        trim: true,
        maxlength: [200, 'Maintenance note cannot exceed 200 characters'],
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
// Compound index to guarantee bed numbers are unique per room
BedSchema.index({ room: 1, bedNumber: 1 }, { unique: true });
BedSchema.index({ organization: 1, property: 1, status: 1 });
exports.Bed = mongoose_1.default.models.Bed || mongoose_1.default.model('Bed', BedSchema);
