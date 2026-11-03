import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { AuthenticatedRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { User, Property } from '../models';
import { createTeamMemberSchema, updateTeamMemberSchema } from '../validators/team.validator';

/**
 * List all team members within the organization
 * GET /api/team/members
 */
export const getTeamMembers = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const orgId = req.orgId;
    if (!orgId) throw new AppError('Organization context required', 403);

    const members = await User.find({ organization: orgId })
      .select('-password')
      .populate('assignedProperties', 'name code address type')
      .sort({ role: 1, createdAt: 1 });

    res.status(200).json({
      success: true,
      data: members,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Invite or create a new manager/staff team member
 * POST /api/team/members
 */
export const createTeamMember = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const orgId = req.orgId;
    const currentUserRole = req.user?.role;

    if (!orgId) throw new AppError('Organization context required', 403);
    if (currentUserRole !== 'owner') {
      throw new AppError('Only organization owner can add team members', 403);
    }

    const validated = createTeamMemberSchema.parse(req.body);
    const { name, phone, email, password, role, assignedProperties } = validated;

    // Check duplicate email
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      throw new AppError('A user with this email already exists', 409);
    }

    // Check duplicate phone
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) {
      throw new AppError('A user with this phone number already exists', 409);
    }

    // Validate assignedProperties belong to orgId
    if (assignedProperties && assignedProperties.length > 0) {
      const validPropsCount = await Property.countDocuments({
        _id: { $in: assignedProperties },
        organization: orgId,
      });
      if (validPropsCount !== assignedProperties.length) {
        throw new AppError(
          'One or more assigned properties do not belong to your organization',
          400,
        );
      }
    }

    const member = await User.create({
      organization: orgId,
      name,
      phone,
      email,
      password,
      role,
      assignedProperties: assignedProperties
        ? assignedProperties.map(id => new mongoose.Types.ObjectId(id))
        : [],
      status: 'active',
    });

    const populated = await User.findById(member._id)
      .select('-password')
      .populate('assignedProperties', 'name code');

    res.status(201).json({
      success: true,
      message: `Team member ${name} (${role}) created successfully`,
      data: populated,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update an existing team member's role, status, or assigned properties
 * PUT /api/team/members/:id
 */
export const updateTeamMember = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    const currentUserRole = req.user?.role;

    if (!orgId) throw new AppError('Organization context required', 403);
    if (currentUserRole !== 'owner') {
      throw new AppError('Only organization owner can update team members', 403);
    }

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid member ID format', 400);
    }

    const member = await User.findOne({ _id: id, organization: orgId });
    if (!member) {
      throw new AppError('Team member not found', 404);
    }

    if (member.role === 'owner') {
      throw new AppError('Cannot modify organization owner via team management', 400);
    }

    const validated = updateTeamMemberSchema.parse(req.body);

    if (validated.assignedProperties) {
      const validPropsCount = await Property.countDocuments({
        _id: { $in: validated.assignedProperties },
        organization: orgId,
      });
      if (validPropsCount !== validated.assignedProperties.length) {
        throw new AppError(
          'One or more assigned properties do not belong to your organization',
          400,
        );
      }
      member.assignedProperties = validated.assignedProperties.map(
        pid => new mongoose.Types.ObjectId(pid),
      );
    }

    if (validated.name) member.name = validated.name;
    if (validated.phone) member.phone = validated.phone;
    if (validated.role) member.role = validated.role;
    if (validated.status) member.status = validated.status;

    await member.save();

    const updated = await User.findById(member._id)
      .select('-password')
      .populate('assignedProperties', 'name code');

    res.status(200).json({
      success: true,
      message: 'Team member updated successfully',
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Remove a team member
 * DELETE /api/team/members/:id
 */
export const removeTeamMember = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    const currentUserRole = req.user?.role;

    if (!orgId) throw new AppError('Organization context required', 403);
    if (currentUserRole !== 'owner') {
      throw new AppError('Only organization owner can remove team members', 403);
    }

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid member ID format', 400);
    }

    const member = await User.findOne({ _id: id, organization: orgId });
    if (!member) {
      throw new AppError('Team member not found', 404);
    }

    if (member.role === 'owner') {
      throw new AppError('Cannot delete organization owner', 400);
    }

    await User.findByIdAndDelete(member._id);

    res.status(200).json({
      success: true,
      message: `Team member ${member.name} removed successfully`,
    });
  } catch (error) {
    next(error);
  }
};
