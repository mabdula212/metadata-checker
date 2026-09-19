/**
 * Utility functions for bank statement detection, account masking, and date parsing.
 */

const ID_MONTHS: Record<string, string> = {
  januari: "01",
  jan: "01",
  februari: "02",
  feb: "02",
  maret: "03",
  mar: "03",
  april: "04",
  apr: "04",
  mei: "05",
  may: "05",
  juni: "06",
  jun: "06",
  juli: "07",
  jul: "07",
  agustus: "08",
  agu: "08",
  ags: "08",
  aug: "08",
  august: "08",
  september: "09",
  sep: "09",
  oktober: "10",
  okt: "10",
  oct: "10",
  october: "10",
  november: "11",
  nov: "11",
  desember: "12",
  des: "12",
  dec: "12",
  december: "12",
};

/**
 * Masks an account number so only the last 4 digits are visible.
 * Example: "1234567890" becomes "******7890".
 * Never exposes or logs the full account number.
 */
export function maskAccountNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Strip spaces, dashes, dots
  const cleaned = raw.replace(/[^a-zA-Z0-9]/g, "");
  if (cleaned.length < 4) return null;

  const last4 = cleaned.slice(-4);
  const maskLength = Math.max(cleaned.length - 4, 6);
  return `${"*".repeat(maskLength)}${last4}`;
}

/**
 * Parses an Indonesian or English date string into an ISO YYYY-MM-DD format.
 * Supports:
 * - 01/08/2026, 01-08-2026, 01.08.2026
 * - 01 Agustus 2026, 1 Agustus 2026, 01 August 2026, 1 Aug 2026
 * - 2026-08-01, 2026/08/01
 */
export function parseIndonesianOrEnglishDate(dateStr: string): string | null {
  if (!dateStr) return null;
  const cleaned = dateStr.trim().replace(/,/g, "");

  // Pattern 1: DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const numMatch = cleaned.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (numMatch) {
    const day = parseInt(numMatch[1], 10);
    const month = parseInt(numMatch[2], 10);
    const year = parseInt(numMatch[3], 10);

    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1990 && year <= 2099) {
      const dd = String(day).padStart(2, "0");
      const mm = String(month).padStart(2, "0");
      return `${year}-${mm}-${dd}`;
    }
  }

  // Pattern 2: YYYY-MM-DD
  const isoMatch = cleaned.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1990 && year <= 2099) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // Pattern 3: DD MonthName YYYY (e.g., "01 Agustus 2026" or "1 Aug 2026")
  const textMatch = cleaned.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (textMatch) {
    const day = parseInt(textMatch[1], 10);
    const monthKey = textMatch[2].toLowerCase();
    const year = parseInt(textMatch[3], 10);
    const monthStr = ID_MONTHS[monthKey];

    if (monthStr && day >= 1 && day <= 31 && year >= 1990 && year <= 2099) {
      return `${year}-${monthStr}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

/**
 * Searches for period date ranges across bank statement text.
 * Handles patterns like:
 * - "Periode : 01/08/2026 s/d 31/08/2026"
 * - "Periode Transaksi : 01 Agustus 2026 - 31 Agustus 2026"
 * - "Dari Tgl : 01/08/2026 Sampai Tgl : 31/08/2026"
 */
export function extractStatementPeriod(
  text: string
): { start: string | null; end: string | null; signal?: string } {
  // Regex pattern matching range separators: s/d, s.d., s/d., -, sd, s.d, sampai, to
  const rangeRegexes = [
    // Periode / Statement Period : <DATE> s/d <DATE>
    /(?:periode|statement\s+period|periode\s+transaksi)\s*(?:transaksi)?\s*[:=\s]\s*([0-9]{1,2}(?:[\s\/\-\.][A-Za-z0-9]+){2})\s*(?:s\/?d\.?|s\.d\.|-|sampai\s+dengan|sampai|to)\s*([0-9]{1,2}(?:[\s\/\-\.][A-Za-z0-9]+){2})/i,
    // Dari <DATE> Sampai <DATE>
    /(?:dari\s+tgl|dari\s+tanggal|dari|from)\s*[:=\s]\s*([0-9]{1,2}(?:[\s\/\-\.][A-Za-z0-9]+){2})\s*(?:sampai\s+tgl|sampai\s+tanggal|sampai|to)\s*[:=\s]\s*([0-9]{1,2}(?:[\s\/\-\.][A-Za-z0-9]+){2})/i,
    // Date range without prefix: 01/08/2026 - 31/08/2026
    /\b([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})\s*(?:s\/?d\.?|-|sampai|to)\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})\b/i,
  ];

  for (const regex of rangeRegexes) {
    const match = text.match(regex);
    if (match) {
      const rawStart = match[1];
      const rawEnd = match[2];
      const parsedStart = parseIndonesianOrEnglishDate(rawStart);
      const parsedEnd = parseIndonesianOrEnglishDate(rawEnd);

      if (parsedStart && parsedEnd) {
        return {
          start: parsedStart,
          end: parsedEnd,
          signal: `Statement period detected: ${parsedStart} to ${parsedEnd}`,
        };
      }
    }
  }

  return { start: null, end: null };
}

/**
 * Detects general Indonesian / international bank statement terminology.
 */
export function detectGeneralStatementSignals(text: string): string[] {
  const upper = text.toUpperCase();
  const signals: string[] = [];

  if (upper.includes("REKENING KORAN")) signals.push("Term 'Rekening Koran' present");
  if (upper.includes("E-STATEMENT") || upper.includes("ESTATEMENT")) signals.push("Term 'E-Statement' present");
  if (upper.includes("STATEMENT OF ACCOUNT")) signals.push("Term 'Statement of Account' present");
  if (upper.includes("MUTASI REKENING") || upper.includes("LAPORAN MUTASI")) signals.push("Term 'Mutasi Rekening' present");
  if (upper.includes("SALDO AWAL") || upper.includes("OPENING BALANCE") || upper.includes("BEGINNING BALANCE")) signals.push("Balance terminology 'Saldo Awal' present");
  if (upper.includes("SALDO AKHIR") || upper.includes("CLOSING BALANCE") || upper.includes("ENDING BALANCE")) signals.push("Balance terminology 'Saldo Akhir' present");
  if (upper.includes("DEBET") || upper.includes("DEBIT")) signals.push("Transaction column 'Debet/Debit' present");
  if (upper.includes("KREDIT") || upper.includes("CREDIT")) signals.push("Transaction column 'Kredit/Credit' present");
  if (upper.includes("NO. REKENING") || upper.includes("NOMOR REKENING") || upper.includes("ACCOUNT NUMBER") || upper.includes("ACCOUNT NO")) {
    signals.push("Account number label present");
  }

  return signals;
}

/**
 * Extracts and cleans an account holder name following common statement patterns.
 */
export function extractAccountHolderName(
  text: string
): string | null {
  const patterns = [
    /(?:nama\s+nasabah|nama\s+pemilik\s+rekening|nama\s+rekening|account\s+name|nama)\s*[:=]\s*([A-Za-z0-9\s.,'/-]{3,50})/i,
    /(?:pemilik\s+rekening)\s*[:=]\s*([A-Za-z0-9\s.,'/-]{3,50})/i,
  ];

  for (const regex of patterns) {
    const match = text.match(regex);
    if (match && match[1]) {
      const candidate = match[1]
        .split(/[\n\r]|no\.|nomor|periode|tgl|alamat/i)[0]
        .trim();

      // Check if candidate looks like a plausible name (not a date, number, or system label)
      if (
        candidate.length >= 3 &&
        candidate.length <= 60 &&
        !/^\d+$/.test(candidate) &&
        !/^(jan|feb|mar|apr|mei|jun|jul|agu|sep|okt|nov|des)/i.test(candidate)
      ) {
        return candidate.toUpperCase();
      }
    }
  }

  return null;
}
