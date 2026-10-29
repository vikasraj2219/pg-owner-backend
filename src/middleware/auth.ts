import { Response, NextFunction } from 'express';
import { AppError } from './errorHandler';
import { verifyToken } from '../services/token.service';
import { User } from '../models/User';
import { AuthenticatedRequest } from '../types';

export const protect = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    let token: string | undefined;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    if (!token) {
      throw new AppError('Authentication required. Please sign in.', 401);
    }

    // Verify token
    const decoded = verifyToken(token);

    // Verify user exists and is active
    const user = await User.findById(decoded.userId).select('+status');
    if (!user) {
      throw new AppError('The user belonging to this token no longer exists.', 401);
    }

    if (user.status !== 'active') {
      throw new AppError('Your account has been deactivated. Please contact support.', 403);
    }

    // Attach to request
    req.user = {
      id: user._id.toString(),
      email: user.email,
      phone: user.phone,
      role: user.role,
      orgId: user.organization.toString(),
    };
    req.orgId = user.organization.toString();

    next();
  } catch (error) {
    next(error);
  }
};

export const requireRole = (...roles: Array<'owner' | 'manager' | 'staff'>) => {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new AppError('Forbidden: You do not have permission to perform this action', 403);
    }
    next();
  };
};

