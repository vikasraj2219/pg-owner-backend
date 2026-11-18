import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Tenant, ITenant } from '../models/Tenant';
import { calculateBedTransferProration } from '../services/proration.service';
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


export const executeScheduledTransferIfDue = async (
  tenant: ITenant,
  orgId: any,
): Promise<boolean> => {
  if (!tenant.scheduledTransfer || !tenant.scheduledTransfer.effectiveDate) {
    return false;
  }

  const effectiveDate = new Date(tenant.scheduledTransfer.effectiveDate);
  const now = new Date();
  const effectiveDateStr = effectiveDate.toISOString().slice(0, 10);
  const nowDateStr = now.toISOString().slice(0, 10);

  if (effectiveDateStr > nowDateStr) {
    return false;
  }

  const {
    targetBed: targetBedId,
    targetRoom,
    targetProperty,
    newMonthlyRentPaise,
    notes,
    generateAdjustmentInvoice,
    proratedAdjustmentPaise,
  } = tenant.scheduledTransfer;

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
          endDate: effectiveDate,
          notes: notes || 'Scheduled bed transfer executed',
        },
      },
    );
  }

  // 2. Assign target bed
  const targetBed = await Bed.findOne({ _id: targetBedId, organization: orgId });
  if (targetBed) {
    targetBed.status = tenant.status === 'notice_period' ? 'notice_period' : 'occupied';
    targetBed.currentTenant = tenant._id as mongoose.Types.ObjectId;
    await targetBed.save();
  }

  tenant.currentBed = targetBedId;
  if (targetProperty) {
    tenant.property = targetProperty;
  }
  if (newMonthlyRentPaise !== undefined && Number(newMonthlyRentPaise) >= 0) {
    tenant.monthlyRentPaise = Number(newMonthlyRentPaise);
  }

  // 3. Create active BedAssignment
  await BedAssignment.create({
    organization: orgId,
    property: tenant.property,
    room: targetRoom,
    bed: targetBedId,
    tenant: tenant._id,
    monthlyRentPaise: newMonthlyRentPaise ?? tenant.monthlyRentPaise,
    startDate: effectiveDate,
    status: 'active',
    notes: notes || 'Scheduled bed transfer executed',
  });

  // 4. Update status in transferHistory
  if (tenant.transferHistory && tenant.transferHistory.length > 0) {
    const scheduledItem = tenant.transferHistory.find(t => t.status === 'scheduled');
    if (scheduledItem) {
      scheduledItem.status = 'completed';
    }
  }

  // 5. Generate adjustment invoice if requested
  if (generateAdjustmentInvoice && proratedAdjustmentPaise && proratedAdjustmentPaise > 0) {
    const month = effectiveDate.getMonth() + 1;
    const year = effectiveDate.getFullYear();
    const existingInvoice = await Invoice.findOne({
      organization: orgId,
      tenant: tenant._id,
      month,
      year,
    });
    if (existingInvoice && existingInvoice.status !== 'canceled') {
      existingInvoice.items.push({
        description: `Bed transfer rent adjustment (to Bed ${targetBed?.bedNumber || ''})`,
        amountPaise: proratedAdjustmentPaise,
        category: 'rent',
      });
      existingInvoice.totalAmountPaise += proratedAdjustmentPaise;
      existingInvoice.balanceDuePaise += proratedAdjustmentPaise;
      if (existingInvoice.status === 'paid') {
        existingInvoice.status = 'partially_paid';
      }
      await existingInvoice.save();
    }
  }

  tenant.scheduledTransfer = undefined;
  await tenant.save();
  return true;
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

    let tenant = await Tenant.findOne({ _id: id, organization: orgId })
      .populate('property', 'name type address upiVpa electricityRatePaisePerUnit')
      .populate({
        path: 'currentBed',
        select: 'bedNumber status room noticeEndDate maintenanceNote',
        populate: {
          path: 'room',
          select: 'roomNumber floorNumber sharingType baseRentPaisePerBed tags',
        },
      })
      .populate({
        path: 'scheduledTransfer.targetBed',
        select: 'bedNumber status room baseRentPaise',
      })
      .populate({
        path: 'scheduledTransfer.targetRoom',
        select: 'roomNumber floorNumber sharingType baseRentPaisePerBed',
      })
      .populate({
        path: 'scheduledTransfer.targetProperty',
        select: 'name',
      })
      .populate('transferHistory.fromBed', 'bedNumber')
      .populate('transferHistory.toBed', 'bedNumber')
      .populate('transferHistory.fromRoom', 'roomNumber floorNumber')
      .populate('transferHistory.toRoom', 'roomNumber floorNumber');

    if (tenant && tenant.scheduledTransfer && tenant.scheduledTransfer.effectiveDate) {
      const executed = await executeScheduledTransferIfDue(tenant, orgId);
      if (executed) {
        tenant = await Tenant.findOne({ _id: id, organization: orgId })
          .populate('property', 'name type address upiVpa electricityRatePaisePerUnit')
          .populate({
            path: 'currentBed',
            select: 'bedNumber status room noticeEndDate maintenanceNote',
            populate: {
              path: 'room',
              select: 'roomNumber floorNumber sharingType baseRentPaisePerBed tags',
            },
          })
          .populate('transferHistory.fromBed', 'bedNumber')
          .populate('transferHistory.toBed', 'bedNumber')
          .populate('transferHistory.fromRoom', 'roomNumber floorNumber')
          .populate('transferHistory.toRoom', 'roomNumber floorNumber');
      }
    }

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
    const {
      newBedId,
      targetPropertyId,
      effectiveType = 'immediate',
      effectiveDate: customEffectiveDate,
      newMonthlyRentPaise,
      generateAdjustmentInvoice = false,
      notes,
    } = req.body;

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

    // Determine target effective date
    let effectiveDate: Date;
    if (effectiveType === 'next_month') {
      const now = new Date();
      effectiveDate = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
    } else if (effectiveType === 'custom') {
      if (!customEffectiveDate) {
        throw new AppError('Effective date is required for custom date transfers', 400);
      }
      effectiveDate = new Date(customEffectiveDate);
      if (isNaN(effectiveDate.getTime())) {
        throw new AppError('Invalid custom effective date', 400);
      }
    } else {
      // immediate
      effectiveDate = new Date();
    }

    const oldRentPaise = tenant.monthlyRentPaise || 0;
    const targetRentPaise =
      newMonthlyRentPaise !== undefined && Number(newMonthlyRentPaise) >= 0
        ? Number(newMonthlyRentPaise)
        : (targetBed.baseRentPaise ?? (targetBed.room as any)?.baseRentPaisePerBed ?? oldRentPaise);

    const proration = calculateBedTransferProration(
      oldRentPaise,
      targetRentPaise,
      effectiveDate,
      effectiveType,
    );

    // If tenant already had a scheduled transfer, free the previously reserved bed
    if (tenant.scheduledTransfer && tenant.scheduledTransfer.targetBed) {
      const prevReservedBed = await Bed.findOne({
        _id: tenant.scheduledTransfer.targetBed,
        organization: orgId,
      });
      if (prevReservedBed && prevReservedBed.status === 'reserved') {
        prevReservedBed.status = 'available';
        prevReservedBed.currentTenant = undefined;
        await prevReservedBed.save();
      }
    }

    const isFutureTransfer =
      effectiveType === 'next_month' ||
      (effectiveType === 'custom' &&
        effectiveDate.toISOString().slice(0, 10) > new Date().toISOString().slice(0, 10));

    if (isFutureTransfer) {
      // Reserve destination bed
      targetBed.status = 'reserved';
      targetBed.currentTenant = tenant._id as mongoose.Types.ObjectId;
      await targetBed.save();

      tenant.scheduledTransfer = {
        targetBed: targetBed._id as mongoose.Types.ObjectId,
        targetRoom: (targetBed.room as any)?._id || targetBed.room,
        targetProperty: (targetPropertyId as any) || targetBed.property || tenant.property,
        newMonthlyRentPaise: targetRentPaise,
        effectiveDate,
        effectiveType,
        proratedAdjustmentPaise: proration.proratedAdjustmentPaise,
        generateAdjustmentInvoice: Boolean(generateAdjustmentInvoice),
        notes,
        scheduledAt: new Date(),
      };

      if (!tenant.transferHistory) {
        tenant.transferHistory = [];
      }
      tenant.transferHistory.push({
        fromBed: tenant.currentBed,
        toBed: targetBed._id as mongoose.Types.ObjectId,
        fromRoom: tenant.currentBed ? (tenant as any).room : undefined,
        toRoom: (targetBed.room as any)?._id || targetBed.room,
        fromProperty: tenant.property,
        toProperty: (targetPropertyId as any) || targetBed.property || tenant.property,
        previousRentPaise: oldRentPaise,
        newRentPaise: targetRentPaise,
        effectiveDate,
        transferDate: new Date(),
        effectiveType,
        proratedAdjustmentPaise: proration.proratedAdjustmentPaise,
        notes,
        status: 'scheduled',
      });

      await tenant.save();

      res.status(200).json({
        success: true,
        message: `Bed transfer scheduled to Bed ${targetBed.bedNumber} starting ${effectiveDate.toLocaleDateString('en-IN')}`,
        data: {
          tenantId: tenant._id,
          targetBedId: targetBed._id,
          bedNumber: targetBed.bedNumber,
          isScheduled: true,
          effectiveDate,
          proration,
        },
      });
      return;
    }

    // IMMEDIATE TRANSFER:
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
            endDate: effectiveDate,
            notes: notes || 'Transferred to another bed',
          },
        },
      );
    }

    // 2. Assign target bed
    targetBed.status = tenant.status === 'notice_period' ? 'notice_period' : 'occupied';
    targetBed.currentTenant = tenant._id as mongoose.Types.ObjectId;
    await targetBed.save();

    const previousBedId = tenant.currentBed;
    tenant.currentBed = targetBed._id as mongoose.Types.ObjectId;
    if (targetPropertyId) {
      tenant.property = targetPropertyId as any;
    }
    tenant.monthlyRentPaise = targetRentPaise;

    // 3. Record in transfer history
    if (!tenant.transferHistory) {
      tenant.transferHistory = [];
    }
    tenant.transferHistory.push({
      fromBed: previousBedId,
      toBed: targetBed._id as mongoose.Types.ObjectId,
      fromRoom: undefined,
      toRoom: (targetBed.room as any)?._id || targetBed.room,
      fromProperty: tenant.property,
      toProperty: (targetPropertyId as any) || targetBed.property || tenant.property,
      previousRentPaise: oldRentPaise,
      newRentPaise: targetRentPaise,
      effectiveDate,
      transferDate: new Date(),
      effectiveType: 'immediate',
      proratedAdjustmentPaise: proration.proratedAdjustmentPaise,
      notes,
      status: 'completed',
    });

    tenant.scheduledTransfer = undefined;
    await tenant.save();

    // 4. Create new active BedAssignment record
    await BedAssignment.create({
      organization: orgId,
      property: tenant.property,
      room: (targetBed.room as any)?._id || targetBed.room,
      bed: targetBed._id,
      tenant: tenant._id,
      monthlyRentPaise: targetRentPaise,
      startDate: effectiveDate,
      status: 'active',
      notes: notes || 'Bed transfer',
    });

    // 5. Generate adjustment invoice if requested and adjustment > 0
    if (generateAdjustmentInvoice && proration.proratedAdjustmentPaise > 0) {
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();
      const existingInvoice = await Invoice.findOne({
        organization: orgId,
        tenant: tenant._id,
        month: currentMonth,
        year: currentYear,
      });

      if (existingInvoice && existingInvoice.status !== 'canceled') {
        existingInvoice.items.push({
          description: `Bed transfer rent adjustment (to Bed ${targetBed.bedNumber})`,
          amountPaise: proration.proratedAdjustmentPaise,
          category: 'rent',
        });
        existingInvoice.totalAmountPaise += proration.proratedAdjustmentPaise;
        existingInvoice.balanceDuePaise += proration.proratedAdjustmentPaise;
        if (existingInvoice.status === 'paid') {
          existingInvoice.status = 'partially_paid';
        }
        await existingInvoice.save();
      }
    }

    res.status(200).json({
      success: true,
      message: `Tenant ${tenant.fullName} successfully moved to Bed ${targetBed.bedNumber}`,
      data: {
        tenantId: tenant._id,
        newBedId: targetBed._id,
        bedNumber: targetBed.bedNumber,
        isScheduled: false,
        proration,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Cancel a scheduled bed transfer
 * POST /api/tenants/:id/cancel-scheduled-transfer
 */
export const cancelScheduledTransfer = async (
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

    if (!tenant.scheduledTransfer) {
      throw new AppError('Tenant does not have an active scheduled transfer', 400);
    }

    const targetBedId = tenant.scheduledTransfer.targetBed;
    const targetBed = await Bed.findOne({ _id: targetBedId, organization: orgId });
    if (targetBed && targetBed.status === 'reserved') {
      targetBed.status = 'available';
      targetBed.currentTenant = undefined;
      await targetBed.save();
    }

    if (tenant.transferHistory && tenant.transferHistory.length > 0) {
      const scheduledIdx = tenant.transferHistory.findIndex(t => t.status === 'scheduled');
      if (scheduledIdx !== -1) {
        const scheduledEntry = tenant.transferHistory[scheduledIdx];
      if (scheduledEntry) scheduledEntry.status = 'cancelled';
      }
    }

    tenant.scheduledTransfer = undefined;
    await tenant.save();

    res.status(200).json({
      success: true,
      message: 'Scheduled transfer cancelled successfully',
      data: tenant,
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
