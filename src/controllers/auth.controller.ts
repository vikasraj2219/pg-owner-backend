import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { registerOwnerSchema, loginSchema } from '../validators/auth.validator';
import { Organization } from '../models/Organization';
import { User } from '../models/User';
import { Subscription, PLAN_LIMITS } from '../models/Subscription';
import { generateToken } from '../services/token.service';
import { AppError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../types';

export const registerOwner = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input = registerOwnerSchema.parse(req.body);

    // 1. Check for existing user with identical email or phone
    const existingUser = await User.findOne({
      $or: [{ email: input.email }, { phone: input.phone }],
    });

    if (existingUser) {
      if (existingUser.email === input.email) {
        throw new AppError('An account with this email address already exists', 409);
      }
      throw new AppError('An account with this phone number already exists', 409);
    }

    // 2. Multi-document transaction if replica set is active
    let session: mongoose.ClientSession | null = null;
    try {
      session = await mongoose.startSession();
      session.startTransaction();
    } catch (_sessionErr) {
      // In standalone dev or environments where replica sets are not available
      session = null;
    }

    try {
      const sessionOpts = session ? { session } : {};

      // A. Create Organization
      const orgDocs = await Organization.create(
        [
          {
            name: input.orgName,
            ownerName: input.ownerName,
            phone: input.phone,
            email: input.email,
          },
        ],
        sessionOpts,
      );
      const organization = orgDocs[0];
      if (!organization) {
        throw new AppError('Failed to initialize organization record', 500);
      }

      // B. Create User (Owner)
      const userDocs = await User.create(
        [
          {
            organization: organization._id,
            name: input.ownerName,
            email: input.email,
            phone: input.phone,
            password: input.password,
            role: 'owner',
            status: 'active',
          },
        ],
        sessionOpts,
      );
      const user = userDocs[0];
      if (!user) {
        throw new AppError('Failed to initialize owner user record', 500);
      }

      // C. Create Subscription (Starter Plan - 14-day free trial)
      const now = new Date();
      const trialEndsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

      const subDocs = await Subscription.create(
        [
          {
            organization: organization._id,
            plan: 'starter',
            status: 'trialing',
            trialEndsAt,
            currentPeriodEnd: trialEndsAt,
            maxProperties: PLAN_LIMITS.starter.maxProperties,
            maxBeds: PLAN_LIMITS.starter.maxBeds,
          },
        ],
        sessionOpts,
      );
      const subscription = subDocs[0];

      if (session) {
        await session.commitTransaction();
      }

      // D. Generate JWT Token
      const token = generateToken({
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
    } catch (transactionError) {
      if (session && session.inTransaction()) {
        await session.abortTransaction();
      }
      throw transactionError;
    } finally {
      if (session) {
        await session.endSession();
      }
    }
  } catch (error) {
    next(error);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = loginSchema.parse(req.body);

    const identifier = input.identifier.trim();
    const isEmail = identifier.includes('@');

    // 1. Find user by email or phone, explicitly selecting password
    const user = await User.findOne(
      isEmail ? { email: identifier.toLowerCase() } : { phone: identifier },
    ).select('+password');

    if (!user) {
      throw new AppError('Invalid email/phone or password', 401);
    }

    // 2. Validate password
    const isMatch = await user.comparePassword(input.password);
    if (!isMatch) {
      throw new AppError('Invalid email/phone or password', 401);
    }

    // 3. Check if account is active
    if (user.status !== 'active') {
      throw new AppError('Your account has been deactivated. Please contact support.', 403);
    }

    // 4. Fetch associated Organization and Subscription
    const [organization, subscription] = await Promise.all([
      Organization.findById(user.organization),
      Subscription.findOne({ organization: user.organization }),
    ]);

    if (!organization) {
      throw new AppError('Organization associated with this account not found', 404);
    }

    // 5. Generate JWT Token
    const token = generateToken({
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
            }
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getMe = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      throw new AppError('Authentication required', 401);
    }

    const [user, organization, subscription] = await Promise.all([
      User.findById(req.user.id),
      Organization.findById(req.user.orgId),
      Subscription.findOne({ organization: req.user.orgId }),
    ]);

    if (!user || !organization) {
      throw new AppError('User profile or organization not found', 404);
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
            }
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
};
