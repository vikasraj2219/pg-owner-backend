"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.quickCheckin = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const checkin_validator_1 = require("../validators/checkin.validator");
const Property_1 = require("../models/Property");
const Bed_1 = require("../models/Bed");
const Tenant_1 = require("../models/Tenant");
const BedAssignment_1 = require("../models/BedAssignment");
const Invoice_1 = require("../models/Invoice");
const DepositLedger_1 = require("../models/DepositLedger");
const Organization_1 = require("../models/Organization");
const Subscription_1 = require("../models/Subscription");
const proration_service_1 = require("../services/proration.service");
const invoiceNumber_service_1 = require("../services/invoiceNumber.service");
const errorHandler_1 = require("../middleware/errorHandler");
const MONTH_NAMES = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];
const quickCheckin = async (req, res, next) => {
    try {
        const input = checkin_validator_1.quickCheckinSchema.parse(req.body);
        const orgId = req.orgId;
        const userId = req.user?.id;
        if (!orgId) {
            throw new errorHandler_1.AppError('Organization context is required', 403);
        }
        // 1. Verify Property belongs to organization
        if (!mongoose_1.default.Types.ObjectId.isValid(input.propertyId)) {
            throw new errorHandler_1.AppError('Invalid property ID format', 400);
        }
        const property = await Property_1.Property.findOne({
            _id: input.propertyId,
            organization: orgId,
        });
        if (!property) {
            throw new errorHandler_1.AppError('Property not found or does not belong to your organization', 404);
        }
        // 2. Verify Bed belongs to organization and property, and is available
        if (!mongoose_1.default.Types.ObjectId.isValid(input.bedId)) {
            throw new errorHandler_1.AppError('Invalid bed ID format', 400);
        }
        const bed = await Bed_1.Bed.findOne({
            _id: input.bedId,
            property: property._id,
            organization: orgId,
        }).populate('room');
        if (!bed) {
            throw new errorHandler_1.AppError('Bed not found or does not belong to specified property', 404);
        }
        if (bed.status !== 'available') {
            throw new errorHandler_1.AppError(`Bed ${bed.bedNumber} is currently ${bed.status}. Only available beds can be checked into.`, 400);
        }
        // 3. Verify Subscription Capacity / Quota
        const sub = await Subscription_1.Subscription.findOne({ organization: orgId });
        if (sub) {
            const occupiedBedsCount = await Bed_1.Bed.countDocuments({
                organization: orgId,
                status: { $in: ['occupied', 'notice_period'] },
            });
            if (occupiedBedsCount >= sub.maxBeds) {
                throw new errorHandler_1.AppError(`Subscription limit reached: Your ${sub.plan} plan supports up to ${sub.maxBeds} active tenants. You currently have ${occupiedBedsCount} active tenants. Please upgrade to check in additional tenants.`, 403);
            }
        }
        // 4. Prepare Dates and Proration
        const joinDateObj = new Date(input.joinDate);
        const proration = (0, proration_service_1.calculateProratedRent)(input.monthlyRentPaise, joinDateObj);
        const monthName = MONTH_NAMES[proration.month - 1];
        // Calculate invoice due date based on organization settings
        const org = await Organization_1.Organization.findById(orgId);
        const dueDay = org?.settings?.rentDueDay || 5;
        const dueDate = new Date(proration.year, proration.month - 1, dueDay);
        // If due date has passed in the current month, set due date 3 days from join date
        if (dueDate.getTime() < joinDateObj.getTime()) {
            dueDate.setTime(joinDateObj.getTime() + 3 * 24 * 60 * 60 * 1000);
        }
        // Generate unique invoice number
        const invoiceNumber = await (0, invoiceNumber_service_1.generateInvoiceNumber)(orgId.toString(), proration.year, proration.month);
        // 4. Run single transaction check-in
        let session = null;
        try {
            session = await mongoose_1.default.startSession();
            session.startTransaction();
        }
        catch (_sessionErr) {
            session = null;
        }
        try {
            const sessionOpts = session ? { session } : {};
            // A. Create Tenant
            const createdTenants = await Tenant_1.Tenant.create([
                {
                    organization: orgId,
                    property: property._id,
                    currentBed: bed._id,
                    fullName: input.fullName.trim(),
                    phone: input.phone.trim(),
                    emergencyPhone: input.emergencyPhone ? input.emergencyPhone.trim() : undefined,
                    monthlyRentPaise: input.monthlyRentPaise,
                    depositPaise: input.depositPaise,
                    depositPaidPaise: input.depositPaidPaise,
                    kycDocType: input.kycDocType,
                    kycMaskedNumber: input.kycMaskedNumber ? input.kycMaskedNumber.trim() : undefined,
                    kycDocUrl: input.kycDocUrl ? input.kycDocUrl.trim() : undefined,
                    kycConsent: input.kycConsent,
                    status: 'active',
                },
            ], sessionOpts);
            const tenant = createdTenants[0];
            if (!tenant) {
                throw new errorHandler_1.AppError('Failed to initialize tenant record', 500);
            }
            // B. Update Bed: Mark as occupied
            bed.status = 'occupied';
            bed.currentTenant = tenant._id;
            bed.maintenanceNote = undefined;
            bed.noticeEndDate = undefined;
            await bed.save(sessionOpts);
            // C. Create BedAssignment (Historical record)
            await BedAssignment_1.BedAssignment.create([
                {
                    organization: orgId,
                    property: property._id,
                    room: bed.room,
                    bed: bed._id,
                    tenant: tenant._id,
                    startDate: joinDateObj,
                    status: 'active',
                    monthlyRentPaise: input.monthlyRentPaise,
                    notes: `Checked in on ${joinDateObj.toLocaleDateString('en-IN')}`,
                },
            ], sessionOpts);
            // D. Record Security Deposit in DepositLedger if depositPaidPaise > 0
            let depositRecord = null;
            if (input.depositPaidPaise > 0) {
                const createdDeposits = await DepositLedger_1.DepositLedger.create([
                    {
                        organization: orgId,
                        property: property._id,
                        tenant: tenant._id,
                        amountPaise: input.depositPaidPaise,
                        type: 'received',
                        paymentMethod: input.depositPaymentMethod,
                        transactionRef: input.depositTransactionRef,
                        notes: 'Initial security deposit collected at check-in',
                        recordedBy: userId ? new mongoose_1.default.Types.ObjectId(userId) : undefined,
                        date: joinDateObj,
                    },
                ], sessionOpts);
                depositRecord = createdDeposits[0];
            }
            // E. Generate First Prorated Rent Invoice
            const rentDescription = proration.isProrated
                ? `Prorated Rent (${proration.billableDays} days: ${proration.joinDay} to ${proration.totalDays} ${monthName})`
                : `Full Month Rent (${monthName} ${proration.year})`;
            const createdInvoices = await Invoice_1.Invoice.create([
                {
                    organization: orgId,
                    property: property._id,
                    tenant: tenant._id,
                    invoiceNumber,
                    month: proration.month,
                    year: proration.year,
                    dueDate,
                    items: [
                        {
                            description: rentDescription,
                            amountPaise: proration.payablePaise,
                            category: 'rent',
                        },
                    ],
                    totalAmountPaise: proration.payablePaise,
                    amountPaidPaise: 0,
                    balanceDuePaise: proration.payablePaise,
                    status: 'unpaid',
                },
            ], sessionOpts);
            const invoice = createdInvoices[0];
            // Commit transaction
            if (session) {
                await session.commitTransaction();
            }
            res.status(201).json({
                success: true,
                message: `Tenant ${tenant.fullName} successfully checked into Bed ${bed.bedNumber}`,
                data: {
                    tenant,
                    bed: {
                        _id: bed._id,
                        bedNumber: bed.bedNumber,
                        status: bed.status,
                    },
                    invoice,
                    deposit: depositRecord,
                    proration,
                },
            });
        }
        catch (txError) {
            if (session && session.inTransaction()) {
                await session.abortTransaction();
            }
            throw txError;
        }
        finally {
            if (session) {
                await session.endSession();
            }
        }
    }
    catch (error) {
        next(error);
    }
};
exports.quickCheckin = quickCheckin;
