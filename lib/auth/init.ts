import { prisma } from "../db/prisma";
import { hashPassword } from "./password";
import { Role, UserStatus } from "@prisma/client";

export const DEFAULT_ADMIN_EMAIL = "admin@metadata-checker.local";
export const DEFAULT_USER_EMAIL = "user@metadata-checker.local";
export const SEED_ADMIN_BANK_EMAIL = "admin@bank.com";
export const SEED_USER_BANK_EMAIL = "user@bank.com";
export const SYSTEM_USER_EMAIL = "system@metadata-checker.local";

/**
 * Initializes baseline administrative and standard test accounts in PostgreSQL
 * with securely hashed passwords.
 *
 * CRITICAL SECURITY REQUIREMENT:
 * - May exist ONLY in development/test environments.
 * - NEVER automatically created in production (NODE_ENV === "production").
 */
export async function seedInitialUsers(): Promise<{ seeded: boolean; reason?: string }> {
  if (process.env.NODE_ENV === "production") {
    return { seeded: false, reason: "Production mode: seed accounts are strictly forbidden." };
  }

  try {
    // 1. Ensure system user is preserved
    await prisma.user.upsert({
      where: { email: SYSTEM_USER_EMAIL },
      update: {},
      create: {
        email: SYSTEM_USER_EMAIL,
        name: "System User",
        role: Role.USER,
        status: UserStatus.ACTIVE,
      },
    });

    // 2. Default dev admin accounts
    const adminPasswordHash = await hashPassword("Admin123!");
    for (const email of [DEFAULT_ADMIN_EMAIL, SEED_ADMIN_BANK_EMAIL]) {
      await prisma.user.upsert({
        where: { email },
        update: {},
        create: {
          email,
          name: "Administrator",
          role: Role.ADMIN,
          status: UserStatus.ACTIVE,
          passwordHash: adminPasswordHash,
        },
      });
    }

    // 3. Default dev regular user accounts
    const userPasswordHash = await hashPassword("User123!");
    for (const email of [DEFAULT_USER_EMAIL, SEED_USER_BANK_EMAIL]) {
      await prisma.user.upsert({
        where: { email },
        update: {},
        create: {
          email,
          name: "Analyst User",
          role: Role.USER,
          status: UserStatus.ACTIVE,
          passwordHash: userPasswordHash,
        },
      });
    }

    return { seeded: true };
  } catch (err) {
    console.error("[SEED_USERS_ERROR]", err);
    return { seeded: false, reason: err instanceof Error ? err.message : "Unknown error" };
  }
}
