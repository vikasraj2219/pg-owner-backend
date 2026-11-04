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
exports.Room = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const RoomSchema = new mongoose_1.Schema({
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
    floorNumber: {
        type: Number,
        required: [true, 'Floor number is required'],
        validate: {
            validator: Number.isInteger,
            message: 'Floor number must be an integer',
        },
    },
    roomNumber: {
        type: String,
        required: [true, 'Room number is required'],
        trim: true,
        maxlength: [20, 'Room number cannot exceed 20 characters'],
    },
    sharingType: {
        type: Number,
        required: [true, 'Sharing type (number of beds) is required'],
        min: [1, 'Sharing type must be at least 1 bed'],
        max: [20, 'Sharing type cannot exceed 20 beds'],
        validate: {
            validator: Number.isInteger,
            message: 'Sharing type must be a whole integer',
        },
    },
    baseRentPaisePerBed: {
        type: Number,
        required: [true, 'Base rent per bed in paise is required'],
        min: [0, 'Base rent per bed cannot be negative'],
        validate: {
            validator: Number.isInteger,
            message: 'Base rent per bed must be specified in whole integer paise',
        },
    },
    tags: {
        type: [String],
        default: [],
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
// Compound index to ensure unique room numbers per property
RoomSchema.index({ property: 1, roomNumber: 1 }, { unique: true });
RoomSchema.index({ organization: 1, property: 1, floorNumber: 1 });
exports.Room = mongoose_1.default.models.Room || mongoose_1.default.model('Room', RoomSchema);
