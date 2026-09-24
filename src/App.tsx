import React, { useState, useRef, useCallback, useEffect } from "react";
import { formatBytes } from "./lib/utils";
import {
  FileText,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  X,
  ArrowRight,
  Shield,
  Layers,
  Search,
  FileSpreadsheet,
  Clock,
  Loader2,
  Sparkles,
  Database,
  Landmark,
  RefreshCw,
  LogOut,
  Users,
  LayoutDashboard,
  ShieldCheck,
} from "lucide-react";
import type {
  DocumentRecord,
  DocumentMetadataRecord,
  InspectApiResponse,
  RecentDocumentItem,
  BankDetectionResultUi,
  BankDetectionApiResponse,
} from "./types/metadata";
import { MetadataResultCard } from "./components/MetadataResultCard";
import { BankAnalysisCard } from "./components/BankAnalysisCard";
import { TransactionExtractionCard } from "./components/TransactionExtractionCard";
import { ExcelExportCard } from "./components/ExcelExportCard";
import { RecentFilesTable } from "./components/RecentFilesTable";
import type { TransactionExtractionResultUi } from "./types/transaction";
import { AuthProvider, useAuth, type UserProfile } from "./context/AuthContext";
import { LoginPage } from "./components/auth/LoginPage";
import { safeApiFetch } from "./lib/api-client";
import { AdminUserManagement } from "./components/admin/AdminUserManagement";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

type ProcessingStage =
  | "IDLE"
  | "VALIDATING"
  | "READING"
  | "EXTRACTING"
  | "DETECTING"
  | "SAVING"
  | "EXTRACTING_TRANSACTIONS"
  | "COMPLETED"
  | "ERROR";

interface ProcessingStateInfo {
  stage: ProcessingStage;
  stepNumber: number;
  label: string;
  detail: string;
}

const STAGE_DETAILS: Record<ProcessingStage, ProcessingStateInfo> = {
  IDLE: {
    stage: "IDLE",
    stepNumber: 0,
    label: "Ready",
    detail: "Select a PDF file to begin metadata inspection.",
  },
  VALIDATING: {
    stage: "VALIDATING",
    stepNumber: 1,
    label: "Validating PDF",
    detail: "Verifying MIME type, size limit (≤ 20 MB), and %PDF- file signature.",
  },
  READING: {
    stage: "READING",
    stepNumber: 2,
    label: "Reading PDF",
    detail: "Buffering PDF stream and preparing server payload.",
  },
  EXTRACTING: {
    stage: "EXTRACTING",
    stepNumber: 3,
    label: "Extracting metadata",
    detail: "Parsing trailer dictionary, document catalog, and page count.",
  },
  DETECTING: {
    stage: "DETECTING",
    stepNumber: 4,
    label: "Detecting bank & period",
    detail: "Evaluating rule-based Indonesian bank models, period, and account markers.",
  },
  SAVING: {
    stage: "SAVING",
    stepNumber: 5,
    label: "Saving result",
    detail: "Persisting Statement and BankAccount records to Neon PostgreSQL.",
  },
  EXTRACTING_TRANSACTIONS: {
    stage: "EXTRACTING_TRANSACTIONS",
    stepNumber: 6,
    label: "Extracting transactions",
    detail: "Parsing transaction rows, debit/credit mutations, and balance continuity.",
  },
  COMPLETED: {
    stage: "COMPLETED",
    stepNumber: 7,
    label: "Completed",
    detail: "Analysis complete and persisted.",
  },
  ERROR: {
    stage: "ERROR",
    stepNumber: 0,
    label: "Processing Failed",
    detail: "An error occurred during inspection.",
  },
};

interface MainWorkspaceProps {
  user: UserProfile;
  logout: () => Promise<void>;
  activeTab: "workspace" | "users";
  setActiveTab: (tab: "workspace" | "users") => void;
}

function MainWorkspace({ user, logout, activeTab, setActiveTab }: MainWorkspaceProps) {
  const [selectedRawFile, setSelectedRawFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Processing & result state
  const [processingStage, setProcessingStage] = useState<ProcessingStage>("IDLE");
  const [activeResult, setActiveResult] = useState<{
    document: DocumentRecord;
    metadata: DocumentMetadataRecord;
    isDuplicate: boolean;
  } | null>(null);
  const [bankDetectionResult, setBankDetectionResult] =
    useState<BankDetectionResultUi | null>(null);
  const [isDetectingBank, setIsDetectingBank] = useState<boolean>(false);
  const [transactionExtractionResult, setTransactionExtractionResult] =
    useState<TransactionExtractionResultUi | null>(null);
  const [isExtractingTransactions, setIsExtractingTransactions] =
    useState<boolean>(false);

  // Recent files state
  const [recentFiles, setRecentFiles] = useState<RecentDocumentItem[]>([]);
  const [loadingRecent, setLoadingRecent] = useState<boolean>(true);

  // Load recent files on mount
  const fetchRecentFiles = useCallback(async () => {
    try {
      setLoadingRecent(true);
      const res = await safeApiFetch<{ success: boolean; data: RecentDocumentItem[] }>("/api/documents/recent");
      if (res.ok && res.data?.success && Array.isArray(res.data.data)) {
        setRecentFiles(res.data.data);
      } else {
        setRecentFiles([]);
      }
    } catch {
      // Fallback silently if API is unreachable
      setRecentFiles([]);
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    fetchRecentFiles();
  }, [fetchRecentFiles]);

  /**
   * Helper to convert a File into a base64 string
   */
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1] || result;
        resolve(base64);
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  };

  /**
   * Client-side validation: Checks MIME, extension, size, and reads %PDF- magic bytes.
   */
  const validateFile = useCallback(async (file: File): Promise<boolean> => {
    setErrorMessage(null);
    setActiveResult(null);
    setBankDetectionResult(null);

    // 1. File Type Validation (PDF only)
    const isPdfMime = file.type === "application/pdf" || file.type === "";
    const hasPdfExtension = file.name.toLowerCase().endsWith(".pdf");

    if (!isPdfMime || !hasPdfExtension) {
      setErrorMessage(
        `Invalid file format: "${file.name}". Only PDF files (.pdf) are permitted.`
      );
      setSelectedRawFile(null);
      return false;
    }

    // 2. Empty File Check
    if (file.size === 0) {
      setErrorMessage("The selected file is empty (0 bytes). Please choose a valid PDF file.");
      setSelectedRawFile(null);
      return false;
    }

    // 3. Maximum Size Check (20 MB)
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setErrorMessage(
        `File size exceeds 20 MB limit: "${file.name}" is ${formatBytes(file.size)}. Please upload a file under 20 MB.`
      );
      setSelectedRawFile(null);
      return false;
    }

    // 4. File Signature Validation (%PDF-)
    try {
      const slice = file.slice(0, 1024);
      const text = await slice.text();
      if (!text.includes("%PDF-")) {
        setErrorMessage(
          `Invalid PDF signature: "${file.name}" does not start with the required %PDF- header.`
        );
        setSelectedRawFile(null);
        return false;
      }
    } catch {
      setErrorMessage("Failed to inspect file signature. Please try another file.");
      setSelectedRawFile(null);
      return false;
    }

    // Validated successfully
    setSelectedRawFile(file);
    return true;
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await validateFile(e.target.files[0]);
    }
  };

  const handleClearFile = () => {
    setSelectedRawFile(null);
    setErrorMessage(null);
    setBankDetectionResult(null);
    setTransactionExtractionResult(null);
    setProcessingStage("IDLE");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleResetWorkflow = () => {
    setSelectedRawFile(null);
    setActiveResult(null);
    setBankDetectionResult(null);
    setTransactionExtractionResult(null);
    setErrorMessage(null);
    setProcessingStage("IDLE");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  /**
   * Fetches existing persisted transactions for a selected document.
   */
  const fetchExistingTransactions = async (documentId: string) => {
    try {
      const res = await safeApiFetch<any>(`/api/transaction-extraction?documentId=${documentId}`);
      if (res.ok && res.data?.success && res.data.statement?.transactions?.length > 0) {
        const txs = res.data.statement.transactions.map((t: any) => ({
          id: t.id,
          transactionDate: new Date(t.transactionDate).toISOString().split("T")[0],
          description: t.description,
          referenceNumber: t.referenceNumber,
          debit: t.debit ? t.debit.toString() : null,
          credit: t.credit ? t.credit.toString() : null,
          balance: t.balance ? t.balance.toString() : "0.00",
          transactionType: t.transactionType,
          category: t.category,
        }));

        setTransactionExtractionResult({
          documentId,
          statementId: res.data.statement.id,
          status: "COMPLETED",
          summary: {
            totalRowsDetected: txs.length,
            totalTransactionsParsed: txs.length,
            totalTransactionsRejected: 0,
            totalTransactionsNeedingReview: 0,
            totalCredit: res.data.statement.totalCredit?.toString() || "0.00",
            totalDebit: res.data.statement.totalDebit?.toString() || "0.00",
            openingBalance: res.data.statement.openingBalance?.toString() || null,
            closingBalance: res.data.statement.closingBalance?.toString() || null,
            balanceReconciliationStatus: "VALID",
          },
          transactions: txs,
          reviewRows: [],
        });
      }
    } catch {
      // ignore
    }
  };

  /**
   * Executes Transaction Extraction Engine for an existing document.
   */
  const triggerTransactionExtraction = async (
    documentId: string,
    fileBase64Fallback?: string
  ) => {
    try {
      setIsExtractingTransactions(true);
      const res = await safeApiFetch<any>("/api/transaction-extraction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          fileBase64: fileBase64Fallback,
        }),
      });

      if (res.ok && res.data?.success) {
        const json = res.data;
        setTransactionExtractionResult({
          documentId: json.documentId,
          statementId: json.statementId,
          status: json.status,
          summary: json.summary,
          transactions: json.transactions || [],
          reviewRows: json.reviewRows || [],
          validation: json.validation,
          warning: json.warning,
        });
      }
    } catch {
      // keep null or error
    } finally {
      setIsExtractingTransactions(false);
    }
  };

  /**
   * Executes Bank Statement Detection API on a given document ID.
   */
  const triggerBankDetection = async (
    documentId: string,
    fileBase64Fallback?: string
  ) => {
    try {
      setIsDetectingBank(true);
      const res = await safeApiFetch<BankDetectionApiResponse>("/api/bank-detection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          fileBase64: fileBase64Fallback,
        }),
      });

      if (res.ok && res.data?.success && res.data.detection) {
        setBankDetectionResult(res.data.detection);
      } else {
        setBankDetectionResult(null);
      }
    } catch {
      // Detection failure should not crash existing metadata view
      setBankDetectionResult(null);
    } finally {
      setIsDetectingBank(false);
    }
  };

  /**
   * Triggers both PDF Metadata extraction and Bank Statement Detection engines.
   */
  const handleStartExtraction = async () => {
    if (!selectedRawFile) return;

    setErrorMessage(null);

    try {
      // 1. Validating PDF
      setProcessingStage("VALIDATING");
      await new Promise((r) => setTimeout(r, 150));

      // 2. Reading PDF
      setProcessingStage("READING");
      const base64Promise = fileToBase64(selectedRawFile).catch(() => undefined);
      const formData = new FormData();
      formData.append("file", selectedRawFile, selectedRawFile.name);

      // 3. Extracting metadata
      setProcessingStage("EXTRACTING");
      const inspectRes = await safeApiFetch<InspectApiResponse>("/api/pdf/inspect", {
        method: "POST",
        body: formData,
      });

      if (!inspectRes.ok || !inspectRes.data?.success || !inspectRes.data?.data) {
        throw new Error(inspectRes.error || inspectRes.data?.error || "Server failed to extract PDF metadata.");
      }
      const inspectData = inspectRes.data.data;
      const isDuplicate = Boolean(inspectRes.data.isDuplicate);

      // 4. Detecting Bank & Statement Period
      setProcessingStage("DETECTING");
      const base64 = await base64Promise;

      const detectionRes = await safeApiFetch<BankDetectionApiResponse>("/api/bank-detection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: inspectData.document.id,
          fileBase64: base64,
        }),
      });

      // 5. Saving result
      setProcessingStage("SAVING");
      if (detectionRes.ok && detectionRes.data?.success && detectionRes.data?.detection) {
        setBankDetectionResult(detectionRes.data.detection);

        // If detected as a text-based bank statement, automatically extract transactions
        if (
          detectionRes.data.detection.documentType === "BANK_STATEMENT" &&
          !detectionRes.data.detection.isScannedOrImageOnly
        ) {
          setProcessingStage("EXTRACTING_TRANSACTIONS");
          await triggerTransactionExtraction(inspectData.document.id, base64);
        }
      } else {
        setBankDetectionResult(null);
      }

      // 6. Completed
      setProcessingStage("COMPLETED");
      setActiveResult({
        document: inspectData.document,
        metadata: inspectData.metadata,
        isDuplicate,
      });

      // Refresh recent files list
      fetchRecentFiles();
    } catch (err: unknown) {
      setProcessingStage("ERROR");
      const msg =
        err instanceof Error ? err.message : "An unexpected processing error occurred.";
      setErrorMessage(msg);
    }
  };

  const isProcessing =
    processingStage === "VALIDATING" ||
    processingStage === "READING" ||
    processingStage === "EXTRACTING" ||
    processingStage === "DETECTING" ||
    processingStage === "SAVING" ||
    processingStage === "EXTRACTING_TRANSACTIONS";

  // Dynamic workflow stepper status
  const workflowSteps = [
    {
      id: "upload",
      number: "01",
      name: "UPLOAD PDF",
      status: activeResult ? "COMPLETED" : "CURRENT",
      description: "Select & validate PDF file",
      icon: UploadCloud,
    },
    {
      id: "metadata",
      number: "02",
      name: "METADATA",
      status:
        isProcessing &&
        (processingStage === "VALIDATING" ||
          processingStage === "READING" ||
          processingStage === "EXTRACTING")
          ? "CURRENT"
          : activeResult
          ? "COMPLETED"
          : "UPCOMING",
      description: "Extract header & SHA-256",
      icon: Search,
    },
    {
      id: "detect",
      number: "03",
      name: "DETECT BANK",
      status:
        isProcessing && (processingStage === "DETECTING" || processingStage === "SAVING")
          ? "CURRENT"
          : activeResult
          ? "COMPLETED"
          : "UPCOMING",
      description: "Identify bank & period",
      icon: Landmark,
    },
    {
      id: "export",
      number: "04",
      name: "TRANSACTIONS",
      status:
        isProcessing && processingStage === "EXTRACTING_TRANSACTIONS"
          ? "CURRENT"
          : transactionExtractionResult
          ? "COMPLETED"
          : "UPCOMING",
      description: "Extract, reconcile & review",
      icon: FileSpreadsheet,
    },
  ];

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col font-sans antialiased">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-neutral-900 flex items-center justify-center text-white shadow-xs">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-base tracking-tight text-neutral-950">
                    Metadata Checker
                  </span>
                  <span className="text-[11px] font-medium bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded border border-neutral-200">
                    Engine v1.0
                  </span>
                </div>
                <p className="text-[11px] text-neutral-500 hidden sm:block">
                  PDF Metadata &amp; Bank Statement Analyzer
                </p>
              </div>
            </div>

            {/* Navigation tabs for Admin */}
            {user.role === "ADMIN" && (
              <nav className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => setActiveTab("workspace")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                    activeTab === "workspace"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <LayoutDashboard className="w-3.5 h-3.5" />
                  <span>Workspace</span>
                </button>
                <button
                  id="admin-nav-users-tab"
                  type="button"
                  onClick={() => setActiveTab("users")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                    activeTab === "users"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Users &amp; RBAC</span>
                </button>
              </nav>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs">
              <Database className="w-3.5 h-3.5 text-emerald-600" />
              <span>Neon PostgreSQL Connected</span>
            </span>

            {/* User profile capsule & Sign Out */}
            <div className="flex items-center gap-2.5 pl-2 border-l border-slate-200">
              <div className="text-right hidden sm:block">
                <div className="text-xs font-semibold text-slate-900 leading-tight">
                  {user.name || user.email.split("@")[0]}
                </div>
                <div className="flex items-center justify-end gap-1 mt-0.5">
                  <span
                    className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded ${
                      user.role === "ADMIN"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {user.role}
                  </span>
                </div>
              </div>

              <button
                id="sign-out-button"
                type="button"
                onClick={() => logout()}
                title="Sign Out"
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-red-700 hover:bg-red-50 rounded-lg border border-slate-200 hover:border-red-200 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8">
        {activeTab === "users" && user.role === "ADMIN" ? (
          <AdminUserManagement />
        ) : (
          <>
            {/* Title & Short Explanation */}
        <section className="text-center max-w-2xl mx-auto space-y-2">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-neutral-950">
            PDF Metadata &amp; Bank Statement Analyzer
          </h1>
          <p className="text-sm text-neutral-600 leading-relaxed">
            Upload any PDF bank statement to detect Indonesian financial institutions, extract statement periods, inspect metadata, and verify SHA-256 audit records.
          </p>
        </section>

        {/* Primary Workflow Stepper */}
        <section className="bg-white border border-neutral-200 rounded-xl p-4 sm:p-5 shadow-xs">
          <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-3 text-center sm:text-left">
            Primary Processing Workflow
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {workflowSteps.map((step, idx) => {
              const Icon = step.icon;
              const isCurrent = step.status === "CURRENT";
              const isCompleted = step.status === "COMPLETED";
              return (
                <div
                  key={step.id}
                  className={`p-3.5 rounded-lg border transition-all ${
                    isCurrent
                      ? "bg-neutral-900 text-white border-neutral-900 shadow-xs"
                      : isCompleted
                      ? "bg-emerald-50/60 text-emerald-900 border-emerald-200"
                      : "bg-neutral-50/60 text-neutral-600 border-neutral-200/70"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold ${
                        isCurrent
                          ? "bg-neutral-800 text-neutral-200"
                          : isCompleted
                          ? "bg-emerald-200/80 text-emerald-900"
                          : "bg-neutral-200 text-neutral-700"
                      }`}
                    >
                      {step.number}
                    </span>
                    <Icon
                      className={`w-4 h-4 ${
                        isCurrent
                          ? "text-neutral-200"
                          : isCompleted
                          ? "text-emerald-700"
                          : "text-neutral-400"
                      }`}
                    />
                  </div>
                  <div className="font-bold text-xs tracking-tight flex items-center gap-1.5">
                    <span>{step.name}</span>
                    {idx < workflowSteps.length - 1 && (
                      <span className="text-[10px] opacity-40 ml-auto hidden lg:inline">→</span>
                    )}
                  </div>
                  <p
                    className={`text-[11px] mt-1 line-clamp-1 ${
                      isCurrent
                        ? "text-neutral-300"
                        : isCompleted
                        ? "text-emerald-700"
                        : "text-neutral-500"
                    }`}
                  >
                    {step.description}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Dynamic Display: Document Analysis & Metadata Result Card OR Upload Area */}
        {activeResult ? (
          <section className="space-y-6 animate-in fade-in duration-200">
            {/* Top Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-neutral-200 shadow-xs">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                  Active Document
                </span>
                <span className="text-sm font-bold text-neutral-900 font-mono">
                  {activeResult.document.originalFileName}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => triggerBankDetection(activeResult.document.id)}
                  disabled={isDetectingBank}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-xs font-medium text-neutral-700 transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isDetectingBank ? "animate-spin" : ""}`} />
                  Re-run Bank Detection
                </button>
                <button
                  type="button"
                  onClick={handleResetWorkflow}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-medium transition-colors cursor-pointer shadow-xs"
                >
                  Upload Another File
                </button>
              </div>
            </div>

            {/* Document Analysis Section (Bank Detection) */}
            <BankAnalysisCard
              detection={bankDetectionResult}
              isLoading={isDetectingBank}
            />

            {/* Transaction Extraction Engine Section */}
            {activeResult.document.documentType !== "OTHER_PDF" && (
              <TransactionExtractionCard
                extraction={transactionExtractionResult}
                isLoading={isExtractingTransactions}
                onExtractTransactions={() =>
                  triggerTransactionExtraction(activeResult.document.id)
                }
                documentId={activeResult.document.id}
                isScannedOrImageOnly={bankDetectionResult?.isScannedOrImageOnly}
              />
            )}

            {/* Bank Statement Excel Export Engine Section */}
            {activeResult.document.documentType !== "OTHER_PDF" && (
              <ExcelExportCard
                documentId={activeResult.document.id}
                extraction={transactionExtractionResult}
                isExtractingTransactions={isExtractingTransactions}
                isScannedOrImageOnly={bankDetectionResult?.isScannedOrImageOnly}
              />
            )}

            {/* PDF Metadata Inspector Section */}
            <MetadataResultCard
              document={activeResult.document}
              metadata={activeResult.metadata}
              isDuplicate={activeResult.isDuplicate}
              onReset={handleResetWorkflow}
            />
          </section>
        ) : (
          <section className="space-y-4">
            <div className="bg-white border border-neutral-200 rounded-2xl p-6 sm:p-8 shadow-xs">
              {/* Error Notification */}
              {errorMessage && (
                <div
                  role="alert"
                  className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-3 text-xs sm:text-sm animate-in fade-in duration-200"
                >
                  <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div className="space-y-0.5 flex-1">
                    <div className="font-semibold text-rose-900">Validation Error</div>
                    <div>{errorMessage}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setErrorMessage(null)}
                    className="text-rose-500 hover:text-rose-700 p-0.5 cursor-pointer"
                    aria-label="Dismiss error"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Drag and Drop Zone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => !isProcessing && fileInputRef.current?.click()}
                className={`relative border-2 border-dashed rounded-xl p-8 sm:p-12 text-center transition-all duration-150 ${
                  isProcessing
                    ? "border-neutral-300 bg-neutral-50 cursor-wait opacity-80"
                    : isDragging
                    ? "border-neutral-900 bg-neutral-100/80 scale-[0.99] cursor-pointer"
                    : selectedRawFile
                    ? "border-emerald-500 bg-emerald-50/20 cursor-pointer"
                    : "border-neutral-300 hover:border-neutral-400 bg-neutral-50/50 cursor-pointer"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={handleFileChange}
                  disabled={isProcessing}
                  className="hidden"
                  id="pdf-file-upload-input"
                />

                <div className="flex flex-col items-center justify-center space-y-4 max-w-md mx-auto">
                  <div
                    className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${
                      isProcessing
                        ? "bg-neutral-900 text-white"
                        : selectedRawFile
                        ? "bg-emerald-100 text-emerald-700"
                        : isDragging
                        ? "bg-neutral-900 text-white"
                        : "bg-neutral-100 text-neutral-700"
                    }`}
                  >
                    {isProcessing ? (
                      <Loader2 className="w-7 h-7 animate-spin" />
                    ) : selectedRawFile ? (
                      <CheckCircle2 className="w-7 h-7" />
                    ) : (
                      <UploadCloud className="w-7 h-7" />
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <h3 className="text-base sm:text-lg font-semibold text-neutral-900">
                      {isProcessing
                        ? STAGE_DETAILS[processingStage].label
                        : selectedRawFile
                        ? "PDF Document Ready for Inspection"
                        : isDragging
                        ? "Drop your PDF file here"
                        : "Upload your PDF bank statement"}
                    </h3>
                    <p className="text-xs sm:text-sm text-neutral-500">
                      {isProcessing
                        ? STAGE_DETAILS[processingStage].detail
                        : "Drag and drop your file here, or click to browse from your device"}
                    </p>
                  </div>

                  {/* Processing Stepper Display during active extraction */}
                  {isProcessing && (
                    <div className="w-full pt-2">
                      <div className="bg-neutral-100 rounded-lg p-3 border border-neutral-200/80 space-y-2 text-left">
                        <div className="flex items-center justify-between text-xs font-semibold text-neutral-800">
                          <span className="flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-900" />
                            Step {STAGE_DETAILS[processingStage].stepNumber} of 6:{" "}
                            {STAGE_DETAILS[processingStage].label}
                          </span>
                        </div>
                        <div className="text-[11px] text-neutral-600">
                          {STAGE_DETAILS[processingStage].detail}
                        </div>
                      </div>
                    </div>
                  )}

                  {!isProcessing && (
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                        className="inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-neutral-900 text-white text-xs sm:text-sm font-medium hover:bg-neutral-800 transition-colors shadow-xs cursor-pointer"
                      >
                        <UploadCloud className="w-4 h-4 mr-2" />
                        {selectedRawFile ? "Change PDF File" : "Select PDF Document"}
                      </button>
                    </div>
                  )}

                  <div className="pt-2 text-[11px] text-neutral-400 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                    <span>Allowed format: PDF only</span>
                    <span>•</span>
                    <span>Max file size: 20 MB</span>
                    <span>•</span>
                    <span>Signature: %PDF- verified</span>
                  </div>
                </div>
              </div>

              {/* Selected File Card Details with Action Button */}
              {selectedRawFile && (
                <div className="mt-6 p-4 sm:p-5 rounded-xl border border-neutral-200 bg-neutral-50/70 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-neutral-900 truncate">
                          {selectedRawFile.name}
                        </p>
                        <p className="text-xs text-neutral-500">
                          {formatBytes(selectedRawFile.size)} • PDF Document
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Valid PDF (≤ 20 MB)
                      </span>
                      {!isProcessing && (
                        <button
                          type="button"
                          onClick={handleClearFile}
                          className="text-xs text-neutral-500 hover:text-rose-600 px-2.5 py-1 rounded-md hover:bg-neutral-200/60 transition-colors cursor-pointer"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-neutral-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="text-xs text-neutral-600 flex items-start gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                      <p className="leading-relaxed">
                        Ready for server-side metadata inspection and Indonesian bank detection.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleStartExtraction}
                      disabled={isProcessing}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-400 text-white text-xs sm:text-sm font-semibold transition-colors shadow-xs cursor-pointer shrink-0"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 text-emerald-400" />
                          Inspect &amp; Analyze Document
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Recent Files Section */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold tracking-tight text-neutral-900 uppercase">
              Recent Files
            </h2>
            <button
              type="button"
              onClick={fetchRecentFiles}
              className="text-xs text-neutral-500 hover:text-neutral-800 transition-colors cursor-pointer"
            >
              Refresh ledger
            </button>
          </div>

          <RecentFilesTable
            documents={recentFiles}
            loading={loadingRecent}
            onSelectDocument={(doc) => {
              if (doc.metadata) {
                setActiveResult({
                  document: doc,
                  metadata: doc.metadata,
                  isDuplicate: false,
                });
                // Fetch detection and transactions for selected document
                triggerBankDetection(doc.id);
                fetchExistingTransactions(doc.id);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
          />
        </section>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-200 bg-white py-6 mt-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-neutral-500">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-neutral-800">Metadata Checker</span>
            <span>—</span>
            <span>PDF Metadata &amp; Bank Statement Analyzer</span>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-neutral-400">
            <span>Stage 3: Bank Detection Engine</span>
            <span>•</span>
            <span>Neon PostgreSQL Active</span>
            <span>•</span>
            <span>Rule-Based Detection</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function AppContent() {
  const { user, loading, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<"workspace" | "users">("workspace");

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-slate-800" />
          <p className="text-xs font-medium text-slate-500 tracking-wide">
            Checking authenticated session...
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <MainWorkspace
      user={user}
      logout={logout}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
    />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

