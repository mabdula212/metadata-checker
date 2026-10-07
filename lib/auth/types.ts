import type { Role, UserStatus, DeviceStatus, LoginRequestStatus } from "@prisma/client";

export type { DeviceStatus, LoginRequestStatus };

export const DEVICE_AUDIT_ACTIONS = {
  DEVICE_LOGIN_REQUESTED: "DEVICE_LOGIN_REQUESTED",
  DEVICE_LOGIN_APPROVED: "DEVICE_LOGIN_APPROVED",
  DEVICE_LOGIN_REJECTED: "DEVICE_LOGIN_REJECTED",
  DEVICE_REVOKED: "DEVICE_REVOKED",
  SESSION_REVOKED: "SESSION_REVOKED",
  DEVICE_LOGIN_FAILED: "DEVICE_LOGIN_FAILED",
} as const;

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionInfo {
  sessionToken: string;
  userId: string;
  deviceId?: string | null;
  expiresAt: Date;
  user: AuthenticatedUser;
}

export interface LoginResult {
  success: boolean;
  user?: AuthenticatedUser;
  sessionToken?: string;
  error?: string;
}

export interface UserManagementItem {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: UserStatus;
  createdAt: string;
  documentCount: number;
}
