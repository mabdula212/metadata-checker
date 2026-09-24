import { parseFinancialAmount } from "./amount-parser.js";
import type { ParsedTransaction, BalanceReconciliationStatus } from "../types.js";

export interface StatementBalances {
  openingBalance: string | null;
  closingBalance: string | null;
}

/**
 * Scans text for standard Indonesian and English balance summary headers/footers.
 */
export function extractStatementBalances(text: string): StatementBalances {
  let openingBalance: string | null = null;
  let closingBalance: string | null = null;

  // Opening balance patterns
  const openRegexes = [
    /(?:saldo\s+awal|opening\s+balance|beginning\s+balance|saldo\s+awal\s+bulan)\s*[:=]?\s*(?:IDR|RP\.?)?\s*([0-9.,]+(?:\s*[CD][RB])?)/i,
    /(?:saldo\s+sebelumnya|previous\s+balance)\s*[:=]?\s*(?:IDR|RP\.?)?\s*([0-9.,]+(?:\s*[CD][RB])?)/i,
  ];

  for (const reg of openRegexes) {
    const match = text.match(reg);
    if (match && match[1]) {
      const parsed = parseFinancialAmount(match[1]);
      if (parsed) {
        openingBalance = parsed.value;
        break;
      }
    }
  }

  // Closing balance patterns
  const closeRegexes = [
    /(?:saldo\s+akhir|closing\s+balance|ending\s+balance|saldo\s+akhir\s+bulan)\s*[:=]?\s*(?:IDR|RP\.?)?\s*([0-9.,]+(?:\s*[CD][RB])?)/i,
    /(?:saldo\s+saat\s+ini|current\s+balance)\s*[:=]?\s*(?:IDR|RP\.?)?\s*([0-9.,]+(?:\s*[CD][RB])?)/i,
  ];

  for (const reg of closeRegexes) {
    const match = text.match(reg);
    if (match && match[1]) {
      const parsed = parseFinancialAmount(match[1]);
      if (parsed) {
        closingBalance = parsed.value;
        break;
      }
    }
  }

  return { openingBalance, closingBalance };
}

/**
 * Validates balance progression across a series of ordered transactions.
 * Arithmetic: previousBalance + credit - debit = currentBalance
 * Tolerance: 0.05 (for minor source floating-point rounding artifacts).
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

  // Convert decimal string to cents (bigint)
  const toCents = (valStr: string | null | undefined): bigint => {
    if (!valStr) return 0n;
    const parts = valStr.split(".");
    const whole = BigInt(parts[0] || "0");
    const fraction = BigInt((parts[1] || "00").padEnd(2, "0").slice(0, 2));
    return whole * 100n + fraction;
  };

  for (const tx of transactions) {
    if (tx.credit) totalCreditCents += toCents(tx.credit);
    if (tx.debit) totalDebitCents += toCents(tx.debit);
  }

  const formatCents = (cents: bigint): string => {
    const whole = cents / 100n;
    const fraction = (cents % 100n).toString().padStart(2, "0");
    return `${whole}.${fraction}`;
  };

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
