"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMe = exports.login = exports.registerOwner = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const auth_validator_1 = require("../validators/auth.validator");
const Organization_1 = require("../models/Organization");
const User_1 = require("../models/User");
const Subscription_1 = require("../models/Subscription");
const token_service_1 = require("../services/token.service");
const errorHandler_1 = require("../middleware/errorHandler");
const registerOwner = async (req, res, next) => {
    try {
        const input = auth_validator_1.registerOwnerSchema.parse(req.body);
        // 1. Check for existing user with identical email or phone
        const existingUser = await User_1.User.findOne({
            $or: [{ email: input.email }, { phone: input.phone }],
        });
        if (existingUser) {
            if (existingUser.email === input.email) {
                throw new errorHandler_1.AppError('An account with this email address already exists', 409);
            }
            throw new errorHandler_1.AppError('An account with this phone number already exists', 409);
        }
        // 2. Multi-document transaction if replica set is active
        let session = null;
        try {
            session = await mongoose_1.default.startSession();
            session.startTransaction();
        }
        catch (_sessionErr) {
            // In standalone dev or environments where replica sets are not available
            session = null;
        }
        try {
            const sessionOpts = session ? { session } : {};
            // A. Create Organization
            const orgDocs = await Organization_1.Organization.create([
                {
                    name: input.orgName,
                    ownerName: input.ownerName,
                    phone: input.phone,
                    email: input.email,
                },
            ], sessionOpts);
            const organization = orgDocs[0];
            if (!organization) {
                throw new errorHandler_1.AppError('Failed to initialize organization record', 500);
            }
            // B. Create User (Owner)
            const userDocs = await User_1.User.create([
                {
                    organization: organization._id,
                    name: input.ownerName,
                    email: input.email,
                    phone: input.phone,
                    password: input.password,
                    role: 'owner',
                    status: 'active',
                },
            ], sessionOpts);
            const user = userDocs[0];
            if (!user) {
                throw new errorHandler_1.AppError('Failed to initialize owner user record', 500);
            }
            // C. Create Subscription (Starter Plan - 14-day free trial)
            const now = new Date();
            const trialEndsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
            const subDocs = await Subscription_1.Subscription.create([
                {
                    organization: organization._id,
                    plan: 'starter',
                    status: 'trialing',
                    trialEndsAt,
                    currentPeriodEnd: trialEndsAt,
                    maxProperties: Subscription_1.PLAN_LIMITS.starter.maxProperties,
                    maxBeds: Subscription_1.PLAN_LIMITS.starter.maxBeds,
                },
            ], sessionOpts);
            const subscription = subDocs[0];
            if (session) {
                await session.commitTransaction();
            }
            // D. Generate JWT Token
            const token = (0, token_service_1.generateToken)({
                userId: user._id.toString(),
                email: user.email,
                role: user.role,
                orgId: organization._id.toString(),
            });
            res.status(201).json({
                success: true,
                message: 'Owner registered successfully. 14-day free trial started.',
                data: {
                    token,
                    user: {
                        id: user._id.toString(),
                        name: user.name,
                        email: user.email,
                        phone: user.phone,
                        role: user.role,
                    },
                    organization: {
                        id: organization._id.toString(),
                        name: organization.name,
                        ownerName: organization.ownerName,
                        phone: organization.phone,
                        email: organization.email,
                        settings: organization.settings,
                    },
                    subscription: {
                        plan: subscription?.plan || 'starter',
                        status: subscription?.status || 'trialing',
                        trialEndsAt: subscription?.trialEndsAt,
                        currentPeriodEnd: subscription?.currentPeriodEnd,
                        maxProperties: subscription?.maxProperties || 1,
                        maxBeds: subscription?.maxBeds || 30,
                    },
                },
            });
        }
        catch (transactionError) {
            if (session && session.inTransaction()) {
                await session.abortTransaction();
            }
            throw transactionError;
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
exports.registerOwner = registerOwner;
const login = async (req, res, next) => {
    try {
        const input = auth_validator_1.loginSchema.parse(req.body);
        const identifier = input.identifier.trim();
        const isEmail = identifier.includes('@');
        // 1. Find user by email or phone, explicitly selecting password
        const user = await User_1.User.findOne(isEmail ? { email: identifier.toLowerCase() } : { phone: identifier }).select('+password');
        if (!user) {
            throw new errorHandler_1.AppError('Invalid email/phone or password', 401);
        }
        // 2. Validate password
        const isMatch = await user.comparePassword(input.password);
        if (!isMatch) {
            throw new errorHandler_1.AppError('Invalid email/phone or password', 401);
        }
        // 3. Check if account is active
        if (user.status !== 'active') {
            throw new errorHandler_1.AppError('Your account has been deactivated. Please contact support.', 403);
        }
        // 4. Fetch associated Organization and Subscription
        const [organization, subscription] = await Promise.all([
            Organization_1.Organization.findById(user.organization),
            Subscription_1.Subscription.findOne({ organization: user.organization }),
        ]);
        if (!organization) {
            throw new errorHandler_1.AppError('Organization associated with this account not found', 404);
        }
        // 5. Generate JWT Token
        const token = (0, token_service_1.generateToken)({
            userId: user._id.toString(),
            email: user.email,
            role: user.role,
            orgId: organization._id.toString(),
        });
        res.status(200).json({
            success: true,
            message: 'Logged in successfully',
            data: {
                token,
                user: {
                    id: user._id.toString(),
                    name: user.name,
                    email: user.email,
                    phone: user.phone,
                    role: user.role,
                },
                organization: {
                    id: organization._id.toString(),
                    name: organization.name,
                    ownerName: organization.ownerName,
                    phone: organization.phone,
                    email: organization.email,
                    settings: organization.settings,
                },
                subscription: subscription
                    ? {
                        plan: subscription.plan,
                        status: subscription.status,
                        trialEndsAt: subscription.trialEndsAt,
                        currentPeriodEnd: subscription.currentPeriodEnd,
                        maxProperties: subscription.maxProperties,
                        maxBeds: subscription.maxBeds,
                        scheduledPlan: subscription.scheduledPlan || null,
                        scheduledPlanEffectiveAt: subscription.scheduledPlanEffectiveAt || null,
                    }
                    : null,
            },
        });
    }
    catch (error) {
        next(error);
    }
};
exports.login = login;
const getMe = async (req, res, next) => {
    try {
        if (!req.user) {
            throw new errorHandler_1.AppError('Authentication required', 401);
        }
        const [user, organization, subscription] = await Promise.all([
            User_1.User.findById(req.user.id),
            Organization_1.Organization.findById(req.user.orgId),
            Subscription_1.Subscription.findOne({ organization: req.user.orgId }),
        ]);
        if (!user || !organization) {
            throw new errorHandler_1.AppError('User profile or organization not found', 404);
        }
        res.status(200).json({
            success: true,
            data: {
                user: {
                    id: user._id.toString(),
                    name: user.name,
                    email: user.email,
                    phone: user.phone,
                    role: user.role,
                    status: user.status,
                    createdAt: user.createdAt,
                },
                organization: {
                    id: organization._id.toString(),
                    name: organization.name,
                    ownerName: organization.ownerName,
                    phone: organization.phone,
                    email: organization.email,
                    settings: organization.settings,
                },
                subscription: subscription
                    ? {
                        plan: subscription.plan,
                        status: subscription.status,
                        trialEndsAt: subscription.trialEndsAt,
                        currentPeriodEnd: subscription.currentPeriodEnd,
                        maxProperties: subscription.maxProperties,
                        maxBeds: subscription.maxBeds,
                        scheduledPlan: subscription.scheduledPlan || null,
                        scheduledPlanEffectiveAt: subscription.scheduledPlanEffectiveAt || null,
                    }
                    : null,
            },
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getMe = getMe;
