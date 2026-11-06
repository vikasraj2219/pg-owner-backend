"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeTeamMember = exports.updateTeamMember = exports.createTeamMember = exports.getTeamMembers = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const errorHandler_1 = require("../middleware/errorHandler");
const models_1 = require("../models");
const team_validator_1 = require("../validators/team.validator");
/**
 * List all team members within the organization
 * GET /api/team/members
 */
const getTeamMembers = async (req, res, next) => {
    try {
        const orgId = req.orgId;
        if (!orgId)
            throw new errorHandler_1.AppError('Organization context required', 403);
        const members = await models_1.User.find({ organization: orgId })
            .select('-password')
            .populate('assignedProperties', 'name code address type')
            .sort({ role: 1, createdAt: 1 });
        res.status(200).json({
            success: true,
            data: members,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getTeamMembers = getTeamMembers;
/**
 * Invite or create a new manager/staff team member
 * POST /api/team/members
 */
const createTeamMember = async (req, res, next) => {
    try {
        const orgId = req.orgId;
        const currentUserRole = req.user?.role;
        if (!orgId)
            throw new errorHandler_1.AppError('Organization context required', 403);
        if (currentUserRole !== 'owner') {
            throw new errorHandler_1.AppError('Only organization owner can add team members', 403);
        }
        const validated = team_validator_1.createTeamMemberSchema.parse(req.body);
        const { name, phone, email, password, role, assignedProperties } = validated;
        // Check duplicate email
        const existingEmail = await models_1.User.findOne({ email });
        if (existingEmail) {
            throw new errorHandler_1.AppError('A user with this email already exists', 409);
        }
        // Check duplicate phone
        const existingPhone = await models_1.User.findOne({ phone });
        if (existingPhone) {
            throw new errorHandler_1.AppError('A user with this phone number already exists', 409);
        }
        // Validate assignedProperties belong to orgId
        if (assignedProperties && assignedProperties.length > 0) {
            const validPropsCount = await models_1.Property.countDocuments({
                _id: { $in: assignedProperties },
                organization: orgId,
            });
            if (validPropsCount !== assignedProperties.length) {
                throw new errorHandler_1.AppError('One or more assigned properties do not belong to your organization', 400);
            }
        }
        const member = await models_1.User.create({
            organization: orgId,
            name,
            phone,
            email,
            password,
            role,
            assignedProperties: assignedProperties
                ? assignedProperties.map(id => new mongoose_1.default.Types.ObjectId(id))
                : [],
            status: 'active',
        });
        const populated = await models_1.User.findById(member._id)
            .select('-password')
            .populate('assignedProperties', 'name code');
        res.status(201).json({
            success: true,
            message: `Team member ${name} (${role}) created successfully`,
            data: populated,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.createTeamMember = createTeamMember;
/**
 * Update an existing team member's role, status, or assigned properties
 * PUT /api/team/members/:id
 */
const updateTeamMember = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        const currentUserRole = req.user?.role;
        if (!orgId)
            throw new errorHandler_1.AppError('Organization context required', 403);
        if (currentUserRole !== 'owner') {
            throw new errorHandler_1.AppError('Only organization owner can update team members', 403);
        }
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid member ID format', 400);
        }
        const member = await models_1.User.findOne({ _id: id, organization: orgId });
        if (!member) {
            throw new errorHandler_1.AppError('Team member not found', 404);
        }
        if (member.role === 'owner') {
            throw new errorHandler_1.AppError('Cannot modify organization owner via team management', 400);
        }
        const validated = team_validator_1.updateTeamMemberSchema.parse(req.body);
        if (validated.assignedProperties) {
            const validPropsCount = await models_1.Property.countDocuments({
                _id: { $in: validated.assignedProperties },
                organization: orgId,
            });
            if (validPropsCount !== validated.assignedProperties.length) {
                throw new errorHandler_1.AppError('One or more assigned properties do not belong to your organization', 400);
            }
            member.assignedProperties = validated.assignedProperties.map(pid => new mongoose_1.default.Types.ObjectId(pid));
        }
        if (validated.name)
            member.name = validated.name;
        if (validated.phone) {
            if (validated.phone !== member.phone) {
                const dupPhone = await models_1.User.findOne({ phone: validated.phone, _id: { $ne: member._id } });
                if (dupPhone) {
                    throw new errorHandler_1.AppError('A user with this phone number already exists', 409);
                }
            }
            member.phone = validated.phone;
        }
        if (validated.email) {
            if (validated.email !== member.email) {
                const dupEmail = await models_1.User.findOne({ email: validated.email, _id: { $ne: member._id } });
                if (dupEmail) {
                    throw new errorHandler_1.AppError('A user with this email already exists', 409);
                }
            }
            member.email = validated.email;
        }
        if (validated.password) {
            member.password = validated.password;
        }
        if (validated.role)
            member.role = validated.role;
        if (validated.status)
            member.status = validated.status;
        await member.save();
        const updated = await models_1.User.findById(member._id)
            .select('-password')
            .populate('assignedProperties', 'name code');
        res.status(200).json({
            success: true,
            message: 'Team member updated successfully',
            data: updated,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.updateTeamMember = updateTeamMember;
/**
 * Remove a team member
 * DELETE /api/team/members/:id
 */
const removeTeamMember = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        const currentUserRole = req.user?.role;
        if (!orgId)
            throw new errorHandler_1.AppError('Organization context required', 403);
        if (currentUserRole !== 'owner') {
            throw new errorHandler_1.AppError('Only organization owner can remove team members', 403);
        }
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid member ID format', 400);
        }
        const member = await models_1.User.findOne({ _id: id, organization: orgId });
        if (!member) {
            throw new errorHandler_1.AppError('Team member not found', 404);
        }
        if (member.role === 'owner') {
            throw new errorHandler_1.AppError('Cannot delete organization owner', 400);
        }
        await models_1.User.findByIdAndDelete(member._id);
        res.status(200).json({
            success: true,
            message: `Team member ${member.name} removed successfully`,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.removeTeamMember = removeTeamMember;
