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
exports.Property = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const PropertySchema = new mongoose_1.Schema({
    organization: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Organization',
        required: [true, 'Organization ID is required'],
        index: true,
    },
    name: {
        type: String,
        required: [true, 'Property name is required'],
        trim: true,
        maxlength: [100, 'Property name cannot exceed 100 characters'],
    },
    type: {
        type: String,
        enum: {
            values: ['boys', 'girls', 'coliving'],
            message: '{VALUE} is not a valid property type (boys, girls, coliving)',
        },
        required: [true, 'Property type is required'],
    },
    address: {
        type: String,
        trim: true,
        maxlength: [250, 'Address cannot exceed 250 characters'],
    },
    city: {
        type: String,
        trim: true,
        maxlength: [100, 'City cannot exceed 100 characters'],
    },
    pincode: {
        type: String,
        trim: true,
        maxlength: [20, 'Pincode cannot exceed 20 characters'],
    },
    upiVpa: {
        type: String,
        required: [true, 'UPI VPA is required for rent collection'],
        trim: true,
        lowercase: true,
    },
    electricityRatePaisePerUnit: {
        type: Number,
        required: [true, 'Electricity rate per unit in paise is required'],
        min: [0, 'Electricity rate per unit cannot be negative'],
        validate: {
            validator: Number.isInteger,
            message: 'Electricity rate must be specified in whole integer paise',
        },
        default: 0, // ₹0 per unit
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    isArchived: {
        type: Boolean,
        default: false,
    },
    floors: [
        {
            floorNumber: {
                type: Number,
                required: true,
            },
            floorLabel: {
                type: String,
                trim: true,
                maxlength: [50, 'Floor label cannot exceed 50 characters'],
            },
        },
    ],
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
// Compound index to guarantee property names are unique per organization
PropertySchema.index({ organization: 1, name: 1 }, { unique: true });
exports.Property = mongoose_1.default.models.Property || mongoose_1.default.model('Property', PropertySchema);
