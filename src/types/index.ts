// Domain types and models for METADATA CHECKER

export type Role = "USER" | "ADMIN";

export type DocumentStatus = "UPLOADED" | "PROCESSING" | "COMPLETED" | "FAILED";

export type JobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export type ExportFormat = "XLSX" | "CSV" | "JSON";

export type ExportStatus = "PENDING" | "COMPLETED" | "FAILED";

export type AuditAction =
  | "LOGIN"
  | "LOGOUT"
  | "UPLOAD_DOCUMENT"
  | "DELETE_DOCUMENT"
  | "VIEW_DOCUMENT"
  | "EXPORT_DOCUMENT";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentMetadata {
  id: string;
  documentId: string;
  pdfVersion: string | null;
  pageCount: number;
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  creator: string | null;
  producer: string | null;
  creationDate: string | null;
  modificationDate: string | null;
  encrypted: boolean;
  hasXmp: boolean;
  metadataJson: Record<string, unknown> | null;
  createdAt: string;
}

export interface Document {
  id: string;
  userId: string;
  originalFileName: string;
  storedFileName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  status: DocumentStatus;
  uploadedAt: string;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
  metadata?: DocumentMetadata | null;
}

export interface BankAccount {
  id: string;
  userId: string;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  createdAt: string;
  updatedAt: string;
}

export interface Statement {
  id: string;
  documentId: string;
  bankAccountId: string;
  statementPeriodStart: string | null;
  statementPeriodEnd: string | null;
  openingBalance: string;
  closingBalance: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
  bankAccount?: BankAccount;
}

export interface Transaction {
  id: string;
  statementId: string;
  transactionDate: string;
  description: string;
  referenceNumber: string | null;
  debit: string | null;
  credit: string | null;
  balance: string;
  categoryId: string | null;
  rawText: string | null;
  createdAt: string;
  updatedAt: string;
  category?: TransactionCategory | null;
}

export interface TransactionCategory {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface ProcessingJob {
  id: string;
  documentId: string;
  jobType: string;
  status: JobStatus;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface Export {
  id: string;
  userId: string;
  documentId: string | null;
  fileName: string;
  format: ExportFormat;
  status: ExportStatus;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  userId: string | null;
  action: AuditAction;
  entity: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

// PDF Service Types
export interface PdfMetadataResult {
  pdfVersion: string | null;
  pageCount: number;
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  creator: string | null;
  producer: string | null;
  creationDate: string | null;
  modificationDate: string | null;
  encrypted: boolean;
  hasXmp: boolean;
  metadataJson: Record<string, unknown>;
}

export interface StorageUploadResult {
  storedFileName: string;
  storagePath: string;
  url: string;
  fileSize: number;
}

// API standard envelopes
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
