import type { Prisma } from "@prisma/client";

/**
 * Excel styling constants for a polished, professional workbook.
 * Palette: Deep Slate Navy, Crisp Neutral, Subtle Accents.
 */
export const EXCEL_STYLES = {
  font: {
    family: "Calibri",
    headerSize: 11,
    titleSize: 15,
    subtitleSize: 10,
    bodySize: 10,
    headerColor: { argb: "FFFFFFFF" },
    titleColor: { argb: "FF0F172A" },
    subtitleColor: { argb: "FF475569" },
  },
  fills: {
    primaryHeader: {
      type: "pattern" as const,
      pattern: "solid" as const,
      fgColor: { argb: "FF1E293B" }, // Slate 800
    },
    subHeader: {
      type: "pattern" as const,
      pattern: "solid" as const,
      fgColor: { argb: "FF334155" }, // Slate 700
    },
    sectionBanner: {
      type: "pattern" as const,
      pattern: "solid" as const,
      fgColor: { argb: "FFF1F5F9" }, // Slate 100
    },
    zebraRow: {
      type: "pattern" as const,
      pattern: "solid" as const,
      fgColor: { argb: "FFF8FAFC" }, // Slate 50
    },
    badgeValid: {
      type: "pattern" as const,
      pattern: "solid" as const,
      fgColor: { argb: "FFDCFCE7" }, // Emerald 100
    },
    badgeReview: {
      type: "pattern" as const,
      pattern: "solid" as const,
      fgColor: { argb: "FFFEF3C7" }, // Amber 100
    },
    badgeFailed: {
      type: "pattern" as const,
      pattern: "solid" as const,
      fgColor: { argb: "FFFEE2E2" }, // Rose 100
    },
  },
  borders: {
    thinBorder: {
      top: { style: "thin" as const, color: { argb: "FFE2E8F0" } },
      bottom: { style: "thin" as const, color: { argb: "FFE2E8F0" } },
      left: { style: "thin" as const, color: { argb: "FFE2E8F0" } },
      right: { style: "thin" as const, color: { argb: "FFE2E8F0" } },
    },
    headerBorder: {
      top: { style: "medium" as const, color: { argb: "FF0F172A" } },
      bottom: { style: "medium" as const, color: { argb: "FF0F172A" } },
      left: { style: "thin" as const, color: { argb: "FF334155" } },
      right: { style: "thin" as const, color: { argb: "FF334155" } },
    },
    summarySectionBorder: {
      top: { style: "thin" as const, color: { argb: "FFCBD5E1" } },
      bottom: { style: "thin" as const, color: { argb: "FFCBD5E1" } },
    },
  },
  numberFormats: {
    financial: "#,##0.00",
    financialWithCurrency: '"Rp"#,##0.00',
    integer: "#,##0",
    date: "yyyy-mm-dd",
    datetime: "yyyy-mm-dd hh:mm:ss",
  },
};

/**
 * Safely converts a Prisma Decimal or string into a numeric value for Excel.
 * Does not perform floating-point arithmetic recalculations.
 */
export function toExcelNumeric(
  val: Prisma.Decimal | number | string | null | undefined
): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") {
    return isNaN(val) ? null : val;
  }
  const str = typeof val === "string" ? val.trim() : val.toString().trim();
  if (str === "" || str === "-" || str.toLowerCase() === "null") return null;

  // Handle formatted strings with thousand separators e.g. 1,234.56 or 1.234,56
  let cleanStr = str;
  if (/^[\d,.]+(\.\d+)?$/.test(cleanStr)) {
    if (cleanStr.includes(",") && cleanStr.includes(".")) {
      if (cleanStr.lastIndexOf(".") > cleanStr.lastIndexOf(",")) {
        // e.g. 1,234.56
        cleanStr = cleanStr.replace(/,/g, "");
      } else {
        // e.g. 1.234,56
        cleanStr = cleanStr.replace(/\./g, "").replace(",", ".");
      }
    } else if (cleanStr.includes(",") && /,\d{3}/.test(cleanStr)) {
      cleanStr = cleanStr.replace(/,/g, "");
    }
  }

  const parsed = parseFloat(cleanStr);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Safely converts an ISO date string or Date object into a JavaScript Date for Excel.
 */
export function toExcelDate(val: string | Date | null | undefined): Date | null {
  if (!val) return null;
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? null : val;
  }
  const trimmed = val.trim();
  if (!trimmed) return null;

  // Handle YYYY-MM-DD cleanly without timezone shifts
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    return new Date(Date.UTC(year, month, day));
  }

  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Enforces account number masking.
 * Strictly guarantees that no 8-16 digit unmasked account number is ever placed into Excel.
 */
export function enforceMaskedAccountNumber(val?: string | null): string {
  if (!val || !val.trim()) return "Not available";
  const trimmed = val.trim();

  // If already masked (contains * or x or X)
  if (/[*xX]/.test(trimmed)) {
    return trimmed;
  }

  // If unmasked account number with 6 or more digits, mask it
  const digitsOnly = trimmed.replace(/\D/g, "");
  if (digitsOnly.length >= 6) {
    const start = digitsOnly.slice(0, 2);
    const end = digitsOnly.slice(-4);
    return `${start}******${end}`;
  }

  return trimmed;
}

/**
 * Generates a clean, safe, sanitized filename for the exported .xlsx file.
 * Format examples:
 * - BCA_Statement_August_2026.xlsx
 * - Bank_Mandiri_Statement_2026_08.xlsx
 * - METADATA_CHECKER_abc12345.xlsx
 */
export function generateSafeExportFileName(
  bankName?: string | null,
  periodStart?: Date | null,
  periodEnd?: Date | null,
  documentId?: string
): string {
  let bankPart = "Statement";
  if (bankName && bankName.trim()) {
    const cleanBank = bankName
      .trim()
      .replace(/bank\s+/i, "")
      .replace(/\s*\(.*?\)\s*/g, "")
      .replace(/[^a-zA-Z0-9]/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^_|_$/g, "");
    if (cleanBank) {
      bankPart = `${cleanBank}_Statement`;
    }
  }

  let periodPart = "";
  if (periodStart && !isNaN(periodStart.getTime())) {
    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const month = monthNames[periodStart.getUTCMonth()];
    const year = periodStart.getUTCFullYear();
    periodPart = `_${month}_${year}`;
  } else if (documentId) {
    const shortId = documentId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
    periodPart = `_${shortId}`;
  }

  const safeFileName = `${bankPart}${periodPart}.xlsx`
    .replace(/\.\./g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_");

  return safeFileName;
}

/**
 * Sanitizes strings to strictly prevent storage tokens, DB URLs, or server paths
 * from leaking into workbook cells, and neutralizes Excel formula injection (CWE-1236).
 */
export function sanitizeWorkbookText(text?: string | null): string {
  if (!text) return "";
  let clean = text
    .replace(/postgresql:\/\/[^\s"'<>]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/postgres:\/\/[^\s"'<>]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/vercel_blob_rw_[a-zA-Z0-9_]+/gi, "[REDACTED_BLOB_TOKEN]")
    .replace(/BLOB_READ_WRITE_TOKEN[=:\s]+[^\s"']+/gi, "[REDACTED_SECRET]")
    .replace(/AUTH_SECRET[=:\s]+[^\s"']+/gi, "[REDACTED_SECRET]")
    .replace(/\/home\/[a-zA-Z0-9_/-]+/gi, "[REDACTED_PATH]")
    .replace(/\/var\/[a-zA-Z0-9_/-]+/gi, "[REDACTED_PATH]");

  // Formula injection defense (CSV / Excel Formula Injection CWE-1236):
  // If string starts with =, +, -, @, or tab/return, prepend a single quote (') so Excel treats it strictly as text.
  if (/^[=+\-@\t\r]/.test(clean)) {
    clean = `'${clean}`;
  }

  return clean;
}
