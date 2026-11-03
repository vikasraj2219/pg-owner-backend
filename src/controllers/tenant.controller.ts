import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Tenant } from '../models/Tenant';
import { Invoice } from '../models/Invoice';
import { DepositLedger } from '../models/DepositLedger';
import { BedAssignment } from '../models/BedAssignment';
import { Bed } from '../models/Bed';
import { Payment } from '../models/Payment';
import { AppError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../types';

export const getTenants = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const orgId = req.orgId;
    if (!orgId) {
      throw new AppError('Organization context is required', 403);
    }

    const filter: Record<string, unknown> = {
      organization: orgId,
      isDeleted: { $ne: true },
    };

    if (req.query.propertyId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.propertyId as string)) {
        throw new AppError('Invalid propertyId format', 400);
      }
      filter.property = req.query.propertyId;
    }

    if (req.query.status) {
      filter.status = req.query.status;
    }

    if (req.query.search) {
      const searchRegex = new RegExp(String(req.query.search).trim(), 'i');
      filter.$or = [{ fullName: searchRegex }, { phone: searchRegex }];
    }

    const tenants = await Tenant.find(filter)
      .populate('property', 'name type address')
      .populate({
        path: 'currentBed',
        select: 'bedNumber status room',
        populate: {
          path: 'room',
          select: 'roomNumber floorNumber sharingType',
        },
      })
      .sort({ createdAt: -1 });

    // Aggregate balance dues and active/notice bed assignment details
    const tenantIds = tenants.map(t => t._id);
    const unpaidInvoices = await Invoice.find({
      organization: orgId,
      tenant: { $in: tenantIds },
      status: { $in: ['unpaid', 'partially_paid'] },
    }).select('tenant balanceDuePaise status dueDate');

    const dueMap: Record<string, { balanceDuePaise: number; overdueCount: number }> = {};
    for (const inv of unpaidInvoices) {
      const tId = String(inv.tenant);
      if (!dueMap[tId]) {
        dueMap[tId] = { balanceDuePaise: 0, overdueCount: 0 };
      }
      dueMap[tId].balanceDuePaise += inv.balanceDuePaise || 0;
      if (inv.dueDate && new Date(inv.dueDate) < new Date()) {
        dueMap[tId].overdueCount += 1;
      }
    }

    const enhancedTenants = tenants.map(t => {
      const tenantObj = t.toObject ? t.toObject() : t;
      const dues = dueMap[String(t._id)] || { balanceDuePaise: 0, overdueCount: 0 };
      return {
        ...tenantObj,
        balanceDuePaise: dues.balanceDuePaise,
        hasOverdue: dues.overdueCount > 0,
      };
    });

    res.status(200).json({
      success: true,
      count: enhancedTenants.length,
      data: enhancedTenants,
    });
  } catch (error) {
    next(error);
  }
};

export const getTenantById = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid tenant ID format', 400);
    }

    const tenant = await Tenant.findOne({ _id: id, organization: orgId })
      .populate('property', 'name type address upiVpa electricityRatePaisePerUnit')
      .populate({
        path: 'currentBed',
        select: 'bedNumber status room noticeEndDate maintenanceNote',
        populate: {
          path: 'room',
          select: 'roomNumber floorNumber sharingType baseRentPaisePerBed tags',
        },
      });

    if (!tenant) {
      throw new AppError('Tenant not found or does not belong to your organization', 404);
    }

    // Fetch tenant's recent invoices, deposits, bed assignments, and payments
    const [invoices, deposits, bedHistory, payments] = await Promise.all([
      Invoice.find({ tenant: tenant._id, organization: orgId }).sort({ year: -1, month: -1 }),
      DepositLedger.find({ tenant: tenant._id, organization: orgId }).sort({ date: -1 }),
      BedAssignment.find({ tenant: tenant._id, organization: orgId })
        .populate('bed', 'bedNumber')
        .populate('room', 'roomNumber floorNumber')
        .sort({ startDate: -1 }),
      Payment.find({ tenant: tenant._id, organization: orgId }).sort({ paymentDate: -1 }),
    ]);

    const balanceDuePaise = invoices
      .filter(i => i.status !== 'paid' && (i.balanceDuePaise ?? 0) > 0)
      .reduce((sum, i) => sum + (i.balanceDuePaise || 0), 0);

    res.status(200).json({
      success: true,
      data: {
        tenant,
        invoices,
        deposits,
        bedHistory,
        payments,
        balanceDuePaise,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const vacateTenant = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    const userId = req.user?.id;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid tenant ID format', 400);
    }

    const tenant = await Tenant.findOne({ _id: id, organization: orgId });
    if (!tenant) {
      throw new AppError('Tenant not found or does not belong to your organization', 404);
    }

    const {
      deductionsPaise = 0,
      refundPaise = 0,
      paymentMethod = 'cash',
      notes = 'Checkout settlement',
    } = req.body;

    // 1. Release assigned bed if any
    if (tenant.currentBed) {
      const bed = await Bed.findOne({ _id: tenant.currentBed, organization: orgId });
      if (bed) {
        bed.status = 'available';
        bed.currentTenant = undefined;
        bed.noticeEndDate = undefined;
        bed.maintenanceNote = undefined;
        await bed.save();
      }
    }

    // 2. End bed assignment history
    await BedAssignment.updateMany(
      { tenant: tenant._id, organization: orgId, status: 'active' },
      { $set: { status: 'vacated', endDate: new Date(), notes } },
    );

    // 3. Record refund in DepositLedger if refundPaise > 0
    if (refundPaise > 0) {
      await DepositLedger.create({
        organization: orgId,
        property: tenant.property,
        tenant: tenant._id,
        amountPaise: refundPaise,
        type: 'refunded',
        paymentMethod,
        notes: `Checkout net deposit refund: ${notes}`,
        recordedBy: userId ? new mongoose.Types.ObjectId(userId) : undefined,
        date: new Date(),
      });
    }

    // 4. Record deductions if deductionsPaise > 0
    if (deductionsPaise > 0) {
      await DepositLedger.create({
        organization: orgId,
        property: tenant.property,
        tenant: tenant._id,
        amountPaise: deductionsPaise,
        type: 'deducted',
        paymentMethod,
        notes: `Checkout damage/repair deduction: ${notes}`,
        recordedBy: userId ? new mongoose.Types.ObjectId(userId) : undefined,
        date: new Date(),
      });
    }

    // 5. Update tenant status to checked_out
    tenant.status = 'checked_out';
    tenant.currentBed = undefined;
    await tenant.save();

    res.status(200).json({
      success: true,
      message: `Tenant ${tenant.fullName} successfully vacated and settled.`,
      data: {
        tenantId: tenant._id,
        status: tenant.status,
        netRefundPaise: refundPaise,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Mark tenant and bed on notice period
 * POST /api/tenants/:id/notice
 */
export const setNoticePeriod = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    const { expectedVacateDate, notes } = req.body;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid tenant ID format', 400);
    }

    if (!expectedVacateDate) {
      throw new AppError('expectedVacateDate is required', 400);
    }

    const tenant = await Tenant.findOne({ _id: id, organization: orgId });
    if (!tenant) {
      throw new AppError('Tenant not found or does not belong to your organization', 404);
    }

    const vacateDate = new Date(expectedVacateDate);
    if (isNaN(vacateDate.getTime())) {
      throw new AppError('Invalid expectedVacateDate format', 400);
    }

    tenant.status = 'notice_period';
    await tenant.save();

    if (tenant.currentBed) {
      const bed = await Bed.findOne({ _id: tenant.currentBed, organization: orgId });
      if (bed) {
        bed.status = 'notice_period';
        bed.noticeEndDate = vacateDate;
        if (notes) bed.maintenanceNote = notes;
        await bed.save();
      }
    }

    res.status(200).json({
      success: true,
      message: `Tenant ${tenant.fullName} put on notice period until ${vacateDate.toDateString()}`,
      data: {
        tenantId: tenant._id,
        status: tenant.status,
        noticeEndDate: vacateDate,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Cancel notice period and restore active tenant / occupied bed status
 * POST /api/tenants/:id/cancel-notice
 */
export const cancelNoticePeriod = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid tenant ID format', 400);
    }

    const tenant = await Tenant.findOne({ _id: id, organization: orgId });
    if (!tenant) {
      throw new AppError('Tenant not found or does not belong to your organization', 404);
    }

    tenant.status = 'active';
    await tenant.save();

    if (tenant.currentBed) {
      const bed = await Bed.findOne({ _id: tenant.currentBed, organization: orgId });
      if (bed) {
        bed.status = 'occupied';
        bed.noticeEndDate = undefined;
        await bed.save();
      }
    }

    res.status(200).json({
      success: true,
      message: `Notice period canceled for ${tenant.fullName}. Bed restored to occupied.`,
      data: {
        tenantId: tenant._id,
        status: tenant.status,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update tenant profile details
 * PUT /api/tenants/:id
 */
export const updateTenant = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid tenant ID format', 400);
    }

    const tenant = await Tenant.findOne({
      _id: id,
      organization: orgId,
      isDeleted: { $ne: true },
    });
    if (!tenant) {
      throw new AppError('Tenant not found', 404);
    }

    const {
      fullName,
      phone,
      emergencyPhone,
      email,
      monthlyRentPaise,
      depositPaise,
      kycMaskedNumber,
      kycDocUrl,
    } = req.body;

    if (fullName !== undefined) tenant.fullName = fullName.trim();
    if (phone !== undefined) tenant.phone = phone.trim();
    if (emergencyPhone !== undefined) tenant.emergencyPhone = emergencyPhone?.trim();
    if (email !== undefined) tenant.email = email?.trim()?.toLowerCase();
    if (monthlyRentPaise !== undefined && monthlyRentPaise >= 0) {
      tenant.monthlyRentPaise = monthlyRentPaise;
    }
    if (depositPaise !== undefined && depositPaise >= 0) {
      tenant.depositPaise = depositPaise;
    }
    if (kycMaskedNumber !== undefined) tenant.kycMaskedNumber = kycMaskedNumber;
    if (kycDocUrl !== undefined) tenant.kycDocUrl = kycDocUrl;

    await tenant.save();

    res.status(200).json({
      success: true,
      message: 'Tenant details updated successfully',
      data: tenant,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Move tenant to another bed
 * POST /api/tenants/:id/move-bed
 */
export const moveBed = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    const { newBedId, notes } = req.body;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid tenant ID format', 400);
    }
    if (!newBedId || !mongoose.Types.ObjectId.isValid(newBedId)) {
      throw new AppError('Invalid newBedId format', 400);
    }

    const tenant = await Tenant.findOne({
      _id: id,
      organization: orgId,
      isDeleted: { $ne: true },
    });
    if (!tenant) {
      throw new AppError('Tenant not found', 404);
    }

    const targetBed = await Bed.findOne({ _id: newBedId, organization: orgId }).populate('room');
    if (!targetBed) {
      throw new AppError('Target bed not found', 404);
    }
    if (targetBed.status !== 'available') {
      throw new AppError(
        `Target bed ${targetBed.bedNumber} is not available (current status: ${targetBed.status})`,
        400,
      );
    }

    // 1. Vacate old bed if assigned
    if (tenant.currentBed) {
      const oldBed = await Bed.findOne({ _id: tenant.currentBed, organization: orgId });
      if (oldBed) {
        oldBed.status = 'available';
        oldBed.currentTenant = undefined;
        oldBed.noticeEndDate = undefined;
        oldBed.maintenanceNote = undefined;
        await oldBed.save();
      }

      await BedAssignment.updateMany(
        { tenant: tenant._id, bed: tenant.currentBed, status: 'active' },
        {
          $set: {
            status: 'transferred',
            endDate: new Date(),
            notes: notes || 'Transferred to another bed',
          },
        },
      );
    }

    // 2. Assign target bed
    targetBed.status = tenant.status === 'notice_period' ? 'notice_period' : 'occupied';
    targetBed.currentTenant = tenant._id as mongoose.Types.ObjectId;
    await targetBed.save();

    tenant.currentBed = targetBed._id as mongoose.Types.ObjectId;
    await tenant.save();

    // 3. Create new active BedAssignment record
    await BedAssignment.create({
      organization: orgId,
      property: tenant.property,
      room: (targetBed.room as any)?._id || targetBed.room,
      bed: targetBed._id,
      tenant: tenant._id,
      startDate: new Date(),
      status: 'active',
      notes: notes || 'Bed transfer',
    });

    res.status(200).json({
      success: true,
      message: `Tenant ${tenant.fullName} successfully moved to Bed ${targetBed.bedNumber}`,
      data: {
        tenantId: tenant._id,
        newBedId: targetBed._id,
        bedNumber: targetBed.bedNumber,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete tenant or return can't delete warning if dues or bed assigned
 * DELETE /api/tenants/:id
 */
export const deleteTenant = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid tenant ID format', 400);
    }

    const tenant = await Tenant.findOne({ _id: id, organization: orgId }).populate('currentBed');
    if (!tenant) {
      throw new AppError('Tenant not found', 404);
    }

    // Check if tenant is still occupying a bed or active/notice
    const hasBed = Boolean(tenant.currentBed);
    const isOccupied = tenant.status === 'active' || tenant.status === 'notice_period';

    // Calculate unpaid dues
    const unpaidInvoices = await Invoice.find({
      organization: orgId,
      tenant: tenant._id,
      status: { $in: ['unpaid', 'partially_paid', 'overdue'] },
    });
    const balanceDuePaise = unpaidInvoices.reduce((sum, i) => sum + (i.balanceDuePaise || 0), 0);

    // If still in bed or has unpaid dues or active deposit:
    if (hasBed || isOccupied || balanceDuePaise > 0) {
      const bedNumber = (tenant.currentBed as any)?.bedNumber || 'assigned bed';
      res.status(400).json({
        success: false,
        canDelete: false,
        message: `${tenant.fullName} is still in Bed ${bedNumber} with ₹${(balanceDuePaise / 100).toLocaleString('en-IN')} due and a ₹${(tenant.depositPaise / 100).toLocaleString('en-IN')} deposit held. Check him out first to settle dues, then you can delete his record.`,
        data: {
          tenantId: tenant._id,
          bedNumber,
          balanceDuePaise,
          depositPaise: tenant.depositPaise,
        },
      });
      return;
    }

    // Tenant is settled / checked out -> soft delete
    tenant.isDeleted = true;
    tenant.deletedAt = new Date();
    await tenant.save();

    res.status(200).json({
      success: true,
      canDelete: true,
      message: `Tenant ${tenant.fullName} deleted successfully.`,
      data: {
        tenantId: tenant._id,
        fullName: tenant.fullName,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Restore recently deleted tenant
 * POST /api/tenants/:id/restore
 */
export const restoreTenant = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid tenant ID format', 400);
    }

    const tenant = await Tenant.findOne({ _id: id, organization: orgId });
    if (!tenant) {
      throw new AppError('Tenant not found', 404);
    }

    tenant.isDeleted = false;
    tenant.deletedAt = undefined;
    await tenant.save();

    res.status(200).json({
      success: true,
      message: `Tenant ${tenant.fullName} restored successfully.`,
      data: tenant,
    });
  } catch (error) {
    next(error);
  }
};
