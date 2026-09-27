import { parseFinancialAmount } from "./amount-parser.js";
import type { ParsedTransaction, BalanceReconciliationStatus } from "../types.js";

export interface StatementBalances {
  openingBalance: string | null;
  closingBalance: string | null;
  summaryTotalDebit?: string | null;
  summaryTotalCredit?: string | null;
}

/**
 * Converts a monetary decimal string (e.g. "1250000.50", "-500.00") to BigInt cents.
 * Handles negative signs, variable decimal places, and strips commas.
 */
export function toCents(valStr: string | null | undefined): bigint {
  if (!valStr) return 0n;
  const clean = valStr.trim().replace(/,/g, "");
  if (!clean) return 0n;
  const isNeg = clean.startsWith("-");
  const absClean = clean.replace(/^-/, "");
  const parts = absClean.split(".");
  const whole = BigInt(parts[0] || "0");
  const fraction = BigInt((parts[1] || "00").padEnd(2, "0").slice(0, 2));
  const total = whole * 100n + fraction;
  return isNeg ? -total : total;
}

/**
 * Formats BigInt cents back to a standard Decimal(18,2) string.
 */
export function formatCents(cents: bigint): string {
  const isNeg = cents < 0n;
  const abs = isNeg ? -cents : cents;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, "0");
  return `${isNeg ? "-" : ""}${whole}.${fraction}`;
}

/**
 * Scans text for standard Indonesian and English balance summary headers/footers.
 * Supports both multi-column table layouts and line-by-line key-value pairs.
 */
export function extractStatementBalances(text: string): StatementBalances {
  let openingBalance: string | null = null;
  let closingBalance: string | null = null;
  let summaryTotalDebit: string | null = null;
  let summaryTotalCredit: string | null = null;

  if (!text) {
    return { openingBalance: null, closingBalance: null };
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  // 1. Check Table Format (Header line containing Opening and Closing labels followed by numeric amounts line)
  for (let i = 0; i < lines.length - 1; i++) {
    const headerLine = lines[i].toLowerCase();
    const nextLine = lines[i + 1];

    const hasOpening = headerLine.includes("saldo awal") || headerLine.includes("opening balance") || headerLine.includes("beginning balance");
    const hasClosing = headerLine.includes("saldo akhir") || headerLine.includes("closing balance") || headerLine.includes("ending balance");

    if (hasOpening && hasClosing) {
      const currencyPattern = /(?:[0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})|[0-9]+[.,][0-9]{2})/g;
      const amounts = nextLine.match(currencyPattern);
      if (amounts && amounts.length >= 2) {
        const pOpen = parseFinancialAmount(amounts[0]);
        const pClose = parseFinancialAmount(amounts[amounts.length - 1]);
        if (pOpen && pClose) {
          openingBalance = pOpen.value;
          closingBalance = pClose.value;
          if (amounts.length === 4) {
            summaryTotalDebit = parseFinancialAmount(amounts[1])?.value || null;
            summaryTotalCredit = parseFinancialAmount(amounts[2])?.value || null;
          }
          return { openingBalance, closingBalance, summaryTotalDebit, summaryTotalCredit };
        }
      }
    }
  }

  // 2. Check Line-by-Line Key-Value patterns (strictly within single lines)
  for (const line of lines) {
    if (!openingBalance) {
      const openMatch = line.match(
        /(?:saldo\s+awal|opening\s+balance|beginning\s+balance|saldo\s+sebelumnya|saldo\s+awal\s+bulan|saldo\s+awal\s+periode)\s*(?:bulan\s+ini|periode\s+ini)?\s*[:=]?\s*(?:IDR|RP\.?)?\s*([0-9.,]+(?:\s*[CD][RB])?)/i
      );
      if (openMatch) {
        const p = parseFinancialAmount(openMatch[1]);
        if (p) openingBalance = p.value;
      }
    }

    if (!closingBalance) {
      const closeMatch = line.match(
        /(?:saldo\s+akhir|closing\s+balance|ending\s+balance|saldo\s+saat\s+ini|current\s+balance|saldo\s+akhir\s+bulan|saldo\s+akhir\s+periode)\s*(?:bulan\s+ini|periode\s+ini)?\s*[:=]?\s*(?:IDR|RP\.?)?\s*([0-9.,]+(?:\s*[CD][RB])?)/i
      );
      if (closeMatch) {
        const p = parseFinancialAmount(closeMatch[1]);
        if (p) closingBalance = p.value;
      }
    }

    if (!summaryTotalDebit) {
      const dbMatch = line.match(
        /(?:total\s+mutasi\s+d(?:eb[ie]t|b)|total\s+d(?:eb[ie]t|b)|mutasi\s+d(?:eb[ie]t|b))\s*[:=]?\s*(?:IDR|RP\.?)?\s*([0-9.,]+)/i
      );
      if (dbMatch) {
        const p = parseFinancialAmount(dbMatch[1]);
        if (p) summaryTotalDebit = p.value;
      }
    }

    if (!summaryTotalCredit) {
      const crMatch = line.match(
        /(?:total\s+mutasi\s+(?:kredit|cr)|total\s+(?:kredit|cr)|mutasi\s+(?:kredit|cr))\s*[:=]?\s*(?:IDR|RP\.?)?\s*([0-9.,]+)/i
      );
      if (crMatch) {
        const p = parseFinancialAmount(crMatch[1]);
        if (p) summaryTotalCredit = p.value;
      }
    }
  }

  return { openingBalance, closingBalance, summaryTotalDebit, summaryTotalCredit };
}

/**
 * Validates balance progression across a series of ordered transactions.
 * Arithmetic: previousBalance + credit - debit = currentBalance
 * Tolerance: 5 cents (to accommodate minor currency rounding artifacts).
 */
export function validateBalanceProgression(
  transactions: ParsedTransaction[],
  sourceOpeningBalance: string | null,
  sourceClosingBalance: string | null
): {
  status: BalanceReconciliationStatus;
  consecutiveMatches: number;
  consecutiveMismatches: number;
  calculatedTotalCredit: string;
  calculatedTotalDebit: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  let totalCreditCents = 0n;
  let totalDebitCents = 0n;

  for (const tx of transactions) {
    if (tx.credit) totalCreditCents += toCents(tx.credit);
    if (tx.debit) totalDebitCents += toCents(tx.debit);
  }

  const calculatedTotalCredit = formatCents(totalCreditCents);
  const calculatedTotalDebit = formatCents(totalDebitCents);

  if (transactions.length === 0) {
    return {
      status: "NEEDS_REVIEW",
      consecutiveMatches: 0,
      consecutiveMismatches: 0,
      calculatedTotalCredit,
      calculatedTotalDebit,
      warnings: ["No transactions available for balance reconciliation."],
    };
  }

  let consecutiveMatches = 0;
  let consecutiveMismatches = 0;

  // Check step-by-step consecutive progression
  for (let i = 1; i < transactions.length; i++) {
    const prev = transactions[i - 1];
    const curr = transactions[i];

    const prevBal = toCents(prev.balance);
    const currBal = toCents(curr.balance);
    const currCr = toCents(curr.credit);
    const currDb = toCents(curr.debit);

    // Expected: prevBal + currCr - currDb
    const expectedCurrBal = prevBal + currCr - currDb;
    const diff = currBal > expectedCurrBal ? currBal - expectedCurrBal : expectedCurrBal - currBal;

    if (diff <= 5n) {
      // within 5 cents tolerance
      consecutiveMatches++;
    } else {
      consecutiveMismatches++;
      warnings.push(
        `Balance mismatch at row #${i + 1} (${curr.transactionDate}): expected ${formatCents(
          expectedCurrBal
        )} but statement shows ${curr.balance}`
      );
    }
  }

  // Check with opening and closing balance if available
  let globalMatch = false;
  if (sourceOpeningBalance && sourceClosingBalance) {
    const openCents = toCents(sourceOpeningBalance);
    const closeCents = toCents(sourceClosingBalance);
    const expectedClose = openCents + totalCreditCents - totalDebitCents;
    const diff = closeCents > expectedClose ? closeCents - expectedClose : expectedClose - closeCents;

    if (diff <= 5n) {
      globalMatch = true;
    } else {
      warnings.push(
        `Global balance mismatch: Opening (${sourceOpeningBalance}) + Total Credit (${calculatedTotalCredit}) - Total Debit (${calculatedTotalDebit}) != Closing (${sourceClosingBalance}).`
      );
    }
  }

  let status: BalanceReconciliationStatus = "VALID";

  if (consecutiveMismatches === 0) {
    status = "VALID";
  } else if (consecutiveMatches > 0 && consecutiveMismatches <= consecutiveMatches) {
    status = "PARTIAL";
  } else if (globalMatch) {
    status = "PARTIAL";
  } else {
    status = "NEEDS_REVIEW";
  }

  return {
    status,
    consecutiveMatches,
    consecutiveMismatches,
    calculatedTotalCredit,
    calculatedTotalDebit,
    warnings,
  };
}
