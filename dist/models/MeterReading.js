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
exports.MeterReading = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const MeterReadingSchema = new mongoose_1.Schema({
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
    room: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Room',
        required: true,
        index: true,
    },
    meterIdentifier: {
        type: String,
        trim: true,
    },
    previousReading: {
        type: Number,
        required: true,
        min: 0,
    },
    currentReading: {
        type: Number,
        required: true,
        min: 0,
    },
    unitsConsumed: {
        type: Number,
        required: true,
        min: 0,
    },
    ratePaisePerUnit: {
        type: Number,
        required: true,
        min: 0,
    },
    totalAmountPaise: {
        type: Number,
        required: true,
        min: 0,
    },
    readingDate: {
        type: Date,
        default: Date.now,
        required: true,
    },
    photoUrl: {
        type: String,
        trim: true,
    },
    splitMethod: {
        type: String,
        enum: ['equal', 'by_days_occupied'],
        default: 'equal',
        required: true,
    },
    tenantSplits: [
        {
            tenant: {
                type: mongoose_1.Schema.Types.ObjectId,
                ref: 'Tenant',
                required: true,
            },
            daysOccupied: {
                type: Number,
                required: true,
                default: 30,
            },
            sharePaise: {
                type: Number,
                required: true,
                min: 0,
            },
        },
    ],
    recordedBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
    },
}, {
    timestamps: true,
});
MeterReadingSchema.index({ organization: 1, room: 1, readingDate: -1 });
exports.MeterReading = mongoose_1.default.model('MeterReading', MeterReadingSchema);
