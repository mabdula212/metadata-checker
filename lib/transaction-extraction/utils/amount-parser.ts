/**
 * Safe financial amount parser for Indonesian and international bank statements.
 * Handles both Indonesian (dot as thousands, comma as decimal) and standard
 * English (comma as thousands, dot as decimal) notation with indicator detection.
 */

export interface ParsedAmountResult {
  /** Normalized monetary string in Decimal(18,2) e.g. "1250000.00" */
  value: string;
  /** Explicit indicator if found in raw amount string (e.g. "CR", "DB", "DR") */
  indicator: "CR" | "DB" | null;
  /** Whether the amount was explicitly marked negative */
  isNegative: boolean;
}

/**
 * Normalizes an arbitrary monetary string to a standard Decimal(18,2) string.
 * Examples:
 *   "1.250.000,00" -> "1250000.00"
 *   "1.234.567"    -> "1234567.00"
 *   "25.500"       -> "25500.00"
 *   "500,50"       -> "500.50"
 *   "1,234,567.89" -> "1234567.89"
 *   "10,000,000.00 CR" -> value "10000000.00", indicator "CR"
 *   "500.000,00 DB" -> value "500000.00", indicator "DB"
 */
export function parseFinancialAmount(rawText: string | null | undefined): ParsedAmountResult | null {
  if (!rawText) return null;
  let str = rawText.trim();
  if (!str) return null;

  let indicator: "CR" | "DB" | null = null;
  let isNegative = false;

  // Check prefix or suffix negative signs
  if (str.startsWith("-") || str.endsWith("-")) {
    isNegative = true;
    str = str.replace(/^-|-$/g, "").trim();
  }

  // Detect explicit CR / DB / DR indicators
  const indicatorMatch = str.match(/\b(CR|DB|DR|KREDIT|DEBET|CREDIT|DEBIT)\b/i);
  if (indicatorMatch) {
    const rawInd = indicatorMatch[1].toUpperCase();
    if (rawInd === "CR" || rawInd === "KREDIT" || rawInd === "CREDIT") {
      indicator = "CR";
    } else if (rawInd === "DB" || rawInd === "DR" || rawInd === "DEBET" || rawInd === "DEBIT") {
      indicator = "DB";
    }
    str = str.replace(/\b(CR|DB|DR|KREDIT|DEBET|CREDIT|DEBIT)\b/gi, "").trim();
  }

  // Remove currency prefixes (Rp., IDR, etc.)
  str = str.replace(/^(?:RP\.?|IDR|USD)\s*/i, "").trim();

  if (!str) return null;

  // Check valid characters (only digits, dots, commas, spaces)
  if (!/^[\d\s.,]+$/.test(str)) {
    return null;
  }

  // Remove interior spaces e.g. "1 250 000,00"
  str = str.replace(/\s+/g, "");

  const hasDot = str.includes(".");
  const hasComma = str.includes(",");

  let integerPart = "";
  let decimalPart = "00";

  if (hasDot && hasComma) {
    const lastDot = str.lastIndexOf(".");
    const lastComma = str.lastIndexOf(",");

    if (lastComma > lastDot) {
      // Indonesian format: 1.234.567,89
      integerPart = str.substring(0, lastComma).replace(/\./g, "");
      decimalPart = str.substring(lastComma + 1);
    } else {
      // English format: 1,234,567.89
      integerPart = str.substring(0, lastDot).replace(/,/g, "");
      decimalPart = str.substring(lastDot + 1);
    }
  } else if (hasComma && !hasDot) {
    // Only comma present:
    // e.g. "500,50" (decimal) or "1,234,567" (thousands in English) or "1234567,89"
    const parts = str.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      // Decimal comma: "500,50" -> 500.50
      integerPart = parts[0];
      decimalPart = parts[1];
    } else {
      // Comma used as thousand separator: "1,250,000" -> 1250000.00
      integerPart = str.replace(/,/g, "");
      decimalPart = "00";
    }
  } else if (hasDot && !hasComma) {
    // Only dot present:
    // e.g. "1.234.567" (Indonesian thousand separator) or "25.500" or "500.50" (English decimal)
    const parts = str.split(".");
    if (parts.length === 2 && parts[1].length === 2) {
      // Two decimals: could be English "500.50"
      integerPart = parts[0];
      decimalPart = parts[1];
    } else if (parts.length === 2 && parts[1].length === 3) {
      // Three digits after dot e.g. "25.500" -> likely Indonesian thousands separator
      integerPart = parts[0] + parts[1];
      decimalPart = "00";
    } else if (parts.length > 2) {
      // Multiple dots: "1.234.567" -> Indonesian thousand separator
      integerPart = str.replace(/\./g, "");
      decimalPart = "00";
    } else {
      // Single dot with other length
      if (parts[1].length <= 2) {
        integerPart = parts[0];
        decimalPart = parts[1];
      } else {
        integerPart = str.replace(/\./g, "");
        decimalPart = "00";
      }
    }
  } else {
    // Only digits: "1234567"
    integerPart = str;
    decimalPart = "00";
  }

  // Sanity check integer part contains only digits
  if (!/^\d+$/.test(integerPart)) {
    return null;
  }

  // Format decimal to exactly 2 digits
  decimalPart = (decimalPart + "00").slice(0, 2);

  // Eliminate leading zeros unless the integer part is 0
  const normalizedInt = BigInt(integerPart).toString();

  return {
    value: `${normalizedInt}.${decimalPart}`,
    indicator,
    isNegative,
  };
}

/**
 * Convenience helper returning just the Decimal(18,2) string or null.
 */
export function formatAmountDecimal(rawText: string | null | undefined): string | null {
  const parsed = parseFinancialAmount(rawText);
  return parsed ? parsed.value : null;
}
