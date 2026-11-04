"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboardStats = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const Property_1 = require("../models/Property");
const Room_1 = require("../models/Room");
const Bed_1 = require("../models/Bed");
const Tenant_1 = require("../models/Tenant");
const Invoice_1 = require("../models/Invoice");
const Payment_1 = require("../models/Payment");
const Organization_1 = require("../models/Organization");
const errorHandler_1 = require("../middleware/errorHandler");
const getDashboardStats = async (req, res, next) => {
    try {
        const orgId = req.orgId;
        if (!orgId) {
            throw new errorHandler_1.AppError('Organization context is required', 403);
        }
        const org = await Organization_1.Organization.findById(orgId).select('settings');
        const gracePeriodDays = org?.settings?.gracePeriodDays ?? 5;
        const propertyFilter = { organization: orgId };
        if (req.query.propertyId) {
            if (!mongoose_1.default.Types.ObjectId.isValid(req.query.propertyId)) {
                throw new errorHandler_1.AppError('Invalid property ID format', 400);
            }
            propertyFilter._id = req.query.propertyId;
        }
        const properties = await Property_1.Property.find(propertyFilter);
        const propertyIds = properties.map(p => p._id);
        // Bed aggregations
        const bedQuery = { organization: orgId };
        if (propertyIds.length > 0) {
            bedQuery.property = { $in: propertyIds };
        }
        const [totalBeds, occupiedBeds, availableBeds, maintenanceBeds, noticeBeds, totalRooms, tenants,] = await Promise.all([
            Bed_1.Bed.countDocuments(bedQuery),
            Bed_1.Bed.countDocuments({ ...bedQuery, status: 'occupied' }),
            Bed_1.Bed.countDocuments({ ...bedQuery, status: 'available' }),
            Bed_1.Bed.countDocuments({ ...bedQuery, status: 'maintenance' }),
            Bed_1.Bed.countDocuments({ ...bedQuery, status: 'notice_period' }),
            Room_1.Room.countDocuments(bedQuery),
            Tenant_1.Tenant.find({
                organization: orgId,
                status: 'active',
                ...(propertyIds.length > 0 ? { property: { $in: propertyIds } } : {}),
            }),
        ]);
        const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 1000) / 10 : 0;
        // Monthly financial stats (current month and year)
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();
        const invoiceQuery = {
            organization: orgId,
            month: currentMonth,
            year: currentYear,
        };
        if (propertyIds.length > 0) {
            invoiceQuery.property = { $in: propertyIds };
        }
        const monthInvoices = await Invoice_1.Invoice.find(invoiceQuery);
        let collectedThisMonthPaise = 0;
        let expectedThisMonthPaise = 0;
        for (const inv of monthInvoices) {
            collectedThisMonthPaise += inv.amountPaidPaise || 0;
            expectedThisMonthPaise += inv.totalAmountPaise || 0;
        }
        // If no invoices yet generated for current month, calculate expected from active tenants
        if (expectedThisMonthPaise === 0 && tenants.length > 0) {
            expectedThisMonthPaise = tenants.reduce((acc, t) => acc + (t.monthlyRentPaise || 0), 0);
        }
        const pendingAmountPaise = Math.max(0, expectedThisMonthPaise - collectedThisMonthPaise);
        const collectionRate = expectedThisMonthPaise > 0
            ? Math.round((collectedThisMonthPaise / expectedThisMonthPaise) * 100)
            : 0;
        // Overdue stats (taking into account organization grace period)
        const overdueCutoff = new Date(now.getTime() - gracePeriodDays * 24 * 60 * 60 * 1000);
        const overdueInvoices = await Invoice_1.Invoice.find({
            organization: orgId,
            status: { $in: ['unpaid', 'partially_paid'] },
            dueDate: { $lt: overdueCutoff },
            ...(propertyIds.length > 0 ? { property: { $in: propertyIds } } : {}),
        });
        const overdueCount = overdueInvoices.length;
        const overdueAmountPaise = overdueInvoices.reduce((acc, inv) => acc + (inv.balanceDuePaise || inv.totalAmountPaise || 0), 0);
        // Recent activity feed (Recent payments and checkins)
        const [recentPayments, recentCheckins] = await Promise.all([
            Payment_1.Payment.find({
                organization: orgId,
                ...(propertyIds.length > 0 ? { property: { $in: propertyIds } } : {}),
            })
                .populate('tenant', 'fullName currentBed')
                .populate('property', 'name')
                .sort({ paymentDate: -1 })
                .limit(5),
            Tenant_1.Tenant.find({
                organization: orgId,
                status: 'active',
                ...(propertyIds.length > 0 ? { property: { $in: propertyIds } } : {}),
            })
                .populate('currentBed', 'bedNumber')
                .populate('property', 'name')
                .sort({ createdAt: -1 })
                .limit(5),
        ]);
        const activityList = [
            ...recentPayments.map(p => {
                const tenantName = p.tenant?.fullName || 'Tenant';
                const propName = p.property?.name || 'Property';
                return {
                    id: p._id.toString(),
                    type: 'payment',
                    title: `Payment Received from ${tenantName}`,
                    subtitle: `${p.receiptNumber} · ${propName} (${p.paymentMethod.toUpperCase()})`,
                    amountPaise: p.amountPaidPaise,
                    timestamp: p.paymentDate,
                };
            }),
            ...recentCheckins.map(t => {
                const bedObj = t.currentBed;
                const bedLabel = bedObj?.bedNumber ? `Bed ${bedObj.bedNumber}` : 'Bed Assigned';
                const propName = t.property?.name || 'Property';
                return {
                    id: t._id.toString(),
                    type: 'checkin',
                    title: `New Check-in: ${t.fullName}`,
                    subtitle: `${bedLabel} · ${propName}`,
                    amountPaise: t.monthlyRentPaise,
                    timestamp: t.createdAt,
                };
            }),
        ]
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, 5);
        // Net operating profit (collections)
        const netProfitPaise = collectedThisMonthPaise;
        res.status(200).json({
            success: true,
            data: {
                totalRooms,
                totalBeds,
                occupiedBeds,
                availableBeds,
                maintenanceBeds,
                noticeBeds,
                occupancyRate,
                collectedThisMonthPaise,
                expectedThisMonthPaise,
                pendingAmountPaise,
                collectionRate,
                overdueCount,
                overdueAmountPaise,
                netProfitPaise,
                totalTenants: tenants.length,
                recentActivity: activityList,
            },
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getDashboardStats = getDashboardStats;
