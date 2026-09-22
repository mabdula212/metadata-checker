import type { Role, UserStatus } from "@prisma/client";

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
