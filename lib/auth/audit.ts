import { prisma } from "../db/prisma";
import type { Prisma } from "@prisma/client";

export interface LogAuditOptions {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Sanitizes metadata to strictly exclude sensitive secrets or unmasked credentials.
 * Explicitly guards against passwords, hashes, session tokens, env secrets, and masks account numbers.
 */
export function sanitizeAuditMetadata(meta?: Record<string, unknown> | null): Record<string, unknown> | undefined {
  if (!meta) return undefined;

  const sanitized: Record<string, unknown> = {};
  const forbiddenKeys = new Set([
    "password",
    "passwordhash",
    "token",
    "sessiontoken",
    "secret",
    "authsecret",
    "auth_secret",
    "cookie",
    "rawmetadatajson",
    "rawfinancialstatement",
    "rawfinancialstatementcontent",
    "apikey",
    "privatekey",
    "databaseurl",
    "directurl",
    "blobreadwritetoken",
    "authorization",
  ]);

  for (const [k, v] of Object.entries(meta)) {
    const lowerKey = k.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (forbiddenKeys.has(lowerKey)) {
      continue; // exclude sensitive keys entirely
    }

    // Mask account numbers if detected
    if (
      (lowerKey.includes("accountnumber") ||
        lowerKey.includes("accnumber") ||
        lowerKey.includes("bankaccount") ||
        lowerKey.includes("accountno")) &&
      (typeof v === "string" || typeof v === "number")
    ) {
      const strVal = String(v);
      sanitized[k] = strVal.length > 4 ? `****${strVal.slice(-4)}` : "****";
    } else if (typeof v === "string") {
      // Redact sensitive connection URLs or tokens inside strings
      if (v.includes("postgresql://") || v.includes("postgres://") || v.includes("Bearer ")) {
        sanitized[k] = "[REDACTED_SECRET]";
      } else {
        sanitized[k] = v;
      }
    } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      sanitized[k] = sanitizeAuditMetadata(v as Record<string, unknown>);
    } else {
      sanitized[k] = v;
    }
  }

  return sanitized;
}

/**
 * Records a server-side audit event to PostgreSQL.
 * Designed to never throw or break critical API paths.
 */
export async function logAuditEvent(options: LogAuditOptions): Promise<void> {
  try {
    const cleanMeta = sanitizeAuditMetadata(options.metadata);

    await prisma.auditLog.create({
      data: {
        userId: options.userId ?? null,
        action: options.action,
        entityType: options.entityType,
        entityId: options.entityId ?? null,
        metadata: cleanMeta as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (err: unknown) {
    // Non-fatal: log warning to console in dev
    if (process.env.NODE_ENV !== "production") {
      console.warn("[AUDIT_LOG_ERROR]", err instanceof Error ? err.message : err);
    }
  }
}
