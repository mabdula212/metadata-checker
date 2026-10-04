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

    const hasOpening =
      headerLine.includes("saldo awal") ||
      headerLine.includes("opening balance") ||
      headerLine.includes("beginning balance");
    const hasClosing =
      headerLine.includes("saldo akhir") ||
      headerLine.includes("closing balance") ||
      headerLine.includes("ending balance");

    if (hasOpening && hasClosing) {
      const amountTokenPattern =
        /(?:[+\-]?(?:[0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]+)(?:[.,][0-9]{2})?)/g;
      const amounts = nextLine.match(amountTokenPattern);
      if (amounts && amounts.length >= 2) {
        const pOpen = parseFinancialAmount(amounts[0]);
        const pClose = parseFinancialAmount(amounts[amounts.length - 1]);
        if (pOpen && pClose) {
          openingBalance = pOpen.value;
          closingBalance = pClose.value;
          if (amounts.length === 4) {
            const clean1 = amounts[1].replace(/^[+\-]/, "").trim();
            const clean2 = amounts[2].replace(/^[+\-]/, "").trim();
            const creditPos = Math.max(
              headerLine.indexOf("pemasukan"),
              headerLine.indexOf("kredit"),
              headerLine.indexOf("mutasi cr"),
              headerLine.indexOf("credit")
            );
            const debitPos = Math.max(
              headerLine.indexOf("pengeluaran"),
              headerLine.indexOf("debet"),
              headerLine.indexOf("debit"),
              headerLine.indexOf("mutasi db")
            );
            if (creditPos !== -1 && debitPos !== -1 && creditPos < debitPos) {
              summaryTotalCredit = parseFinancialAmount(clean1)?.value || null;
              summaryTotalDebit = parseFinancialAmount(clean2)?.value || null;
            } else {
              summaryTotalDebit = parseFinancialAmount(clean1)?.value || null;
              summaryTotalCredit = parseFinancialAmount(clean2)?.value || null;
            }
          }
          return { openingBalance, closingBalance, summaryTotalDebit, summaryTotalCredit };
        }
      }
    }
  }

  // 1b. Check 4-line vertical summary header block followed by 4 amount lines
  for (let i = 0; i <= lines.length - 8; i++) {
    const l0 = lines[i].toLowerCase();
    const l1 = lines[i + 1].toLowerCase();
    const l2 = lines[i + 2].toLowerCase();
    const l3 = lines[i + 3].toLowerCase();
    if (
      /^saldo\s+awal$/i.test(l0) &&
      /^total\s+pemasukan$/i.test(l1) &&
      /^total\s+pengeluaran$/i.test(l2) &&
      /^saldo\s+akhir$/i.test(l3)
    ) {
      const pOpen = parseFinancialAmount(lines[i + 4]);
      const pCred = parseFinancialAmount(lines[i + 5].replace(/^[+\-]/, ""));
      const pDeb = parseFinancialAmount(lines[i + 6].replace(/^[+\-]/, ""));
      const pClose = parseFinancialAmount(lines[i + 7]);
      if (pOpen && pCred && pDeb && pClose) {
        return {
          openingBalance: pOpen.value,
          summaryTotalCredit: pCred.value,
          summaryTotalDebit: pDeb.value,
          closingBalance: pClose.value,
        };
      }
    }
  }

  // 2. Check Line-by-Line Key-Value patterns (single lines and adjacent label/value lines)
  const standaloneAmountRegex = /^(?:IDR|RP\.?)?\s*[+\-]?[0-9.,]+(?:\s*[CD][RB])?$/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = i + 1 < lines.length ? lines[i + 1] : "";

    if (!openingBalance) {
      const openMatch = line.match(
        /(?:saldo\s+awal|opening\s+balance|beginning\s+balance|saldo\s+sebelumnya|saldo\s+awal\s+bulan|saldo\s+awal\s+periode)\s*(?:bulan\s+ini|periode\s+ini)?\s*(?:\(idr\))?\s*[:=]?\s*(?:IDR|RP\.?)?\s*([+\-]?[0-9.,]+(?:\s*[CD][RB])?)/i
      );
      if (openMatch && openMatch[1]) {
        const p = parseFinancialAmount(openMatch[1]);
        if (p) openingBalance = p.value;
      } else if (
        /^(?:saldo\s+awal|opening\s+balance|beginning\s+balance)(?:\s*\(idr\))?[:=]?$/i.test(line) &&
        nextLine &&
        standaloneAmountRegex.test(nextLine)
      ) {
        const p = parseFinancialAmount(nextLine);
        if (p) openingBalance = p.value;
      }
    }

    if (!closingBalance) {
      const closeMatch = line.match(
        /(?:saldo\s+akhir|closing\s+balance|ending\s+balance|saldo\s+saat\s+ini|current\s+balance|saldo\s+akhir\s+bulan|saldo\s+akhir\s+periode)\s*(?:bulan\s+ini|periode\s+ini)?\s*(?:\(idr\))?\s*[:=]?\s*(?:IDR|RP\.?)?\s*([+\-]?[0-9.,]+(?:\s*[CD][RB])?)/i
      );
      if (closeMatch && closeMatch[1]) {
        const p = parseFinancialAmount(closeMatch[1]);
        if (p) closingBalance = p.value;
      } else if (
        /^(?:saldo\s+akhir|closing\s+balance|ending\s+balance)(?:\s*\(idr\))?[:=]?$/i.test(line) &&
        nextLine &&
        standaloneAmountRegex.test(nextLine)
      ) {
        const p = parseFinancialAmount(nextLine);
        if (p) closingBalance = p.value;
      }
    }

    if (!summaryTotalDebit) {
      const dbMatch = line.match(
        /(?:total\s+pengeluaran|total\s+mutasi\s+d(?:eb[ie]t|b)|total\s+d(?:eb[ie]t|b)|mutasi\s+d(?:eb[ie]t|b))\s*(?:\(idr\))?\s*[:=]?\s*(?:IDR|RP\.?)?\s*([+\-]?[0-9.,]+)/i
      );
      if (dbMatch && dbMatch[1]) {
        const cleanAmount = dbMatch[1].replace(/^[+\-]/, "").trim();
        const p = parseFinancialAmount(cleanAmount);
        if (p) summaryTotalDebit = p.value;
      } else if (
        /^(?:total\s+pengeluaran|total\s+mutasi\s+d(?:eb[ie]t|b)|total\s+d(?:eb[ie]t|b))(?:\s*\(idr\))?[:=]?$/i.test(line) &&
        nextLine &&
        standaloneAmountRegex.test(nextLine)
      ) {
        const cleanAmount = nextLine.replace(/^(?:IDR|RP\.?)?\s*[+\-]?/i, "").trim();
        const p = parseFinancialAmount(cleanAmount);
        if (p) summaryTotalDebit = p.value;
      }
    }

    if (!summaryTotalCredit) {
      const crMatch = line.match(
        /(?:total\s+pemasukan|total\s+mutasi\s+(?:kredit|cr)|total\s+(?:kredit|cr)|mutasi\s+(?:kredit|cr))\s*(?:\(idr\))?\s*[:=]?\s*(?:IDR|RP\.?)?\s*([+\-]?[0-9.,]+)/i
      );
      if (crMatch && crMatch[1]) {
        const cleanAmount = crMatch[1].replace(/^[+\-]/, "").trim();
        const p = parseFinancialAmount(cleanAmount);
        if (p) summaryTotalCredit = p.value;
      } else if (
        /^(?:total\s+pemasukan|total\s+mutasi\s+(?:kredit|cr)|total\s+(?:kredit|cr))(?:\s*\(idr\))?[:=]?$/i.test(line) &&
        nextLine &&
        standaloneAmountRegex.test(nextLine)
      ) {
        const cleanAmount = nextLine.replace(/^(?:IDR|RP\.?)?\s*[+\-]?/i, "").trim();
        const p = parseFinancialAmount(cleanAmount);
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
