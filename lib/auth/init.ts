import { prisma } from "../db/prisma.js";
import { hashPassword } from "./password.js";
import { Role, UserStatus } from "@prisma/client";

export const PRIMARY_ADMIN_EMAIL = "admin@metadata-checker.com";
export const PRIMARY_ADMIN_PASSWORD = "AdminPassword123!";
export const DEMO_ADMIN_EMAIL = "admin@example.com";
export const DEFAULT_ADMIN_EMAIL = "admin@metadata-checker.local";
export const DEFAULT_USER_EMAIL = "user@metadata-checker.local";
export const SEED_ADMIN_BANK_EMAIL = "admin@bank.com";
export const SEED_USER_BANK_EMAIL = "user@bank.com";
export const SYSTEM_USER_EMAIL = "system@metadata-checker.local";

let adminBootstrapped = false;

/**
 * Ensures the PostgreSQL UserStatus enum supports PENDING and that the
 * primary administrator credentials exist and are ACTIVE in the database.
 */
export async function ensureDefaultAdminExists(): Promise<void> {
  if (adminBootstrapped) return;

  try {
    // 1. Ensure PENDING exists in PostgreSQL UserStatus enum
    await prisma.$executeRawUnsafe(
      `ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'PENDING'`
    ).catch(() => {});

    const configuredAdminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const configuredAdminPassword = process.env.ADMIN_PASSWORD || PRIMARY_ADMIN_PASSWORD;

    const primaryAdminHash = await hashPassword(PRIMARY_ADMIN_PASSWORD);

    const adminEmails = [PRIMARY_ADMIN_EMAIL, DEMO_ADMIN_EMAIL];
    for (const email of adminEmails) {
      await prisma.user.upsert({
        where: { email },
        update: {
          role: Role.ADMIN,
          status: UserStatus.ACTIVE,
        },
        create: {
          email,
          name: "Super Administrator",
          role: Role.ADMIN,
          status: UserStatus.ACTIVE,
          passwordHash: primaryAdminHash,
        },
      });
    }

    if (configuredAdminEmail && !adminEmails.includes(configuredAdminEmail)) {
      const customHash = await hashPassword(configuredAdminPassword);
      await prisma.user.upsert({
        where: { email: configuredAdminEmail },
        update: {
          role: Role.ADMIN,
          status: UserStatus.ACTIVE,
        },
        create: {
          email: configuredAdminEmail,
          name: "Administrator",
          role: Role.ADMIN,
          status: UserStatus.ACTIVE,
          passwordHash: customHash,
        },
      });
    }

    adminBootstrapped = true;
  } catch (err) {
    console.error("[ENSURE_ADMIN_ERROR]", err);
  }
}

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
    await ensureDefaultAdminExists();

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
