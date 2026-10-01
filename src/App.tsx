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
  FileSpreadsheet,
  Clock,
  Loader2,
  Landmark,
  RefreshCw,
  LogOut,
  Users,
  LayoutDashboard,
  ShieldCheck,
  Lock,
  KeyRound,
  Unlock,
  Eye,
  EyeOff,
  Menu,
  ChevronRight,
  Check,
  Download,
  Search,
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
import { AnalysisFeatureSelector } from "./components/AnalysisFeatureSelector";
import { UploadProgressBar } from "./components/UploadProgressBar";
import { ProcessingTimeline, type TimelineStep } from "./components/ProcessingTimeline";
import type { TransactionExtractionResultUi } from "./types/transaction";
import { AuthProvider, useAuth, type UserProfile } from "./context/AuthContext";
import { LoginPage } from "./components/auth/LoginPage";
import { safeApiFetch } from "./lib/api-client";
import {
  executeUpload,
  type UploadProgressData,
  type UploadTask,
} from "./lib/upload-client";
import {
  type AnalysisFeature,
  DEFAULT_ANALYSIS_FEATURES,
} from "../lib/analysis/feature-pipeline";
import { AdminUserManagement } from "./components/admin/AdminUserManagement";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

type ProcessingStage =
  | "IDLE"
  | "UPLOADING"
  | "ANALYZING"
  | "VALIDATING"
  | "READING"
  | "PASSWORD_REQUIRED"
  | "DECRYPTING"
  | "INSPECTING"
  | "EXTRACTING"
  | "DETECTING"
  | "SAVING"
  | "EXTRACTING_TRANSACTIONS"
  | "COMPLETED"
  | "WRONG_PASSWORD"
  | "UNSUPPORTED_ENCRYPTION"
  | "INVALID_PDF"
  | "CANCELLED"
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
    detail: "Choose a PDF file to begin metadata and statement inspection.",
  },
  UPLOADING: {
    stage: "UPLOADING",
    stepNumber: 1,
    label: "Uploading",
    detail: "Transferring PDF file to server...",
  },
  ANALYZING: {
    stage: "ANALYZING",
    stepNumber: 2,
    label: "Analyzing",
    detail: "Analyzing file signature and encryption flags...",
  },
  VALIDATING: {
    stage: "VALIDATING",
    stepNumber: 1,
    label: "Validating PDF",
    detail: "Verifying MIME type, size limit (≤ 20 MB), and %PDF- header.",
  },
  READING: {
    stage: "READING",
    stepNumber: 2,
    label: "Reading PDF",
    detail: "Reading document buffer and building payload...",
  },
  PASSWORD_REQUIRED: {
    stage: "PASSWORD_REQUIRED",
    stepNumber: 2,
    label: "Password Required",
    detail: "This PDF is password protected. Enter password to continue analysis.",
  },
  DECRYPTING: {
    stage: "DECRYPTING",
    stepNumber: 3,
    label: "Decrypting",
    detail: "Decrypting document in memory...",
  },
  INSPECTING: {
    stage: "INSPECTING",
    stepNumber: 4,
    label: "Inspecting",
    detail: "Extracting metadata properties, trailer dictionary, and SHA-256...",
  },
  EXTRACTING: {
    stage: "EXTRACTING",
    stepNumber: 3,
    label: "Extracting metadata",
    detail: "Parsing document structure and page count...",
  },
  DETECTING: {
    stage: "DETECTING",
    stepNumber: 4,
    label: "Detecting Bank",
    detail: "Identifying banking institution, period, and masked account...",
  },
  SAVING: {
    stage: "SAVING",
    stepNumber: 5,
    label: "Saving result",
    detail: "Saving document records and statement metrics...",
  },
  EXTRACTING_TRANSACTIONS: {
    stage: "EXTRACTING_TRANSACTIONS",
    stepNumber: 5,
    label: "Extracting Transactions",
    detail: "Extracting transaction rows, debits, credits, and balance reconciliation...",
  },
  COMPLETED: {
    stage: "COMPLETED",
    stepNumber: 6,
    label: "Completed",
    detail: "Document analysis and statement extraction completed.",
  },
  WRONG_PASSWORD: {
    stage: "WRONG_PASSWORD",
    stepNumber: 2,
    label: "Wrong Password",
    detail: "The PDF password was incorrect or the document could not be opened.",
  },
  UNSUPPORTED_ENCRYPTION: {
    stage: "UNSUPPORTED_ENCRYPTION",
    stepNumber: 2,
    label: "Unsupported Encryption",
    detail: "This PDF encryption standard is not supported.",
  },
  INVALID_PDF: {
    stage: "INVALID_PDF",
    stepNumber: 1,
    label: "Invalid PDF",
    detail: "The file is not a valid PDF or has 0 bytes.",
  },
  CANCELLED: {
    stage: "CANCELLED",
    stepNumber: 0,
    label: "Upload Cancelled",
    detail: "Upload process was cancelled by user.",
  },
  ERROR: {
    stage: "ERROR",
    stepNumber: 0,
    label: "Processing Failed",
    detail: "An error occurred while processing the document.",
  },
};

type NavigationTab = "dashboard" | "analyze" | "recent" | "exports" | "admin";

interface MainWorkspaceProps {
  user: UserProfile;
  logout: () => Promise<void>;
  activeTab: NavigationTab;
  setActiveTab: (tab: NavigationTab) => void;
}

function MainWorkspace({ user, logout, activeTab, setActiveTab }: MainWorkspaceProps) {
  const [selectedRawFile, setSelectedRawFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Selected analysis features state
  const [selectedFeatures, setSelectedFeatures] = useState<AnalysisFeature[]>([
    ...DEFAULT_ANALYSIS_FEATURES,
  ]);

  // Upload progress state
  const [uploadProgress, setUploadProgress] = useState<UploadProgressData>({
    state: "IDLE",
    loadedBytes: 0,
    totalBytes: 0,
    percentage: 0,
    speedBytesPerSec: 0,
    formattedSpeed: "0 KB/s",
    etaSeconds: null,
    formattedEta: "Calculating...",
    statusText: "Ready",
  });
  const activeUploadRef = useRef<UploadTask | null>(null);

  // Processing & result state
  const [processingStage, setProcessingStage] = useState<ProcessingStage>("IDLE");
  const [pdfPassword, setPdfPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isPasswordProtected, setIsPasswordProtected] = useState<boolean>(false);
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
      const res = await safeApiFetch<{ success: boolean; data: RecentDocumentItem[] }>(
        "/api/documents/recent"
      );
      if (res.ok && res.data?.success && Array.isArray(res.data.data)) {
        setRecentFiles(res.data.data);
      } else {
        setRecentFiles([]);
      }
    } catch {
      setRecentFiles([]);
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    fetchRecentFiles();
  }, [fetchRecentFiles]);

  const handleCancelUpload = () => {
    if (activeUploadRef.current) {
      activeUploadRef.current.abort();
      activeUploadRef.current = null;
    }
    setProcessingStage("CANCELLED");
    setUploadProgress((prev) => ({
      ...prev,
      state: "CANCELLED",
      statusText: "Upload cancelled",
    }));
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
      setErrorMessage("File terlalu besar. Maksimum ukuran PDF adalah 20 MB.");
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
      setErrorMessage("Failed to read the file header. Please ensure the file is not corrupted.");
      setSelectedRawFile(null);
      return false;
    }

    setSelectedRawFile(file);
    setProcessingStage("IDLE");
    setUploadProgress({
      state: "SELECTED",
      loadedBytes: 0,
      totalBytes: file.size,
      percentage: 0,
      speedBytesPerSec: 0,
      formattedSpeed: "0 KB/s",
      etaSeconds: null,
      formattedEta: "Calculating...",
      statusText: "Ready to analyze",
    });
    return true;
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await validateFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await validateFile(file);
    }
  };

  const handleResetWorkflow = () => {
    setSelectedRawFile(null);
    setActiveResult(null);
    setBankDetectionResult(null);
    setTransactionExtractionResult(null);
    setProcessingStage("IDLE");
    setPdfPassword("");
    setPasswordError(null);
    setIsPasswordProtected(false);
    setErrorMessage(null);
    setUploadProgress({
      state: "IDLE",
      loadedBytes: 0,
      totalBytes: 0,
      percentage: 0,
      speedBytesPerSec: 0,
      formattedSpeed: "0 KB/s",
      etaSeconds: null,
      formattedEta: "Calculating...",
      statusText: "Ready",
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleClearFile = () => {
    setSelectedRawFile(null);
    setProcessingStage("IDLE");
    setPdfPassword("");
    setPasswordError(null);
    setIsPasswordProtected(false);
    setUploadProgress({
      state: "IDLE",
      loadedBytes: 0,
      totalBytes: 0,
      percentage: 0,
      speedBytesPerSec: 0,
      formattedSpeed: "0 KB/s",
      etaSeconds: null,
      formattedEta: "Calculating...",
      statusText: "Ready",
    });
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
            totalTransactionsNeedingReview: 0,
            totalTransactionsRejected: 0,
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
      setBankDetectionResult(null);
    } finally {
      setIsDetectingBank(false);
    }
  };

  /**
   * Primary pipeline that inspects PDF, decrypts if password is provided,
   * detects bank, and extracts transactions.
   */
  const executeProcessingPipeline = async (passwordToUse?: string) => {
    if (!selectedRawFile) return;

    setErrorMessage(null);
    setPasswordError(null);

    try {
      if (passwordToUse) {
        setProcessingStage("DECRYPTING");
      } else {
        setProcessingStage("UPLOADING");
      }

      const formData = new FormData();
      formData.append("file", selectedRawFile, selectedRawFile.name);
      formData.append("features", JSON.stringify(selectedFeatures));
      if (passwordToUse) {
        formData.append("password", passwordToUse);
      }

      const token = typeof window !== "undefined" ? localStorage.getItem("mc_token") : null;
      const uploadTask = executeUpload<InspectApiResponse>({
        url: "/api/pdf/inspect",
        formData,
        token,
        onProgress: (p) => {
          setUploadProgress(p);
          if (p.state === "UPLOADING") {
            setProcessingStage("UPLOADING");
          } else if (p.state === "UPLOADED" || p.state === "PROCESSING") {
            if (passwordToUse) {
              setProcessingStage("DECRYPTING");
            } else {
              setProcessingStage("INSPECTING");
            }
          } else if (p.state === "CANCELLED") {
            setProcessingStage("CANCELLED");
          }
        },
      });

      activeUploadRef.current = uploadTask;
      const inspectRes = await uploadTask.promise;
      activeUploadRef.current = null;

      if (inspectRes.error === "Upload cancelled by user.") {
        return;
      }

      // Handle password required (HTTP 422 or requiresPassword)
      if (
        inspectRes.data?.requiresPassword ||
        (inspectRes.status === 422 && inspectRes.data?.securityState === "PASSWORD_PROTECTED")
      ) {
        setIsPasswordProtected(true);
        if (passwordToUse) {
          setProcessingStage("WRONG_PASSWORD");
          setPasswordError(
            inspectRes.data?.error ||
            "Password PDF salah atau dokumen tidak dapat dibuka. Pastikan password sesuai."
          );
        } else {
          setProcessingStage("PASSWORD_REQUIRED");
        }
        return;
      }

      // Handle unsupported encryption
      if (
        inspectRes.data?.securityState === "UNSUPPORTED_ENCRYPTION" ||
        (inspectRes.data?.error && inspectRes.data.error.includes("belum didukung"))
      ) {
        setProcessingStage("UNSUPPORTED_ENCRYPTION");
        setErrorMessage(
          inspectRes.data?.error || "Jenis enkripsi PDF ini belum didukung."
        );
        return;
      }

      // Handle invalid PDF
      if (
        inspectRes.data?.securityState === "INVALID_PDF" ||
        inspectRes.status === 400
      ) {
        setProcessingStage("INVALID_PDF");
        setErrorMessage(
          inspectRes.data?.error || inspectRes.error || "File yang diunggah bukan file PDF yang valid."
        );
        return;
      }

      if (!inspectRes.ok || !inspectRes.data?.success || !inspectRes.data?.data) {
        throw new Error(
          inspectRes.data?.error || inspectRes.error || "Server failed to extract PDF metadata."
        );
      }

      // Successfully inspected & decrypted!
      setProcessingStage("INSPECTING");
      const inspectData = inspectRes.data.data;
      const isDuplicate = Boolean(inspectRes.data.isDuplicate);

      // Clean up password state in memory
      setPdfPassword("");
      setPasswordError(null);
      setIsPasswordProtected(false);

      // Check if server-side pipeline returned bank detection & transaction extraction
      const serverDetection = inspectData.detection;
      const serverExtraction = inspectData.extraction;

      if (serverDetection) {
        setBankDetectionResult(serverDetection);
      } else {
        setBankDetectionResult(null);
      }

      if (serverExtraction) {
        setTransactionExtractionResult({
          documentId: serverExtraction.documentId,
          statementId: serverExtraction.statementId,
          status: serverExtraction.status,
          summary: serverExtraction.summary,
          transactions: serverExtraction.transactions || [],
          reviewRows: serverExtraction.reviewRows || [],
          validation: serverExtraction.validation,
          warning: serverExtraction.warning,
        });
      } else {
        setTransactionExtractionResult(null);
      }

      // Completed - always set active result so metadata and analysis are visible
      setProcessingStage("COMPLETED");
      setActiveResult({
        document: inspectData.document,
        metadata: inspectData.metadata || {
          id: "",
          documentId: inspectData.document.id,
          title: null,
          author: null,
          subject: null,
          creator: null,
          producer: null,
          creationDate: null,
          modificationDate: null,
          pageCount: null,
          fileHash: null,
          rawMetadataJson: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
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

  const handleStartExtraction = async () => {
    await executeProcessingPipeline();
  };

  const handleUnlockAndAnalyze = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanPwd = pdfPassword ? pdfPassword.trim() : "";
    if (!cleanPwd) {
      setPasswordError("This document is password protected. Enter the password to continue.");
      return;
    }
    await executeProcessingPipeline(cleanPwd);
  };

  const isProcessing =
    processingStage === "UPLOADING" ||
    processingStage === "ANALYZING" ||
    processingStage === "VALIDATING" ||
    processingStage === "READING" ||
    processingStage === "DECRYPTING" ||
    processingStage === "INSPECTING" ||
    processingStage === "EXTRACTING" ||
    processingStage === "DETECTING" ||
    processingStage === "SAVING" ||
    processingStage === "EXTRACTING_TRANSACTIONS";

  // Dynamic workflow stepper status
  const timelineSteps: TimelineStep[] = [
    {
      id: "upload",
      label: "Upload PDF",
      status:
        uploadProgress.state === "COMPLETED" ||
        uploadProgress.state === "PROCESSING" ||
        uploadProgress.state === "UPLOADED" ||
        processingStage === "COMPLETED" ||
        activeResult
          ? "COMPLETED"
          : uploadProgress.state === "UPLOADING"
          ? "PROCESSING"
          : uploadProgress.state === "FAILED" || uploadProgress.state === "CANCELLED"
          ? "FAILED"
          : "PENDING",
      detail: selectedRawFile ? formatBytes(selectedRawFile.size) : undefined,
    },
    {
      id: "metadata",
      label: "PDF Metadata",
      isSkipped: !selectedFeatures.includes("metadata"),
      status: !selectedFeatures.includes("metadata")
        ? "SKIPPED"
        : activeResult?.metadata
        ? "COMPLETED"
        : processingStage === "INSPECTING" || processingStage === "EXTRACTING"
        ? "PROCESSING"
        : processingStage === "COMPLETED" && !activeResult?.metadata
        ? "FAILED"
        : "PENDING",
      detail: activeResult?.metadata?.pageCount ? `${activeResult.metadata.pageCount} pages` : undefined,
    },
    {
      id: "bankDetection",
      label: "Bank Detection",
      isSkipped: !selectedFeatures.includes("bankDetection"),
      status: !selectedFeatures.includes("bankDetection")
        ? "SKIPPED"
        : bankDetectionResult
        ? "COMPLETED"
        : isDetectingBank || processingStage === "DETECTING"
        ? "PROCESSING"
        : processingStage === "COMPLETED" && !bankDetectionResult
        ? "FAILED"
        : "PENDING",
      detail: bankDetectionResult?.bankName || undefined,
    },
    {
      id: "transactionExtraction",
      label: "Transaction Extraction",
      isSkipped: !selectedFeatures.includes("transactionExtraction"),
      status: !selectedFeatures.includes("transactionExtraction")
        ? "SKIPPED"
        : transactionExtractionResult?.status === "COMPLETED"
        ? "COMPLETED"
        : transactionExtractionResult?.status === "NEEDS_REVIEW"
        ? "PARTIAL"
        : isExtractingTransactions || processingStage === "EXTRACTING_TRANSACTIONS"
        ? "PROCESSING"
        : processingStage === "COMPLETED" && !transactionExtractionResult
        ? "FAILED"
        : "PENDING",
      detail: transactionExtractionResult ? `${transactionExtractionResult.transactions.length} transactions` : undefined,
    },
    {
      id: "validation",
      label: "Balance Validation",
      isSkipped: !selectedFeatures.includes("validation"),
      status: !selectedFeatures.includes("validation")
        ? "SKIPPED"
        : transactionExtractionResult?.validation
        ? "COMPLETED"
        : isExtractingTransactions
        ? "PROCESSING"
        : processingStage === "COMPLETED" && !transactionExtractionResult?.validation
        ? "FAILED"
        : "PENDING",
    },
    {
      id: "excelExport",
      label: "Excel Export",
      isSkipped: !selectedFeatures.includes("excelExport"),
      status: !selectedFeatures.includes("excelExport")
        ? "SKIPPED"
        : transactionExtractionResult && transactionExtractionResult.transactions.length > 0
        ? "COMPLETED"
        : isExtractingTransactions
        ? "PROCESSING"
        : processingStage === "COMPLETED" && !transactionExtractionResult?.transactions?.length
        ? "FAILED"
        : "PENDING",
    },
  ];

  const handleSelectRecentDoc = (doc: RecentDocumentItem) => {
    if (doc.metadata) {
      setActiveResult({
        document: doc,
        metadata: doc.metadata,
        isDuplicate: false,
      });
      triggerBankDetection(doc.id);
      fetchExistingTransactions(doc.id);
      setActiveTab("analyze");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans antialiased">
      {/* GLOBAL APPLICATION SHELL HEADER */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Brand Logo & Name */}
          <div className="flex items-center gap-8">
            <button
              type="button"
              onClick={() => setActiveTab("dashboard")}
              className="flex items-center gap-3 text-left cursor-pointer group"
            >
              <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs transition-transform group-hover:scale-105">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <span className="font-bold text-base tracking-tight text-slate-900 block leading-tight">
                  Metadata Checker
                </span>
                <span className="text-[11px] text-slate-500 font-medium block">
                  Document Intelligence
                </span>
              </div>
            </button>

            {/* Desktop Navigation Links */}
            <nav className="hidden md:flex items-center gap-1">
              <button
                type="button"
                onClick={() => setActiveTab("dashboard")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  activeTab === "dashboard"
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                Dashboard
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("analyze")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  activeTab === "analyze"
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                Analyze PDF
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("recent")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  activeTab === "recent"
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                Recent Files
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("exports")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  activeTab === "exports"
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                Exports
              </button>
              {user.role === "ADMIN" && (
                <button
                  id="admin-nav-users-tab"
                  type="button"
                  onClick={() => setActiveTab("admin")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
                    activeTab === "admin"
                      ? "bg-purple-50 text-purple-700 font-bold"
                      : "text-purple-600 hover:bg-purple-50"
                  }`}
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>Admin</span>
                </button>
              )}
            </nav>
          </div>

          {/* Right Section: User Identity & Actions */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col text-right pr-2">
              <span className="text-xs font-semibold text-slate-900 leading-tight">
                {user.name || user.email.split("@")[0]}
              </span>
              <span className="text-[11px] text-slate-500 font-mono">
                {user.email}
              </span>
            </div>

            <button
              id="sign-out-button"
              type="button"
              onClick={() => logout()}
              title="Sign Out"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-lg transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>

            {/* Mobile menu toggle */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 text-slate-600 hover:text-slate-900 rounded-lg border border-slate-200 cursor-pointer"
              aria-label="Toggle navigation menu"
            >
              <Menu className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mobile Navigation Dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-200 bg-white px-4 py-3 space-y-1">
            <button
              type="button"
              onClick={() => {
                setActiveTab("dashboard");
                setMobileMenuOpen(false);
              }}
              className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab("analyze");
                setMobileMenuOpen(false);
              }}
              className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Analyze PDF
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab("recent");
                setMobileMenuOpen(false);
              }}
              className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Recent Files
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab("exports");
                setMobileMenuOpen(false);
              }}
              className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Exports
            </button>
            {user.role === "ADMIN" && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab("admin");
                  setMobileMenuOpen(false);
                }}
                className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold text-purple-700 hover:bg-purple-50"
              >
                Admin Console
              </button>
            )}
          </div>
        )}
      </header>

      {/* MAIN VIEW CONTAINER */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        {/* ============================================================== */}
        {/* VIEW 1: ADMIN CONSOLE */}
        {/* ============================================================== */}
        {activeTab === "admin" && user.role === "ADMIN" && (
          <div className="space-y-6">
            <AdminUserManagement />
          </div>
        )}

        {/* ============================================================== */}
        {/* VIEW 2: RECENT FILES DEDICATED PAGE */}
        {/* ============================================================== */}
        {activeTab === "recent" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                  Recent Files
                </h1>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                  Access your previously analyzed PDF statements and historical reports.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={fetchRecentFiles}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingRecent ? "animate-spin" : ""}`} />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("analyze")}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors cursor-pointer"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  Analyze New PDF
                </button>
              </div>
            </div>

            <RecentFilesTable
              documents={recentFiles}
              loading={loadingRecent}
              onSelectDocument={handleSelectRecentDoc}
              onAnalyzeNew={() => setActiveTab("analyze")}
            />
          </div>
        )}

        {/* ============================================================== */}
        {/* VIEW 3: EXPORTS DEDICATED PAGE */}
        {/* ============================================================== */}
        {activeTab === "exports" && (
          <div className="space-y-6">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                Excel Exports
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                Download structured Excel workbooks with transactions, reconciliation, and audit sheets.
              </p>
            </div>

            {activeResult ? (
              <ExcelExportCard
                documentId={activeResult.document.id}
                extraction={transactionExtractionResult}
                isExtractingTransactions={isExtractingTransactions}
                isScannedOrImageOnly={bankDetectionResult?.isScannedOrImageOnly}
              />
            ) : recentFiles.length > 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-7 shadow-xs space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center justify-center shrink-0">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Select a Document to Export
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Choose an analyzed statement from your ledger below to generate or download an Excel workbook.
                    </p>
                  </div>
                </div>

                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                  {recentFiles.slice(0, 5).map((doc) => (
                    <div
                      key={doc.id}
                      className="p-3.5 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                        <span className="text-xs font-semibold text-slate-900 truncate">
                          {doc.originalFileName}
                        </span>
                        <span className="text-[11px] text-slate-500 hidden sm:inline">
                          · {doc.statement?.bankName || "Document"}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSelectRecentDoc(doc)}
                        className="px-3 py-1 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                      >
                        Open &amp; Export
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center shadow-xs space-y-3">
                <FileSpreadsheet className="w-10 h-10 text-slate-300 mx-auto" />
                <h3 className="text-sm font-semibold text-slate-900">No Exportable Statements</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Analyze a PDF bank statement first to extract transactions and download your Excel workbook.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab("analyze")}
                  className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700 cursor-pointer shadow-xs"
                >
                  Analyze PDF
                </button>
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* VIEW 4: HOME / DASHBOARD (Section 4) */}
        {/* ============================================================== */}
        {activeTab === "dashboard" && (
          <div className="space-y-12 animate-in fade-in duration-200">
            {/* HERO SECTION */}
            <section className="text-center max-w-3xl mx-auto space-y-4 pt-4 sm:pt-6">
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-900">
                Analyze Your Financial Documents Smarter
              </h1>
              <p className="text-base sm:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
                Upload a PDF bank statement, choose the analysis you need, and get structured insights in seconds.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("analyze")}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-xs transition-colors cursor-pointer"
                >
                  <span>Analyze PDF</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("recent")}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-sm font-semibold shadow-xs transition-colors cursor-pointer"
                >
                  <span>View Recent Files</span>
                </button>
              </div>
            </section>

            {/* WORKFLOW EXPLANATION: 01 to 05 */}
            <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-xs space-y-6">
              <div className="text-center max-w-md mx-auto space-y-1">
                <span className="text-[11px] font-semibold text-blue-600 uppercase tracking-wider block">
                  Workflow Guide
                </span>
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                  How Metadata Checker Works
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {[
                  {
                    num: "01",
                    title: "Upload PDF",
                    desc: "Drag & drop PDF bank statements up to 20 MB with SHA-256 integrity validation.",
                    icon: UploadCloud,
                  },
                  {
                    num: "02",
                    title: "Choose Analysis",
                    desc: "Select specific engines: metadata, bank detection, transactions, or validation.",
                    icon: Layers,
                  },
                  {
                    num: "03",
                    title: "Process Securely",
                    desc: "Encrypted PDFs decrypted in-memory with zero persistent credentials.",
                    icon: ShieldCheck,
                  },
                  {
                    num: "04",
                    title: "Review Results",
                    desc: "Inspect metadata, detected Indonesian bank, and transaction records.",
                    icon: CheckCircle2,
                  },
                  {
                    num: "05",
                    title: "Export Data",
                    desc: "Download structured 4-sheet Excel workbook ready for audit and accounting.",
                    icon: FileSpreadsheet,
                  },
                ].map((step, idx) => {
                  const Icon = step.icon;
                  return (
                    <div
                      key={step.num}
                      className="p-4 rounded-xl border border-slate-200/80 bg-slate-50/50 space-y-2.5 relative group hover:bg-white hover:border-slate-300 transition-all"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">
                          {step.num}
                        </span>
                        <Icon className="w-4 h-4 text-slate-400 group-hover:text-blue-600 transition-colors" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 tracking-tight">
                        {step.title}
                      </h3>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        {step.desc}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* FEATURE SECTION: "Everything You Need" */}
            <section className="space-y-6">
              <div className="text-center max-w-md mx-auto space-y-1">
                <span className="text-[11px] font-semibold text-blue-600 uppercase tracking-wider block">
                  Comprehensive Platform
                </span>
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                  Everything You Need
                </h2>
                <p className="text-xs text-slate-500">
                  Built specifically for Indonesian bank statements and financial compliance.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  {
                    title: "PDF Metadata",
                    desc: "Inspect PDF creator, producer, dates, page count, and cryptographic SHA-256 fingerprint.",
                    icon: FileText,
                  },
                  {
                    title: "Bank Detection",
                    desc: "Identify Indonesian institutions (BNI, BCA, BRI, Mandiri) and masked account information.",
                    icon: Landmark,
                  },
                  {
                    title: "Transaction Extraction",
                    desc: "Extract transaction dates, descriptions, debit, credit and balance into structured data.",
                    icon: Layers,
                  },
                  {
                    title: "Balance Validation",
                    desc: "Validate balance continuity, opening/closing delta reconciliation, and mathematical truth.",
                    icon: ShieldCheck,
                  },
                  {
                    title: "Excel Export",
                    desc: "Export analysis results into a structured, audit-ready Excel workbook with multiple tabs.",
                    icon: FileSpreadsheet,
                  },
                  {
                    title: "Password Protection",
                    desc: "In-memory decryption with zero persistent passwords, supporting encrypted Indonesian statements.",
                    icon: Lock,
                  },
                ].map((feat) => {
                  const Icon = feat.icon;
                  return (
                    <div
                      key={feat.title}
                      className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-2 hover:border-slate-300 transition-all"
                    >
                      <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                        <Icon className="w-4 h-4" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 tracking-tight">
                        {feat.title}
                      </h3>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        {feat.desc}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* RECENT FILES PREVIEW */}
            {recentFiles.length > 0 && (
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
                    Recent Files Preview
                  </h2>
                  <button
                    type="button"
                    onClick={() => setActiveTab("recent")}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-800 cursor-pointer"
                  >
                    View All ({recentFiles.length})
                  </button>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs divide-y divide-slate-100">
                  {recentFiles.slice(0, 3).map((doc) => (
                    <div
                      key={doc.id}
                      className="p-4 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate" title={doc.originalFileName}>
                            {doc.originalFileName}
                          </p>
                          <span className="text-[11px] text-slate-400">
                            {formatBytes(doc.fileSize)} · {doc.statement?.bankName || "PDF"}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleSelectRecentDoc(doc)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors cursor-pointer shrink-0"
                      >
                        <span>View</span>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* VIEW 5: ANALYZE PDF DEDICATED WORKSPACE (Sections 5-17) */}
        {/* ============================================================== */}
        {activeTab === "analyze" && (
          <div className="space-y-8 animate-in fade-in duration-200">
            {/* Top Workspace Header */}
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                Analyze PDF
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                Upload a bank statement and select the analysis you need.
              </p>
            </div>

            {/* RESULTS STATE (Section 11) */}
            {activeResult ? (
              <section className="space-y-6 animate-in fade-in duration-200">
                {/* Top Action Bar */}
                <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                          Active Document
                        </span>
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                          ✓ Completed
                        </span>
                      </div>
                      <p className="text-sm font-bold text-slate-900 truncate font-mono mt-0.5" title={activeResult.document.originalFileName}>
                        {activeResult.document.originalFileName}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => triggerBankDetection(activeResult.document.id)}
                      disabled={isDetectingBank}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isDetectingBank ? "animate-spin" : ""}`} />
                      Re-run Bank Detection
                    </button>
                    <button
                      type="button"
                      onClick={handleResetWorkflow}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer shadow-xs"
                    >
                      <UploadCloud className="w-3.5 h-3.5" />
                      Upload Another File
                    </button>
                  </div>
                </div>

                {/* Compact Summary Bar (Section 11) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3.5 bg-white border border-slate-200 rounded-xl shadow-xs">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                      Document
                    </span>
                    <span className="text-xs font-bold text-slate-900 truncate block mt-0.5">
                      {bankDetectionResult?.bankName || "PDF Document"}
                    </span>
                  </div>
                  <div className="p-3.5 bg-white border border-slate-200 rounded-xl shadow-xs">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                      Period
                    </span>
                    <span className="text-xs font-medium text-slate-700 font-mono truncate block mt-0.5">
                      {bankDetectionResult?.statementPeriodStart && bankDetectionResult?.statementPeriodEnd
                        ? `${bankDetectionResult.statementPeriodStart} to ${bankDetectionResult.statementPeriodEnd}`
                        : "—"}
                    </span>
                  </div>
                  <div className="p-3.5 bg-white border border-slate-200 rounded-xl shadow-xs">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                      Transactions
                    </span>
                    <span className="text-xs font-bold text-slate-900 block mt-0.5">
                      {transactionExtractionResult?.transactions?.length ?? 0} rows
                    </span>
                  </div>
                  <div className="p-3.5 bg-white border border-slate-200 rounded-xl shadow-xs">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                      Status
                    </span>
                    <span className="text-xs font-semibold text-emerald-700 block mt-0.5">
                      {transactionExtractionResult?.summary?.balanceReconciliationStatus === "VALID"
                        ? "Validated & Reconciled"
                        : "Processed"}
                    </span>
                  </div>
                </div>

                {/* Processing Timeline (Section 10) */}
                <ProcessingTimeline steps={timelineSteps} />

                {/* Bank Detection Result Card (Section 13) */}
                {(selectedFeatures.includes("bankDetection") || bankDetectionResult) && (
                  <BankAnalysisCard
                    detection={bankDetectionResult}
                    isLoading={isDetectingBank}
                  />
                )}

                {/* Transaction Extraction & Balance Validation Card (Sections 14, 15, 16) */}
                {(selectedFeatures.includes("transactionExtraction") || transactionExtractionResult) &&
                  activeResult.document.documentType !== "OTHER_PDF" && (
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

                {/* Bank Statement Excel Export Engine Section (Section 17) */}
                {(selectedFeatures.includes("excelExport") || transactionExtractionResult) &&
                  activeResult.document.documentType !== "OTHER_PDF" && (
                  <ExcelExportCard
                    documentId={activeResult.document.id}
                    extraction={transactionExtractionResult}
                    isExtractingTransactions={isExtractingTransactions}
                    isScannedOrImageOnly={bankDetectionResult?.isScannedOrImageOnly}
                  />
                )}

                {/* PDF Metadata Inspector Section (Section 12) */}
                {(selectedFeatures.includes("metadata") || activeResult.metadata) && activeResult.metadata && (
                  <MetadataResultCard
                    document={activeResult.document}
                    metadata={activeResult.metadata}
                    isDuplicate={activeResult.isDuplicate}
                    onReset={handleResetWorkflow}
                  />
                )}
              </section>
            ) : (
              /* UPLOAD & CONFIGURATION WORKSPACE (Sections 5-10) */
              <section className="space-y-6">
                {/* FEATURE SELECTION (Section 7) */}
                <AnalysisFeatureSelector
                  selectedFeatures={selectedFeatures}
                  onChange={setSelectedFeatures}
                  disabled={isProcessing}
                />

                <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-xs space-y-6">
                  {/* Validation Error Alert */}
                  {errorMessage && (
                    <div
                      role="alert"
                      className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-3 text-xs sm:text-sm animate-in fade-in duration-200"
                    >
                      <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                      <div className="space-y-0.5 flex-1">
                        <div className="font-semibold text-rose-950">Validation Error</div>
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

                  {/* Drag and Drop Zone (Section 5) */}
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => !isProcessing && fileInputRef.current?.click()}
                    className={`relative border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center transition-all duration-150 cursor-pointer ${
                      isProcessing
                        ? "border-slate-300 bg-slate-50 cursor-wait opacity-80"
                        : isDragging
                        ? "border-blue-600 bg-blue-50/50 scale-[0.99]"
                        : selectedRawFile
                        ? "border-emerald-500 bg-emerald-50/20"
                        : "border-slate-300 hover:border-slate-400 bg-slate-50/50 hover:bg-slate-50"
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
                            ? "bg-slate-900 text-white"
                            : selectedRawFile
                            ? "bg-emerald-100 text-emerald-700"
                            : isDragging
                            ? "bg-blue-600 text-white"
                            : "bg-blue-50 text-blue-600 border border-blue-100"
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
                        <h3 className="text-base sm:text-lg font-semibold text-slate-900">
                          {isProcessing
                            ? STAGE_DETAILS[processingStage].label
                            : selectedRawFile
                            ? "PDF Document Ready"
                            : isDragging
                            ? "Drop your PDF file here"
                            : "Drop your PDF here"}
                        </h3>
                        <p className="text-xs sm:text-sm text-slate-500">
                          {isProcessing
                            ? STAGE_DETAILS[processingStage].detail
                            : "or choose a file from your device"}
                        </p>
                      </div>

                      {!isProcessing && (
                        <div className="pt-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              fileInputRef.current?.click();
                            }}
                            className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-slate-900 text-white text-xs sm:text-sm font-semibold hover:bg-slate-800 transition-colors shadow-xs cursor-pointer"
                          >
                            <UploadCloud className="w-4 h-4 mr-2" />
                            {selectedRawFile ? "Change File" : "Choose PDF Document"}
                          </button>
                        </div>
                      )}

                      <div className="pt-2 text-[11px] text-slate-400 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                        <span>Maximum file size: 20 MB</span>
                        <span>•</span>
                        <span>Allowed format: PDF only</span>
                        <span>•</span>
                        <span>Signature: %PDF- verified</span>
                      </div>
                    </div>
                  </div>

                  {/* FILE SELECTED PREVIEW CARD (Section 6) */}
                  {selectedRawFile && (
                    <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 bg-slate-50/80 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0 border border-blue-100">
                            <FileText className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs sm:text-sm font-bold text-slate-900 truncate" title={selectedRawFile.name}>
                              {selectedRawFile.name}
                            </p>
                            <p className="text-xs text-slate-500">
                              PDF Document · {formatBytes(selectedRawFile.size)} · Status: <span className="text-emerald-700 font-medium">Ready to analyze</span>
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {!isProcessing && (
                            <>
                              <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="text-xs text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-white transition-colors cursor-pointer"
                              >
                                Change File
                              </button>
                              <button
                                type="button"
                                onClick={handleClearFile}
                                className="text-xs text-rose-600 hover:text-rose-700 px-3 py-1.5 rounded-lg border border-rose-200 hover:bg-rose-50 transition-colors cursor-pointer"
                              >
                                Remove
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* PASSWORD-PROTECTED PDF STATE (Section 8) */}
                      {(isPasswordProtected ||
                        processingStage === "PASSWORD_REQUIRED" ||
                        processingStage === "WRONG_PASSWORD") && (
                        <div className="p-5 rounded-2xl border border-amber-300 bg-amber-50/90 space-y-4 shadow-xs animate-in fade-in duration-200">
                          <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                              <KeyRound className="w-5 h-5" />
                            </div>
                            <div className="space-y-1">
                              <h4 className="text-sm font-bold text-amber-950">
                                This PDF is password protected
                              </h4>
                              <p className="text-xs text-amber-900/90 leading-relaxed">
                                Enter the PDF password to continue analysis.
                              </p>
                            </div>
                          </div>

                          {/* Password Error Alert */}
                          {(passwordError || processingStage === "WRONG_PASSWORD") && (
                            <div
                              role="alert"
                              className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2"
                            >
                              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                              <span className="font-medium leading-relaxed">
                                {passwordError || "Password PDF salah atau dokumen tidak dapat dibuka."}
                              </span>
                            </div>
                          )}

                          {/* Password Form */}
                          <form onSubmit={handleUnlockAndAnalyze} className="space-y-3">
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                              <div className="relative flex-1">
                                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                                  <Lock className="w-4 h-4" />
                                </div>
                                <input
                                  type={showPassword ? "text" : "password"}
                                  autoComplete="off"
                                  value={pdfPassword}
                                  onChange={(e) => {
                                    setPdfPassword(e.target.value);
                                    setPasswordError(null);
                                  }}
                                  placeholder="Enter PDF password..."
                                  disabled={isProcessing}
                                  className="w-full pl-10 pr-10 py-2.5 text-xs sm:text-sm bg-white border border-amber-300 focus:border-slate-900 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-900 font-mono text-slate-900 placeholder:text-slate-400"
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowPassword(!showPassword)}
                                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                                  tabIndex={-1}
                                  aria-label={showPassword ? "Hide password" : "Show password"}
                                >
                                  {showPassword ? (
                                    <EyeOff className="w-4 h-4" />
                                  ) : (
                                    <Eye className="w-4 h-4" />
                                  )}
                                </button>
                              </div>
                              <button
                                type="submit"
                                disabled={isProcessing || !pdfPassword}
                                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-xs sm:text-sm font-semibold transition-colors shadow-xs cursor-pointer shrink-0"
                              >
                                {isProcessing && processingStage === "DECRYPTING" ? (
                                  <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Decrypting...
                                  </>
                                ) : (
                                  <>
                                    <Unlock className="w-4 h-4" />
                                    Unlock &amp; Continue
                                  </>
                                )}
                              </button>
                            </div>

                            <p className="text-[11px] text-amber-900/90 font-medium">
                              Your password is used only to unlock this document and is never stored.
                            </p>
                          </form>
                        </div>
                      )}

                      {/* Ready Action Callout */}
                      {!isPasswordProtected &&
                        processingStage !== "PASSWORD_REQUIRED" &&
                        processingStage !== "WRONG_PASSWORD" && (
                          <div className="pt-3 border-t border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="text-xs text-slate-500">
                              Selected features will be processed automatically in sequence.
                            </div>

                            <button
                              type="button"
                              onClick={handleStartExtraction}
                              disabled={isProcessing}
                              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-xs sm:text-sm font-semibold transition-colors shadow-xs cursor-pointer shrink-0"
                            >
                              {isProcessing ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Processing...
                                </>
                              ) : (
                                <>
                                  <span>Inspect &amp; Analyze Document</span>
                                  <ArrowRight className="w-4 h-4" />
                                </>
                              )}
                            </button>
                          </div>
                        )}
                    </div>
                  )}

                  {/* REAL UPLOAD PROGRESS (Section 9) & PROCESSING TIMELINE (Section 10) */}
                  {(uploadProgress.state === "UPLOADING" ||
                    uploadProgress.state === "UPLOADED" ||
                    uploadProgress.state === "PROCESSING" ||
                    uploadProgress.state === "FAILED" ||
                    uploadProgress.state === "CANCELLED") && (
                    <div className="space-y-4 pt-2">
                      <UploadProgressBar
                        progress={uploadProgress}
                        onCancel={handleCancelUpload}
                        fileName={selectedRawFile?.name}
                      />
                      <ProcessingTimeline steps={timelineSteps} />
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer className="border-t border-slate-200 bg-white py-6 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900">Metadata Checker</span>
            <span>—</span>
            <span>Financial Document Intelligence SaaS</span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span>20 MB Limit Verified</span>
            <span>•</span>
            <span>In-Memory PDF Decryption</span>
            <span>•</span>
            <span>Neon PostgreSQL Active</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function AppContent() {
  const { user, loading, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<NavigationTab>("dashboard");

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
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
