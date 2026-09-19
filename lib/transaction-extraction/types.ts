export type ExtractionConfidence = "HIGH" | "MEDIUM" | "LOW";

export type TransactionType =
  | "CREDIT"
  | "DEBIT"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "CASH_DEPOSIT"
  | "CASH_WITHDRAWAL"
  | "ATM"
  | "CARD"
  | "QRIS"
  | "BILL_PAYMENT"
  | "FEE"
  | "INTEREST"
  | "TAX"
  | "REVERSAL"
  | "OTHER"
  | "UNKNOWN";

export type ReviewRowReason =
  | "INVALID_DATE"
  | "AMBIGUOUS_AMOUNT"
  | "MISSING_BALANCE"
  | "UNRECOGNIZED_ROW"
  | "MULTI_LINE_TRANSACTION"
  | "UNKNOWN_FORMAT";

export type BalanceReconciliationStatus =
  | "VALID"
  | "PARTIAL"
  | "NEEDS_REVIEW"
  | "FAILED";

export type ExtractionStatus =
  | "COMPLETED"
  | "PARTIAL"
  | "NEEDS_REVIEW"
  | "FAILED";

export interface ParsedTransaction {
  id?: string;
  transactionDate: string; // ISO format: YYYY-MM-DD
  rawDate: string;
  description: string;
  referenceNumber: string | null;
  debit: string | null; // Normalized Decimal string: e.g. "1000000.00"
  credit: string | null; // Normalized Decimal string: e.g. "2500000.00"
  balance: string; // Normalized Decimal string: e.g. "7500000.00"
  transactionType: TransactionType;
  category?: string | null;
  confidence: ExtractionConfidence;
  confidenceReasons: string[];
  pageNumber: number;
  rawText: string;
}

export interface ReviewRow {
  pageNumber: number;
  rawSourceText: string;
  reason: ReviewRowReason;
  extractedFields?: Record<string, unknown>;
}

export interface TransactionExtractionValidation {
  totalRowsDetected: number;
  totalTransactionsParsed: number;
  totalTransactionsRejected: number;
  totalTransactionsNeedingReview: number;
  firstTransactionDate: string | null;
  lastTransactionDate: string | null;
  calculatedCredits: string;
  calculatedDebits: string;
  sourceOpeningBalance: string | null;
  sourceClosingBalance: string | null;
  balanceReconciliationStatus: BalanceReconciliationStatus;
  warnings: string[];
}

export interface TransactionExtractionResult {
  status: ExtractionStatus;
  bankCode: string | null;
  bankName: string | null;
  transactions: ParsedTransaction[];
  reviewRows: ReviewRow[];
  validation: TransactionExtractionValidation;
  warning?: string | null;
}

export interface ExtractedPageItem {
  pageNumber: number;
  text: string;
  characterCount: number;
}

export interface TransactionParserInput {
  fullText: string;
  pages: ExtractedPageItem[];
  bankCode?: string | null;
  bankName?: string | null;
  statementPeriodStart?: string | null;
  statementPeriodEnd?: string | null;
  isScannedOrImageOnly?: boolean;
  sourceOpeningBalance?: string | null;
  sourceClosingBalance?: string | null;
}

export interface BankTransactionParser {
  readonly bankCode: string;
  readonly bankName: string;
  canParse(input: TransactionParserInput): boolean;
  parse(input: TransactionParserInput): {
    transactions: ParsedTransaction[];
    reviewRows: ReviewRow[];
    totalRowsDetected: number;
    sourceOpeningBalance?: string | null;
    sourceClosingBalance?: string | null;
    warnings?: string[];
  };
}
