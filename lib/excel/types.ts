import type {
  Document,
  DocumentMetadata,
  Statement,
  Transaction,
  BankAccount,
} from "@prisma/client";
import type {
  ExtractionStatus,
  BalanceReconciliationStatus,
  ReviewRow,
} from "../transaction-extraction/types";

export interface ExcelExportOptions {
  documentId: string;
  userId?: string;
  forceRegenerate?: boolean;
}

export interface BankStatementExportData {
  document: Document;
  metadata: DocumentMetadata | null;
  statement: Statement & {
    transactions: Transaction[];
    bankAccount?: BankAccount | null;
  };
  reviewRows: ReviewRow[];
  extractionStatus: ExtractionStatus;
  balanceReconciliationStatus: BalanceReconciliationStatus;
  warnings: string[];
}

export interface ExcelExportResult {
  exportId: string;
  documentId: string;
  fileName: string;
  storageKey: string;
  format: "XLSX";
  fileSize: number;
  transactionCount: number;
  reviewCount: number;
  createdAt: Date;
  buffer: Buffer;
}

export interface ExcelExportApiResponse {
  success: boolean;
  exportId?: string;
  fileName?: string;
  format?: "XLSX";
  transactionCount?: number;
  reviewCount?: number;
  createdAt?: string;
  downloadUrl?: string;
  error?: string;
}
