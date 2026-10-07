import crypto from "crypto";
import type { IncomingMessage } from "http";
import { prisma } from "../db/prisma.js";
import { DEVICE_COOKIE_NAME } from "./config.js";
import { parseCookies } from "./session.js";

export interface ParsedDeviceMetadata {
  deviceName: string;
  browser: string;
  operatingSystem: string;
}

/**
 * Generates a cryptographically secure 256-bit random device token.
 * Raw token is only sent to the client cookie/storage; only its SHA-256 hash is persisted in PostgreSQL.
 */
export function generateDeviceToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Computes deterministic SHA-256 hash of a raw device token.
 */
export function hashDeviceToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Extracts raw device token from request headers, cookies, or body fallback.
 */
export function extractDeviceToken(
  req: IncomingMessage,
  bodyDeviceToken?: unknown
): string | null {
  // 1. Check X-Device-Token header
  const headerVal = req.headers["x-device-token"];
  if (typeof headerVal === "string" && headerVal.trim().length >= 32) {
    return headerVal.trim();
  }

  // 2. Check HttpOnly mc_device cookie
  const cookies = parseCookies(req);
  const cookieToken = cookies[DEVICE_COOKIE_NAME];
  if (cookieToken && cookieToken.trim().length >= 32) {
    return cookieToken.trim();
  }

  // 3. Check body fallback if provided
  if (typeof bodyDeviceToken === "string" && bodyDeviceToken.trim().length >= 32) {
    return bodyDeviceToken.trim();
  }

  return null;
}

/**
 * Parses User-Agent string into clean, human-readable Browser, OS, and Device Name.
 * Does not store or expose raw IP addresses.
 */
export function parseDeviceMetadata(userAgentHeader?: string | string[]): ParsedDeviceMetadata {
  const ua = Array.isArray(userAgentHeader)
    ? userAgentHeader.join(" ")
    : typeof userAgentHeader === "string"
    ? userAgentHeader
    : "";

  if (!ua.trim()) {
    return {
      browser: "Web Browser",
      operatingSystem: "Unknown OS",
      deviceName: "Web Browser on Unknown OS",
    };
  }

  // Detect Browser
  let browser = "Web Browser";
  if (/Edg\//i.test(ua) || /Edge\//i.test(ua)) {
    browser = "Microsoft Edge";
  } else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) {
    browser = "Opera";
  } else if (/Brave/i.test(ua)) {
    browser = "Brave";
  } else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) {
    browser = "Google Chrome";
  } else if (/Firefox\//i.test(ua)) {
    browser = "Mozilla Firefox";
  } else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) {
    browser = "Apple Safari";
  } else if (/Chromium\//i.test(ua)) {
    browser = "Chromium";
  } else if (/curl\//i.test(ua)) {
    browser = "CLI Client";
  } else if (/node/i.test(ua)) {
    browser = "Node Client";
  }

  // Detect Operating System
  let operatingSystem = "Unknown OS";
  if (/Windows NT 10\.0/i.test(ua)) {
    operatingSystem = "Windows";
  } else if (/Windows NT/i.test(ua) || /Windows/i.test(ua)) {
    operatingSystem = "Windows";
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    operatingSystem = "iOS";
  } else if (/Mac OS X|Macintosh/i.test(ua)) {
    operatingSystem = "macOS";
  } else if (/Android/i.test(ua)) {
    operatingSystem = "Android";
  } else if (/CrOS/i.test(ua)) {
    operatingSystem = "ChromeOS";
  } else if (/Linux/i.test(ua)) {
    operatingSystem = "Linux";
  }

  const deviceName = `${browser} on ${operatingSystem}`;
  return {
    deviceName,
    browser,
    operatingSystem,
  };
}

/**
 * Marks any PENDING login requests that have passed their expiresAt timestamp as EXPIRED.
 */
export async function expireStaleLoginRequests(userId?: string): Promise<void> {
  try {
    const now = new Date();
    await prisma.loginRequest.updateMany({
      where: {
        ...(userId ? { userId } : {}),
        status: "PENDING",
        expiresAt: { lt: now },
      },
      data: {
        status: "EXPIRED",
      },
    });
  } catch {
    // Non-fatal cleanup
  }
}
