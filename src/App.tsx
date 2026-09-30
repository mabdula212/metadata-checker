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
  Lock,
  KeyRound,
  Unlock,
  Eye,
  EyeOff,
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
    detail: "Pilih file PDF untuk memulai inspeksi metadata.",
  },
  UPLOADING: {
    stage: "UPLOADING",
    stepNumber: 1,
    label: "Uploading",
    detail: "Mengunggah file PDF ke server...",
  },
  ANALYZING: {
    stage: "ANALYZING",
    stepNumber: 2,
    label: "Analyzing",
    detail: "Menganalisis tanda tangan berkas dan status enkripsi PDF...",
  },
  VALIDATING: {
    stage: "VALIDATING",
    stepNumber: 1,
    label: "Validating PDF",
    detail: "Memverifikasi tipe MIME, batas ukuran (≤ 20 MB), dan header %PDF-.",
  },
  READING: {
    stage: "READING",
    stepNumber: 2,
    label: "Reading PDF",
    detail: "Membaca berkas PDF dan menyiapkan payload server.",
  },
  PASSWORD_REQUIRED: {
    stage: "PASSWORD_REQUIRED",
    stepNumber: 2,
    label: "Password Required",
    detail: "Dokumen ini dilindungi password. Masukkan password PDF untuk melanjutkan analisis.",
  },
  DECRYPTING: {
    stage: "DECRYPTING",
    stepNumber: 3,
    label: "Decrypting",
    detail: "Membuka enkripsi PDF secara aman di memori server...",
  },
  INSPECTING: {
    stage: "INSPECTING",
    stepNumber: 4,
    label: "Inspecting",
    detail: "Mengekstrak metadata PDF, trailer dictionary, dan SHA-256...",
  },
  EXTRACTING: {
    stage: "EXTRACTING",
    stepNumber: 3,
    label: "Extracting metadata",
    detail: "Mengekstrak metadata dokumen dan jumlah halaman.",
  },
  DETECTING: {
    stage: "DETECTING",
    stepNumber: 4,
    label: "Detecting Bank",
    detail: "Mendeteksi institusi perbankan, periode laporan, dan nomor rekening...",
  },
  SAVING: {
    stage: "SAVING",
    stepNumber: 5,
    label: "Saving result",
    detail: "Menyimpan data laporan dan mutasi rekening...",
  },
  EXTRACTING_TRANSACTIONS: {
    stage: "EXTRACTING_TRANSACTIONS",
    stepNumber: 5,
    label: "Extracting Transactions",
    detail: "Mengekstrak transaksi, mutasi debit/kredit, dan rekonsiliasi saldo...",
  },
  COMPLETED: {
    stage: "COMPLETED",
    stepNumber: 6,
    label: "Completed",
    detail: "Analisis dokumen dan ekstraksi mutasi selesai.",
  },
  WRONG_PASSWORD: {
    stage: "WRONG_PASSWORD",
    stepNumber: 2,
    label: "Wrong Password",
    detail: "Password PDF salah atau dokumen tidak dapat dibuka.",
  },
  UNSUPPORTED_ENCRYPTION: {
    stage: "UNSUPPORTED_ENCRYPTION",
    stepNumber: 2,
    label: "Unsupported Encryption",
    detail: "Jenis enkripsi PDF ini belum didukung.",
  },
  INVALID_PDF: {
    stage: "INVALID_PDF",
    stepNumber: 1,
    label: "Invalid PDF",
    detail: "File PDF tidak valid atau kosong (0 bytes).",
  },
  CANCELLED: {
    stage: "CANCELLED",
    stepNumber: 0,
    label: "Upload Cancelled",
    detail: "Proses unggah telah dibatalkan oleh pengguna.",
  },
  ERROR: {
    stage: "ERROR",
    stepNumber: 0,
    label: "Processing Failed",
    detail: "Terjadi kesalahan saat memproses dokumen.",
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
      setErrorMessage("Failed to inspect file signature. Please try another file.");
      setSelectedRawFile(null);
      return false;
    }

    // Validated successfully
    setSelectedRawFile(file);
    setUploadProgress({
      state: "SELECTED",
      loadedBytes: 0,
      totalBytes: file.size,
      percentage: 0,
      speedBytesPerSec: 0,
      formattedSpeed: "0 KB/s",
      etaSeconds: null,
      formattedEta: "Calculating...",
      statusText: "File selected",
    });
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
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await validateFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await validateFile(e.target.files[0]);
    }
  };

  const handleClearFile = () => {
    if (activeUploadRef.current) {
      activeUploadRef.current.abort();
      activeUploadRef.current = null;
    }
    setSelectedRawFile(null);
    setErrorMessage(null);
    setPasswordError(null);
    setPdfPassword("");
    setIsPasswordProtected(false);
    setBankDetectionResult(null);
    setTransactionExtractionResult(null);
    setProcessingStage("IDLE");
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

  const handleResetWorkflow = () => {
    if (activeUploadRef.current) {
      activeUploadRef.current.abort();
      activeUploadRef.current = null;
    }
    setSelectedRawFile(null);
    setActiveResult(null);
    setBankDetectionResult(null);
    setTransactionExtractionResult(null);
    setErrorMessage(null);
    setPasswordError(null);
    setPdfPassword("");
    setIsPasswordProtected(false);
    setProcessingStage("IDLE");
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
          // A password was supplied, but server rejected it -> WRONG_PASSWORD
          setProcessingStage("WRONG_PASSWORD");
          setPasswordError(
            inspectRes.data?.error ||
            "Password PDF salah atau dokumen tidak dapat dibuka. Pastikan password sesuai (contoh: tanggal lahir DDMMYYYY atau nomor rekening untuk mutasi bank)."
          );
        } else {
          // Document requires password
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
      setPasswordError("Dokumen ini dilindungi password. Masukkan password PDF untuk melanjutkan analisis.");
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
      detail: activeResult?.metadata?.pageCount ? `${activeResult.metadata.pageCount} halaman` : undefined,
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
      detail: transactionExtractionResult ? `${transactionExtractionResult.transactions.length} mutasi` : undefined,
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

            {/* Processing Timeline (Part L) */}
            <ProcessingTimeline steps={timelineSteps} />

            {/* Document Analysis Section (Bank Detection) */}
            {(selectedFeatures.includes("bankDetection") || bankDetectionResult) && (
              <BankAnalysisCard
                detection={bankDetectionResult}
                isLoading={isDetectingBank}
              />
            )}

            {/* Transaction Extraction Engine Section */}
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

            {/* Bank Statement Excel Export Engine Section */}
            {(selectedFeatures.includes("excelExport") || transactionExtractionResult) &&
              activeResult.document.documentType !== "OTHER_PDF" && (
              <ExcelExportCard
                documentId={activeResult.document.id}
                extraction={transactionExtractionResult}
                isExtractingTransactions={isExtractingTransactions}
                isScannedOrImageOnly={bankDetectionResult?.isScannedOrImageOnly}
              />
            )}

            {/* PDF Metadata Inspector Section */}
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
          <section className="space-y-6">
            {/* Feature Selection (Part F, G, H) */}
            <AnalysisFeatureSelector
              selectedFeatures={selectedFeatures}
              onChange={setSelectedFeatures}
              disabled={isProcessing}
            />

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
                      {isPasswordProtected ||
                      processingStage === "PASSWORD_REQUIRED" ||
                      processingStage === "WRONG_PASSWORD" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                          <Lock className="w-3.5 h-3.5" />
                          PDF Protected
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Valid PDF (≤ 20 MB)
                        </span>
                      )}
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

                  {/* Password Protection UI Prompt (Requirement 2 & 11) */}
                  {(isPasswordProtected ||
                    processingStage === "PASSWORD_REQUIRED" ||
                    processingStage === "WRONG_PASSWORD") && (
                    <div className="p-4 sm:p-5 rounded-xl border border-amber-300 bg-amber-50/90 space-y-3.5 shadow-xs animate-in fade-in duration-200">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-lg bg-amber-200 text-amber-900 flex items-center justify-center shrink-0">
                          <KeyRound className="w-5 h-5 text-amber-800" />
                        </div>
                        <div className="space-y-1">
                          <h4 className="text-sm font-bold text-amber-950 flex items-center gap-2">
                            PDF Protected
                          </h4>
                          <p className="text-xs text-amber-900/90 leading-relaxed">
                            Dokumen ini dilindungi password. Masukkan password PDF untuk melanjutkan analisis.
                          </p>
                        </div>
                      </div>

                      {/* Password Error Alert */}
                      {(passwordError || processingStage === "WRONG_PASSWORD") && (
                        <div
                          role="alert"
                          className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2"
                        >
                          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                          <span className="font-medium">
                            {passwordError || "Password PDF salah atau dokumen tidak dapat dibuka."}
                          </span>
                        </div>
                      )}

                      {/* Password Input & Unlock Form */}
                      <form onSubmit={handleUnlockAndAnalyze} className="space-y-3">
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                          <div className="relative flex-1">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400">
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
                              placeholder="Masukkan password PDF dokumen..."
                              disabled={isProcessing}
                              className="w-full pl-9 pr-10 py-2 text-xs sm:text-sm bg-white border border-amber-300 focus:border-neutral-900 rounded-lg focus:outline-none focus:ring-1 focus:ring-neutral-900 font-mono text-neutral-900 placeholder:text-neutral-400"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute inset-y-0 right-0 pr-3 flex items-center text-neutral-400 hover:text-neutral-600 cursor-pointer"
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
                            className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-400 text-white text-xs sm:text-sm font-semibold transition-colors shadow-xs cursor-pointer shrink-0"
                          >
                            {isProcessing && processingStage === "DECRYPTING" ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Decrypting...
                              </>
                            ) : (
                              <>
                                <Unlock className="w-4 h-4" />
                                Unlock &amp; Analyze
                              </>
                            )}
                          </button>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[11px] text-amber-900/90 font-medium">
                            💡 Tips mutasi bank (BNI, BCA, BRI, Mandiri): Password e-statement umumnya berupa tanggal lahir (format DDMMYYYY, misal: 25121990) atau nomor rekening.
                          </p>
                          <p className="text-[11px] text-amber-800/70">
                            Password hanya digunakan sesaat di memori server dan tidak pernah disimpan di database atau disk.
                          </p>
                        </div>
                      </form>
                    </div>
                  )}

                  {!isPasswordProtected &&
                    processingStage !== "PASSWORD_REQUIRED" &&
                    processingStage !== "WRONG_PASSWORD" && (
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
                    )}
                </div>
              )}

              {/* Real-time Upload Progress & Processing Timeline (Part A, B, C, D, E, L) */}
              {(uploadProgress.state === "UPLOADING" ||
                uploadProgress.state === "UPLOADED" ||
                uploadProgress.state === "PROCESSING" ||
                uploadProgress.state === "FAILED" ||
                uploadProgress.state === "CANCELLED") && (
                <div className="mt-6 space-y-4">
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

