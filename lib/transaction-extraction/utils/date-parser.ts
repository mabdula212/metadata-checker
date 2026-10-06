/**
 * Robust date parser supporting Indonesian and English date formats for bank statements.
 * Supports full dates (DD/MM/YYYY, DD Month YYYY) and partial dates (DD/MM, DD Month)
 * resolved against known statement periods or years.
 */

const MONTH_MAP: Record<string, string> = {
  // Indonesian full
  januari: "01",
  februari: "02",
  maret: "03",
  april: "04",
  mei: "05",
  juni: "06",
  juli: "07",
  agustus: "08",
  september: "09",
  oktober: "10",
  november: "11",
  desember: "12",
  // Indonesian / English abbreviations
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  agu: "08",
  ags: "08",
  agst: "08",
  sep: "09",
  sept: "09",
  okt: "10",
  oct: "10",
  nov: "11",
  des: "12",
  dec: "12",
  // English full
  january: "01",
  february: "02",
  march: "03",
  june: "06",
  july: "07",
  august: "08",
  october: "10",
  december: "12",
};

export interface DateParseOptions {
  referenceYear?: number | null;
  statementPeriodStart?: string | null;
  statementPeriodEnd?: string | null;
}

/**
 * Extracts a 4-digit year from an ISO string (YYYY-MM-DD) or returns null.
 */
export function extractYearFromIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Resolves reference year from options or string period.
 */
export function determineReferenceYear(options?: DateParseOptions): number {
  if (options?.referenceYear && options.referenceYear >= 1990 && options.referenceYear <= 2099) {
    return options.referenceYear;
  }
  const fromStart = extractYearFromIso(options?.statementPeriodStart);
  if (fromStart) return fromStart;
  const fromEnd = extractYearFromIso(options?.statementPeriodEnd);
  if (fromEnd) return fromEnd;
  return new Date().getFullYear();
}

/**
 * Expands a 2-digit year (e.g. 26) into a 4-digit year (e.g. 2026) using reference context or financial epoch.
 */
export function expandTwoDigitYear(twoDigitYear: number, options?: DateParseOptions): number {
  if (twoDigitYear >= 100) return twoDigitYear;
  const refYear = determineReferenceYear(options);
  const refCentury = Math.floor(refYear / 100) * 100;
  const candidate = refCentury + twoDigitYear;
  if (Math.abs(candidate - refYear) <= 50) {
    return candidate;
  }
  return twoDigitYear < 70 ? 2000 + twoDigitYear : 1900 + twoDigitYear;
}

/**
 * Parses a raw date string into an ISO YYYY-MM-DD format.
 * Returns null if the date is invalid or ambiguous without a resolvable year.
 * Supports both 4-digit (2026) and 2-digit (26) years as well as strings with optional timestamps.
 */
export function parseTransactionDate(
  rawDateStr: string,
  options?: DateParseOptions
): string | null {
  if (!rawDateStr) return null;
  let str = rawDateStr.trim().replace(/,/g, "");

  // Strip optional trailing time e.g. "02/03/26 13:49:24" or "02/03/26 13:49"
  str = str.replace(/\s+\d{1,2}:\d{2}(?::\d{2})?.*$/, "").trim();

  // 1. DD/MM/YYYY or DD/MM/YY or DD-MM-YYYY or DD-MM-YY or DD.MM.YYYY or DD.MM.YY
  const fullNumericMatch = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (fullNumericMatch) {
    const day = parseInt(fullNumericMatch[1], 10);
    const month = parseInt(fullNumericMatch[2], 10);
    let year = parseInt(fullNumericMatch[3], 10);

    if (year < 100) {
      year = expandTwoDigitYear(year, options);
    }

    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1990 && year <= 2099) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    return null;
  }

  // 2. YYYY-MM-DD or YYYY/MM/DD or YY-MM-DD or YY/MM/DD
  const isoMatch = str.match(/^(\d{2,4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (isoMatch) {
    let year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);

    if (year < 100) {
      year = expandTwoDigitYear(year, options);
    }

    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1990 && year <= 2099) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    return null;
  }

  // 3. DD MonthName YYYY or DD MonthName YY (e.g. "01 Agustus 2026", "25 Dec 26")
  const fullTextualMatch = str.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{2,4})$/);
  if (fullTextualMatch) {
    const day = parseInt(fullTextualMatch[1], 10);
    const monthStr = MONTH_MAP[fullTextualMatch[2].toLowerCase()];
    let year = parseInt(fullTextualMatch[3], 10);

    if (year < 100) {
      year = expandTwoDigitYear(year, options);
    }

    if (monthStr && day >= 1 && day <= 31 && year >= 1990 && year <= 2099) {
      return `${year}-${monthStr}-${String(day).padStart(2, "0")}`;
    }
    return null;
  }

  // 4. Partial date without year: DD/MM or DD-MM or DD.MM
  const partialNumericMatch = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})$/);
  if (partialNumericMatch) {
    const day = parseInt(partialNumericMatch[1], 10);
    const month = parseInt(partialNumericMatch[2], 10);
    const year = determineReferenceYear(options);

    if (!year) {
      // Cannot reliably guess year without context
      return null;
    }

    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      // Check if statement crosses year boundary (e.g., Dec to Jan)
      let resolvedYear = year;
      const startYear = extractYearFromIso(options?.statementPeriodStart);
      const endYear = extractYearFromIso(options?.statementPeriodEnd);

      if (startYear && endYear && startYear !== endYear) {
        if (month === 12) resolvedYear = startYear;
        else if (month === 1) resolvedYear = endYear;
      }

      return `${resolvedYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    return null;
  }

  // 5. Partial textual date without year: DD Month (e.g. "01 Agu" or "15 August")
  const partialTextualMatch = str.match(/^(\d{1,2})\s+([A-Za-z]+)$/);
  if (partialTextualMatch) {
    const day = parseInt(partialTextualMatch[1], 10);
    const monthStr = MONTH_MAP[partialTextualMatch[2].toLowerCase()];
    const year = determineReferenceYear(options);

    if (!year || !monthStr) {
      return null;
    }

    if (day >= 1 && day <= 31) {
      return `${year}-${monthStr}-${String(day).padStart(2, "0")}`;
    }
    return null;
  }

  return null;
}
