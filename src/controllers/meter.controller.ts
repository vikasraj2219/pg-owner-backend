import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { AuthenticatedRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { MeterReading, Room, Property, BedAssignment, Bed, Invoice } from '../models';
import { generateInvoiceNumber } from '../services/invoiceNumber.service';
import { createMeterReadingSchema, updateMeterReadingSchema } from '../validators/meter.validator';

/**
 * Helper to calculate occupancy days for each tenant in a room during a reading window.
 * Uses BedAssignment history to account for mid-period check-ins, checkouts, and room transfers.
 */
async function getRoomOccupancyForWindow(
  roomId: string | mongoose.Types.ObjectId,
  orgId: string | mongoose.Types.ObjectId,
  periodStart: Date,
  periodEnd: Date,
): Promise<Array<{ tenantId: mongoose.Types.ObjectId; days: number; tenantName?: string }>> {
  const windowStartTime = periodStart.getTime();
  const windowEndTime = periodEnd.getTime();

  // 1. Find all BedAssignment records for this room overlapping with the reading window
  const assignments = await BedAssignment.find({
    room: roomId,
    organization: orgId,
    startDate: { $lte: periodEnd },
    $or: [
      { endDate: { $exists: false } },
      { endDate: null },
      { endDate: { $gte: periodStart } },
    ],
  }).populate('tenant', 'fullName status isDeleted');

  // 2. Also check current Bed occupants in this room as fallback/supplement
  const occupiedBeds = await Bed.find({
    room: roomId,
    organization: orgId,
    status: { $in: ['occupied', 'notice_period'] },
    currentTenant: { $exists: true, $ne: null },
  }).populate('currentTenant', 'fullName status isDeleted joinDate createdAt');

  const tenantDaysMap = new Map<
    string,
    { tenantId: mongoose.Types.ObjectId; days: number; tenantName?: string }
  >();

  // Process historical and active assignments
  for (const as of assignments) {
    if (!as.tenant) continue;
    const t = as.tenant as any;
    if (t.isDeleted) continue;

    const tId = t._id.toString();
    const asStart = as.startDate ? as.startDate.getTime() : windowStartTime;
    const asEnd = as.endDate ? as.endDate.getTime() : windowEndTime;

    const overlapStart = Math.max(asStart, windowStartTime);
    const overlapEnd = Math.min(asEnd, windowEndTime);

    if (overlapEnd >= overlapStart) {
      const days = Math.max(1, Math.round((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1);
      const existing = tenantDaysMap.get(tId);
      if (existing) {
        existing.days += days;
      } else {
        tenantDaysMap.set(tId, {
          tenantId: t._id,
          days,
          tenantName: t.fullName,
        });
      }
    }
  }

  // Fallback for current beds if no assignment was recorded
  for (const b of occupiedBeds) {
    if (!b.currentTenant) continue;
    const t = b.currentTenant as any;
    if (t.isDeleted) continue;

    const tId = t._id.toString();
    if (!tenantDaysMap.has(tId)) {
      const joinTime =
        t.joinDate || t.createdAt ? new Date(t.joinDate || t.createdAt).getTime() : windowStartTime;
      const overlapStart = Math.max(joinTime, windowStartTime);
      const overlapEnd = windowEndTime;

      if (overlapEnd >= overlapStart) {
        const days = Math.max(1, Math.round((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1);
        tenantDaysMap.set(tId, {
          tenantId: t._id,
          days,
          tenantName: t.fullName,
        });
      }
    }
  }

  return Array.from(tenantDaysMap.values());
}

/**
 * Synchronize tenant meter splits with the Invoice collection.
 * Supports Mode A (Add to Next Rent Invoice) and Mode B (Separate Utility Invoice).
 */
async function syncMeterReadingToInvoices(
  reading: any,
  orgId: mongoose.Types.ObjectId | string,
): Promise<void> {
  const windowStart = reading.previousReadingDate || reading.readingDate || new Date();
  const windowEnd = reading.currentReadingDate || reading.readingDate || new Date();
  const readingDate = new Date(windowEnd);
  const invMonth = readingDate.getMonth() + 1;
  const invYear = readingDate.getFullYear();

  const identifier = reading.meterIdentifier || 'Sub-meter';
  const itemTag = `[MTR:${reading._id.toString()}]`;
  const periodText = `${new Date(windowStart).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} - ${new Date(windowEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
  const ebDesc = `Electricity: ${identifier} (${reading.unitsConsumed}u @ ₹${(reading.ratePaisePerUnit / 100).toFixed(1)}/u: ${periodText}) ${itemTag}`;

  for (const split of reading.tenantSplits || []) {
    if (!split.tenant) continue;
    const tenantId = split.tenant._id || split.tenant;

    if (split.sharePaise <= 0) {
      split.status = 'invoiced';
      continue;
    }

    if (reading.billingMode === 'separate_invoice') {
      // MODE B: Generate a separate standalone electricity invoice due in 5 days
      let invoice = await Invoice.findOne({
        organization: orgId,
        tenant: tenantId,
        invoiceType: 'electricity',
        month: invMonth,
        year: invYear,
      });

      if (invoice) {
        const existingIdx = invoice.items.findIndex(
          it =>
            it.category === 'electricity' &&
            (it.description.includes(itemTag) || it.description.includes(`Electricity: ${identifier}`)),
        );
        if (existingIdx >= 0 && invoice.items[existingIdx]) {
          invoice.items[existingIdx].description = ebDesc;
          invoice.items[existingIdx].amountPaise = split.sharePaise;
        } else {
          invoice.items.push({
            description: ebDesc,
            amountPaise: split.sharePaise,
            category: 'electricity',
          });
        }
        const newTotal = invoice.items.reduce((sum, it) => sum + it.amountPaise, 0);
        invoice.totalAmountPaise = newTotal;
        invoice.balanceDuePaise = Math.max(0, newTotal - invoice.amountPaidPaise);
        if (invoice.balanceDuePaise === 0 && invoice.totalAmountPaise > 0) {
          invoice.status = 'paid';
        } else if (invoice.amountPaidPaise > 0) {
          invoice.status = 'partially_paid';
        } else {
          invoice.status = 'unpaid';
        }
        await invoice.save();
        split.invoice = invoice._id;
        split.status = 'invoiced';
      } else {
        const invNum = await generateInvoiceNumber(orgId.toString(), invYear, invMonth);
        const dueDate = new Date(readingDate.getTime() + 5 * 24 * 60 * 60 * 1000); // 5-day grace period
        const newInvoice = await Invoice.create({
          organization: orgId,
          property: reading.property,
          tenant: tenantId,
          invoiceNumber: invNum,
          invoiceType: 'electricity',
          month: invMonth,
          year: invYear,
          dueDate,
          periodStart: windowStart,
          periodEnd: windowEnd,
          items: [
            {
              description: ebDesc,
              amountPaise: split.sharePaise,
              category: 'electricity',
            },
          ],
          totalAmountPaise: split.sharePaise,
          amountPaidPaise: 0,
          balanceDuePaise: split.sharePaise,
          status: 'unpaid',
        });
        split.invoice = newInvoice._id;
        split.status = 'invoiced';
      }
    } else {
      // MODE A: Add to Next Rent Invoice (Default Recommended)
      // Check if the tenant currently has an UNPAID rent invoice for the current month
      const activeUnpaidRentInvoice = await Invoice.findOne({
        organization: orgId,
        tenant: tenantId,
        invoiceType: 'rent',
        status: { $in: ['unpaid', 'partially_paid'] },
      }).sort({ dueDate: -1 });

      if (activeUnpaidRentInvoice) {
        // Rent invoice is pending/unpaid -> attach electricity line item directly
        const existingIdx = activeUnpaidRentInvoice.items.findIndex(
          it =>
            it.category === 'electricity' &&
            (it.description.includes(itemTag) || it.description.includes(`Electricity: ${identifier}`)),
        );
        if (existingIdx >= 0 && activeUnpaidRentInvoice.items[existingIdx]) {
          activeUnpaidRentInvoice.items[existingIdx].description = ebDesc;
          activeUnpaidRentInvoice.items[existingIdx].amountPaise = split.sharePaise;
        } else {
          activeUnpaidRentInvoice.items.push({
            description: ebDesc,
            amountPaise: split.sharePaise,
            category: 'electricity',
          });
        }
        const newTotal = activeUnpaidRentInvoice.items.reduce((sum, it) => sum + it.amountPaise, 0);
        activeUnpaidRentInvoice.totalAmountPaise = newTotal;
        activeUnpaidRentInvoice.balanceDuePaise = Math.max(
          0,
          newTotal - activeUnpaidRentInvoice.amountPaidPaise,
        );
        if (activeUnpaidRentInvoice.balanceDuePaise === 0 && activeUnpaidRentInvoice.totalAmountPaise > 0) {
          activeUnpaidRentInvoice.status = 'paid';
        } else if (activeUnpaidRentInvoice.amountPaidPaise > 0) {
          activeUnpaidRentInvoice.status = 'partially_paid';
        } else {
          activeUnpaidRentInvoice.status = 'unpaid';
        }
        await activeUnpaidRentInvoice.save();
        split.invoice = activeUnpaidRentInvoice._id;
        split.status = 'invoiced';
      } else {
        // No unpaid rent invoice currently open (rent was already paid, or next cycle not yet reached)
        // Keep in pending_billing state so it attaches cleanly to the upcoming rent invoice on join anniversary
        split.status = 'pending_billing';
      }
    }
  }
}

/**
 * Remove electricity charges associated with a deleted meter reading from tenant invoices.
 */
async function removeMeterReadingFromInvoices(
  reading: any,
  orgId: mongoose.Types.ObjectId | string,
): Promise<void> {
  const itemTag = `[MTR:${reading._id.toString()}]`;
  const identifier = reading.meterIdentifier || 'Sub-meter';

  for (const split of reading.tenantSplits || []) {
    if (!split.tenant) continue;
    const tenantId = split.tenant._id || split.tenant;

    const invoice = await Invoice.findOne({
      organization: orgId,
      $or: [
        { _id: split.invoice },
        {
          tenant: tenantId,
          'items.description': { $regex: reading._id.toString() },
        },
      ],
    });

    if (invoice) {
      const idx = invoice.items.findIndex(
        it =>
          it.category === 'electricity' &&
          (it.description.includes(itemTag) ||
            it.description.includes(`Electricity: ${identifier}`)),
      );
      if (idx >= 0) {
        invoice.items.splice(idx, 1);
        if (invoice.items.length === 0 && invoice.amountPaidPaise === 0) {
          await Invoice.deleteOne({ _id: invoice._id, organization: orgId });
        } else {
          const newTotal = invoice.items.reduce((sum, it) => sum + it.amountPaise, 0);
          invoice.totalAmountPaise = newTotal;
          invoice.balanceDuePaise = Math.max(0, newTotal - invoice.amountPaidPaise);
          if (invoice.balanceDuePaise === 0 && invoice.totalAmountPaise > 0) {
            invoice.status = 'paid';
          } else if (invoice.amountPaidPaise > 0) {
            invoice.status = 'partially_paid';
          } else {
            invoice.status = 'unpaid';
          }
          await invoice.save();
        }
      }
    }
  }
}

/**
 * Record a sub-meter electricity reading and compute room tenant split
 * POST /api/meters/reading
 */
export const recordReading = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const orgId = req.orgId;
    if (!orgId) {
      throw new AppError('Organization context is required', 403);
    }
    const userId = req.user?.id;

    const validated = createMeterReadingSchema.parse(req.body);
    const {
      propertyId,
      roomId,
      meterIdentifier,
      previousReading,
      currentReading,
      ratePaisePerUnit,
      readingDate,
      previousReadingDate,
      currentReadingDate,
      billingMode = 'next_rent_invoice',
      photoUrl,
      splitMethod = 'by_days_occupied',
    } = validated;

    const property = await Property.findOne({ _id: propertyId, organization: orgId });
    if (!property) {
      throw new AppError('Property not found or does not belong to your organization', 404);
    }

    const room = await Room.findOne({ _id: roomId, property: propertyId, organization: orgId });
    if (!room) {
      throw new AppError('Room not found or does not belong to this property', 404);
    }

    const unitsConsumed = currentReading - previousReading;
    const effectiveRatePaise = ratePaisePerUnit ?? property.electricityRatePaisePerUnit ?? 0;
    const totalAmountPaise = Math.round(unitsConsumed * effectiveRatePaise);

    // Reading window
    const windowEnd = currentReadingDate
      ? new Date(currentReadingDate)
      : readingDate
        ? new Date(readingDate)
        : new Date();
    const windowStart = previousReadingDate
      ? new Date(previousReadingDate)
      : new Date(windowEnd.getFullYear(), windowEnd.getMonth(), 1);

    // Find all active, notice, and historical occupants in this room during the window
    const occupantDays = await getRoomOccupancyForWindow(roomId, orgId, windowStart, windowEnd);

    const tenantSplits: Array<{
      tenant: mongoose.Types.ObjectId;
      daysOccupied: number;
      sharePaise: number;
      status: 'pending_billing' | 'invoiced';
      billingPeriod?: { from: Date; to: Date };
    }> = [];

    if (occupantDays.length > 0 && totalAmountPaise > 0) {
      if (splitMethod === 'equal') {
        const count = occupantDays.length;
        const baseShare = Math.floor(totalAmountPaise / count);
        let remainder = totalAmountPaise % count;

        occupantDays.forEach(od => {
          const share = baseShare + (remainder > 0 ? 1 : 0);
          if (remainder > 0) remainder--;

          tenantSplits.push({
            tenant: od.tenantId,
            daysOccupied: od.days,
            sharePaise: share,
            status: billingMode === 'separate_invoice' ? 'invoiced' : 'pending_billing',
            billingPeriod: { from: windowStart, to: windowEnd },
          });
        });
      } else {
        // By days occupied (Default & Recommended)
        const totalDays = occupantDays.reduce((sum, od) => sum + od.days, 0);
        let allocatedPaise = 0;

        // Sort descending by days so remainder paise goes to occupants with most days
        const sortedOccupants = [...occupantDays].sort((a, b) => b.days - a.days);

        sortedOccupants.forEach((od, idx) => {
          const isLast = idx === sortedOccupants.length - 1;
          const share = isLast
            ? totalAmountPaise - allocatedPaise
            : Math.round((totalAmountPaise * od.days) / totalDays);
          allocatedPaise += share;

          tenantSplits.push({
            tenant: od.tenantId,
            daysOccupied: od.days,
            sharePaise: share,
            status: billingMode === 'separate_invoice' ? 'invoiced' : 'pending_billing',
            billingPeriod: { from: windowStart, to: windowEnd },
          });
        });
      }
    }

    const reading = await MeterReading.create({
      organization: orgId,
      property: propertyId,
      room: roomId,
      meterIdentifier: meterIdentifier || `Room ${room.roomNumber} Meter`,
      previousReading,
      currentReading,
      unitsConsumed,
      ratePaisePerUnit: effectiveRatePaise,
      totalAmountPaise,
      readingDate: windowEnd,
      previousReadingDate: windowStart,
      currentReadingDate: windowEnd,
      billingMode,
      photoUrl,
      splitMethod,
      tenantSplits,
      recordedBy: userId ? new mongoose.Types.ObjectId(userId) : undefined,
    });

    // Synchronize electricity line items with monthly invoices for room occupants
    await syncMeterReadingToInvoices(reading, orgId);
    await reading.save();

    res.status(201).json({
      success: true,
      message: `Meter reading recorded. ${unitsConsumed} units consumed (₹${(totalAmountPaise / 100).toFixed(2)}) split across ${tenantSplits.length} tenant(s).`,
      data: reading,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List meter readings
 * GET /api/meters/readings
 */
export const getReadings = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const orgId = req.orgId;
    const { propertyId, roomId } = req.query;

    const query: Record<string, unknown> = { organization: orgId };
    if (
      propertyId &&
      typeof propertyId === 'string' &&
      mongoose.Types.ObjectId.isValid(propertyId)
    ) {
      query.property = propertyId;
    }
    if (roomId && typeof roomId === 'string' && mongoose.Types.ObjectId.isValid(roomId)) {
      query.room = roomId;
    }

    const readings = await MeterReading.find(query)
      .populate('property', 'name code')
      .populate('room', 'roomNumber floorNumber')
      .populate('tenantSplits.tenant', 'fullName phone')
      .sort({ readingDate: -1 });

    res.status(200).json({
      success: true,
      data: readings,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get latest meter reading for a specific room to pre-fill previous reading
 * GET /api/meters/room/:roomId/latest
 */
export const getLatestRoomReading = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { roomId } = req.params;
    const orgId = req.orgId;

    if (!roomId || !mongoose.Types.ObjectId.isValid(roomId)) {
      throw new AppError('Invalid room ID format', 400);
    }

    const latest = await MeterReading.findOne({ room: roomId, organization: orgId }).sort({
      readingDate: -1,
    });

    res.status(200).json({
      success: true,
      data: latest,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update an existing meter reading and recalculate tenant splits
 * PUT /api/meters/reading/:id
 */
export const updateReading = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    if (!orgId) {
      throw new AppError('Organization context is required', 403);
    }

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid meter reading ID format', 400);
    }

    const reading = await MeterReading.findOne({ _id: id, organization: orgId });
    if (!reading) {
      throw new AppError('Meter reading not found', 404);
    }

    const validated = updateMeterReadingSchema.parse(req.body);

    const prevReading =
      validated.previousReading !== undefined ? validated.previousReading : reading.previousReading;
    const currReading =
      validated.currentReading !== undefined ? validated.currentReading : reading.currentReading;

    if (currReading < prevReading) {
      throw new AppError(
        `Current reading (${currReading}) cannot be lower than previous reading (${prevReading})`,
        400,
      );
    }

    const property = await Property.findOne({ _id: reading.property, organization: orgId });
    const effectiveRatePaise =
      validated.ratePaisePerUnit ??
      reading.ratePaisePerUnit ??
      property?.electricityRatePaisePerUnit ??
      0;
    const splitMethod = validated.splitMethod ?? reading.splitMethod;
    const unitsConsumed = currReading - prevReading;
    const totalAmountPaise = Math.round(unitsConsumed * effectiveRatePaise);

    const windowEnd = validated.currentReadingDate
      ? new Date(validated.currentReadingDate)
      : validated.readingDate
        ? new Date(validated.readingDate)
        : reading.currentReadingDate || reading.readingDate;
    const windowStart = validated.previousReadingDate
      ? new Date(validated.previousReadingDate)
      : reading.previousReadingDate ||
        new Date(windowEnd.getFullYear(), windowEnd.getMonth(), 1);

    const billingMode = validated.billingMode ?? reading.billingMode ?? 'next_rent_invoice';

    // Recalculate tenant splits across occupants during the window
    const occupantDays = await getRoomOccupancyForWindow(
      reading.room,
      orgId,
      windowStart,
      windowEnd,
    );

    const tenantSplits: Array<{
      tenant: mongoose.Types.ObjectId;
      daysOccupied: number;
      sharePaise: number;
      status: 'pending_billing' | 'invoiced';
      billingPeriod?: { from: Date; to: Date };
    }> = [];

    if (occupantDays.length > 0 && totalAmountPaise > 0) {
      if (splitMethod === 'equal') {
        const count = occupantDays.length;
        const baseShare = Math.floor(totalAmountPaise / count);
        let remainder = totalAmountPaise % count;

        occupantDays.forEach(od => {
          const share = baseShare + (remainder > 0 ? 1 : 0);
          if (remainder > 0) remainder--;

          tenantSplits.push({
            tenant: od.tenantId,
            daysOccupied: od.days,
            sharePaise: share,
            status: billingMode === 'separate_invoice' ? 'invoiced' : 'pending_billing',
            billingPeriod: { from: windowStart, to: windowEnd },
          });
        });
      } else {
        const totalDays = occupantDays.reduce((sum, od) => sum + od.days, 0);
        let allocatedPaise = 0;
        const sortedOccupants = [...occupantDays].sort((a, b) => b.days - a.days);

        sortedOccupants.forEach((od, idx) => {
          const isLast = idx === sortedOccupants.length - 1;
          const share = isLast
            ? totalAmountPaise - allocatedPaise
            : Math.round((totalAmountPaise * od.days) / totalDays);
          allocatedPaise += share;

          tenantSplits.push({
            tenant: od.tenantId,
            daysOccupied: od.days,
            sharePaise: share,
            status: billingMode === 'separate_invoice' ? 'invoiced' : 'pending_billing',
            billingPeriod: { from: windowStart, to: windowEnd },
          });
        });
      }
    }

    if (validated.meterIdentifier !== undefined)
      reading.meterIdentifier = validated.meterIdentifier;
    reading.previousReading = prevReading;
    reading.currentReading = currReading;
    reading.unitsConsumed = unitsConsumed;
    reading.ratePaisePerUnit = effectiveRatePaise;
    reading.totalAmountPaise = totalAmountPaise;
    reading.splitMethod = splitMethod;
    reading.previousReadingDate = windowStart;
    reading.currentReadingDate = windowEnd;
    reading.billingMode = billingMode;
    reading.tenantSplits = tenantSplits as any;
    if (validated.readingDate) reading.readingDate = new Date(validated.readingDate);
    if (validated.photoUrl !== undefined) reading.photoUrl = validated.photoUrl;

    // Synchronize updated electricity line items with monthly invoices for room occupants
    await syncMeterReadingToInvoices(reading, orgId);
    await reading.save();

    res.status(200).json({
      success: true,
      message: 'Meter reading updated successfully',
      data: reading,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a meter reading
 * DELETE /api/meters/reading/:id
 */
export const deleteReading = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    if (!orgId) {
      throw new AppError('Organization context is required', 403);
    }

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid meter reading ID format', 400);
    }

    const reading = await MeterReading.findOne({ _id: id, organization: orgId });
    if (!reading) {
      throw new AppError('Meter reading not found', 404);
    }

    // Remove electricity line items from tenant invoices
    await removeMeterReadingFromInvoices(reading, orgId);
    await MeterReading.deleteOne({ _id: id, organization: orgId });

    res.status(200).json({
      success: true,
      message: 'Meter reading deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
