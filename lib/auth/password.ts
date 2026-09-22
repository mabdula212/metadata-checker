import bcrypt from "bcryptjs";
import { MIN_PASSWORD_LENGTH } from "./config";

const BCRYPT_SALT_ROUNDS = 12;

/**
 * Hashes a plaintext password using bcrypt with 12 salt rounds.
 * Plaintext passwords and hashes are never logged.
 */
export async function hashPassword(plainText: string): Promise<string> {
  if (!plainText || plainText.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
  }
  return await bcrypt.hash(plainText, BCRYPT_SALT_ROUNDS);
}

/**
 * Verifies a plaintext password against a stored bcrypt hash.
 * Constant-time comparison is handled by bcrypt internally.
 */
export async function verifyPassword(plainText: string, hash: string): Promise<boolean> {
  if (!plainText || !hash) {
    return false;
  }
  try {
    return await bcrypt.compare(plainText, hash);
  } catch {
    return false;
  }
}

/**
 * Validates password strength without storing or logging.
 */
export function validatePasswordStrength(password: string): { valid: boolean; reason?: string } {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return {
      valid: false,
      reason: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
    };
  }
  // Check for presence of at least one number or symbol for baseline strength
  if (!/[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    return {
      valid: false,
      reason: "Password must include at least one number or special character.",
    };
  }
  return { valid: true };
}
