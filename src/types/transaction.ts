export type TransactionType =
  | "CREDIT"
  | "DEBIT"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "FEE"
  | "INTEREST"
  | "TAX"
  | "ATM"
  | "QRIS"
  | "CASH_DEPOSIT"
  | "CASH_WITHDRAWAL"
  | "BILL_PAYMENT"
  | "OTHER";

export interface ParsedTransactionUi {
  id?: string;
  transactionDate: string;
  rawDate?: string;
  description: string;
  referenceNumber?: string | null;
  debit?: string | null;
  credit?: string | null;
  balance: string;
  transactionType: TransactionType;
  category?: string | null;
  confidence?: "HIGH" | "MEDIUM" | "LOW";
  confidenceReasons?: string[];
  pageNumber?: number;
  rawText?: string;
}

export interface ReviewRowUi {
  pageNumber: number;
  rawSourceText: string;
  reason:
    | "UNRECOGNIZED_ROW"
    | "AMBIGUOUS_AMOUNT"
    | "INVALID_DATE"
    | "DISCONTINUOUS_BALANCE"
    | "MISSING_REQUIRED_FIELDS";
  extractedFields?: Record<string, unknown>;
  suggestedFix?: string;
}

export interface TransactionExtractionSummaryUi {
  totalRowsDetected: number;
  totalTransactionsParsed: number;
  totalTransactionsRejected: number;
  totalTransactionsNeedingReview: number;
  totalCredit: string;
  totalDebit: string;
  openingBalance?: string | null;
  closingBalance?: string | null;
  balanceReconciliationStatus: "VALID" | "PARTIAL" | "NEEDS_REVIEW" | "FAILED";
}

export interface TransactionExtractionResultUi {
  documentId: string;
  statementId: string;
  status: "COMPLETED" | "PARTIAL" | "NEEDS_REVIEW" | "FAILED";
  summary: TransactionExtractionSummaryUi;
  transactions: ParsedTransactionUi[];
  reviewRows: ReviewRowUi[];
  validation?: {
    warnings: string[];
    calculatedCredits: string;
    calculatedDebits: string;
    sourceOpeningBalance: string | null;
    sourceClosingBalance: string | null;
  };
  warning?: string | null;
}
