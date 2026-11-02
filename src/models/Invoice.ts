import mongoose, { Document, Schema, Model } from 'mongoose';

export type InvoiceStatus = 'unpaid' | 'partially_paid' | 'paid' | 'canceled';
export type InvoiceItemCategory = 'rent' | 'electricity' | 'mess' | 'late_fee' | 'damage';

export interface IInvoiceItem {
  description: string;
  amountPaise: number; // Integer paise
  category: InvoiceItemCategory;
}

export interface IInvoice extends Document {
  organization: mongoose.Types.ObjectId;
  property: mongoose.Types.ObjectId;
  tenant: mongoose.Types.ObjectId;
  invoiceNumber: string;
  month: number; // 1-12
  year: number; // e.g. 2026
  dueDate: Date;
  items: IInvoiceItem[];
  totalAmountPaise: number; // Integer paise
  amountPaidPaise: number; // Integer paise
  balanceDuePaise: number; // Integer paise
  status: InvoiceStatus;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const InvoiceItemSchema = new Schema<IInvoiceItem>(
  {
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
  },
  { _id: false },
);

const InvoiceSchema = new Schema<IInvoice>(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization ID is required'],
      index: true,
    },
    property: {
      type: Schema.Types.ObjectId,
      ref: 'Property',
      required: [true, 'Property ID is required'],
      index: true,
    },
    tenant: {
      type: Schema.Types.ObjectId,
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
    items: {
      type: [InvoiceItemSchema],
      required: [true, 'Invoice must have at least one line item'],
      validate: [
        (val: IInvoiceItem[]) => val.length > 0,
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
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        delete (ret as Record<string, unknown>).__v;
        return ret;
      },
    },
  },
);

// Compound unique index ensuring idempotent billing (prevent double-invoicing per tenant per month)
InvoiceSchema.index({ tenant: 1, month: 1, year: 1 }, { unique: true });
InvoiceSchema.index({ organization: 1, status: 1, dueDate: 1 });
InvoiceSchema.index({ property: 1, month: 1, year: 1 });

export const Invoice: Model<IInvoice> =
  mongoose.models.Invoice || mongoose.model<IInvoice>('Invoice', InvoiceSchema);
