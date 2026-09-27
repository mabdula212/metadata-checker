import type {
  ParsedTransaction,
  ReviewRow,
  TransactionExtractionValidation,
  ExtractionStatus,
} from "./types.js";
import { validateBalanceProgression, toCents, formatCents } from "./utils/balance-parser.js";

export interface ValidationInput {
  transactions: ParsedTransaction[];
  reviewRows: ReviewRow[];
  totalRowsDetected: number;
  sourceOpeningBalance: string | null;
  sourceClosingBalance: string | null;
  isScannedOrImageOnly?: boolean;
}

export function validateExtractionResult(input: ValidationInput): {
  validation: TransactionExtractionValidation;
  status: ExtractionStatus;
  warning?: string | null;
} {
  const {
    transactions,
    reviewRows,
    totalRowsDetected,
    sourceOpeningBalance,
    sourceClosingBalance,
    isScannedOrImageOnly,
  } = input;

  const warnings: string[] = [];

  // Scanned PDF warning
  if (isScannedOrImageOnly) {
    const scanWarning =
      "This PDF appears to be image-based and requires OCR before transactions can be extracted reliably.";
    return {
      status: "NEEDS_REVIEW",
      warning: scanWarning,
      validation: {
        totalRowsDetected: 0,
        totalTransactionsParsed: 0,
        totalTransactionsRejected: 0,
        totalTransactionsNeedingReview: 0,
        firstTransactionDate: null,
        lastTransactionDate: null,
        calculatedCredits: "0.00",
        calculatedDebits: "0.00",
        sourceOpeningBalance: null,
        sourceClosingBalance: null,
        balanceReconciliationStatus: "NEEDS_REVIEW",
        warnings: [scanWarning],
      },
    };
  }

  const totalTransactionsParsed = transactions.length;
  const totalTransactionsNeedingReview = reviewRows.length;
  const totalTransactionsRejected = Math.max(
    0,
    totalRowsDetected - totalTransactionsParsed - totalTransactionsNeedingReview
  );

  // Date range
  let firstTransactionDate: string | null = null;
  let lastTransactionDate: string | null = null;
  if (transactions.length > 0) {
    firstTransactionDate = transactions[0].transactionDate;
    lastTransactionDate = transactions[transactions.length - 1].transactionDate;
  }

  // Derive effective opening and closing balances if missing from summary block
  let effectiveOpeningBalance = sourceOpeningBalance;
  let effectiveClosingBalance = sourceClosingBalance;

  if (transactions.length > 0) {
    if (!effectiveOpeningBalance && transactions[0].balance) {
      const firstTx = transactions[0];
      const balCents = toCents(firstTx.balance);
      const crCents = toCents(firstTx.credit);
      const dbCents = toCents(firstTx.debit);
      const openCents = balCents - crCents + dbCents;
      effectiveOpeningBalance = formatCents(openCents);
    }
    if (!effectiveClosingBalance && transactions[transactions.length - 1].balance) {
      effectiveClosingBalance = transactions[transactions.length - 1].balance;
    }
  }

  // Balance progression validation
  const balanceCheck = validateBalanceProgression(
    transactions,
    effectiveOpeningBalance,
    effectiveClosingBalance
  );

  warnings.push(...balanceCheck.warnings);

  // Determine overall status
  let status: ExtractionStatus = "COMPLETED";

  if (totalTransactionsParsed === 0) {
    status = "NEEDS_REVIEW";
    warnings.push("No transactions could be detected or parsed in this document.");
  } else if (totalTransactionsNeedingReview > 0) {
    status = "PARTIAL";
    warnings.push(
      `${totalTransactionsNeedingReview} row(s) require manual review due to ambiguity or unrecognized formats.`
    );
  } else if (balanceCheck.status === "NEEDS_REVIEW") {
    status = "PARTIAL";
    warnings.push("Transactions parsed but balance progression requires review.");
  } else {
    status = "COMPLETED";
  }

  return {
    status,
    validation: {
      totalRowsDetected: Math.max(totalRowsDetected, totalTransactionsParsed + totalTransactionsNeedingReview),
      totalTransactionsParsed,
      totalTransactionsRejected,
      totalTransactionsNeedingReview,
      firstTransactionDate,
      lastTransactionDate,
      calculatedCredits: balanceCheck.calculatedTotalCredit,
      calculatedDebits: balanceCheck.calculatedTotalDebit,
      sourceOpeningBalance: effectiveOpeningBalance,
      sourceClosingBalance: effectiveClosingBalance,
      balanceReconciliationStatus: balanceCheck.status,
      warnings,
    },
    warning: warnings.length > 0 ? warnings[0] : null,
  };
}
