import { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  email: string;
  phone: string;
  role: 'owner' | 'manager' | 'staff';
  orgId: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  orgId?: string;
}

export interface TokenPayload {
  userId: string;
  email: string;
  role: 'owner' | 'manager' | 'staff';
  orgId: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  errors?: unknown;
}

export type Paise = number; // Integer paise: ₹1,000 = 100000 paise
