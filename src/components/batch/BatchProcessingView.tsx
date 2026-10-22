import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  Layers,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  X,
  Clock,
  Loader2,
  Landmark,
  FileText,
  Lock,
  ChevronRight,
  StopCircle,
  RefreshCw,
  Eye,
  EyeOff,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { formatBytes } from "../../lib/utils";
import { safeApiFetch } from "../../lib/api-client";

export interface BatchItem {
  id: string;
  file: File;
  fileName: string;
  fileSize: number;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "NEEDS_REVIEW" | "PASSWORD_REQUIRED" | "CANCELLED";
  progress: number;
  error: string | null;
  bank: string | null;
  transactionCount: number;
  documentId: string | null;
  isDuplicate?: boolean;
}

export interface BatchSummary {
  total: number;
  completed: number;
  processing: number;
  failed: number;
  needsReview: number;
}

interface BatchProcessingViewProps {
  onOpenDocument?: (docId: string) => void;
  onNavigateHistory?: () => void;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

export function BatchProcessingView({
  onOpenDocument,
  onNavigateHistory,
}: BatchProcessingViewProps) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [globalPassword, setGlobalPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pollIntervalRef = useRef<any>(null);

  // Compute live summaries
  const summary: BatchSummary = {
    total: items.length,
    completed: items.filter((i) => i.status === "COMPLETED").length,
    processing: items.filter((i) => i.status === "PROCESSING").length,
    failed: items.filter((i) => i.status === "FAILED" || i.status === "PASSWORD_REQUIRED").length,
    needsReview: items.filter((i) => i.status === "NEEDS_REVIEW").length,
  };

  // Add files to queue
  const addFilesToQueue = useCallback((newFiles: FileList | File[]) => {
    setBatchError(null);
    const added: BatchItem[] = [];

    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        continue;
      }
      added.push({
        id: `batch-item-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        file,
        fileName: file.name,
        fileSize: file.size,
        status: file.size > MAX_FILE_SIZE ? "FAILED" : "QUEUED",
        progress: 0,
        error: file.size > MAX_FILE_SIZE ? "File exceeds 20 MB limit." : null,
        bank: null,
        transactionCount: 0,
        documentId: null,
      });
    }

    if (added.length === 0 && newFiles.length > 0) {
      setBatchError("Only PDF files are supported for batch processing.");
      return;
    }

    setItems((prev) => [...prev, ...added]);
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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFilesToQueue(e.dataTransfer.files);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFilesToQueue(e.target.files);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRemoveItem = (id: string) => {
    if (isProcessing) return;
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearQueue = () => {
    if (isProcessing) return;
    setItems([]);
    setBatchError(null);
    setActiveBatchId(null);
  };

  // Poll status while batch is active
  const startStatusPolling = useCallback((batchId: string) => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await safeApiFetch<{
          success: boolean;
          batchId: string;
          status: string;
          totalDocuments: number;
          completedDocuments: number;
          failedDocuments: number;
        }>(`/api/batches/${batchId}/status`);

        if (res.data?.status === "COMPLETED" || res.data?.status === "FAILED" || res.data?.status === "CANCELLED" || res.data?.status === "PARTIAL") {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      } catch {
        // Ignore background polling errors
      }
    }, 1500);
  }, []);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Cancel in-flight batch
  const handleCancelBatch = async () => {
    if (!activeBatchId) return;

    try {
      await safeApiFetch(`/api/batches/${activeBatchId}/cancel`, {
        method: "POST",
      });
      setIsProcessing(false);
      setItems((prev) =>
        prev.map((item) =>
          item.status === "PROCESSING" || item.status === "QUEUED"
            ? { ...item, status: "CANCELLED", error: "Processing was cancelled." }
            : item
        )
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to cancel batch.";
      setBatchError(msg);
    }
  };

  // Start processing files
  const handleStartBatch = async () => {
    const validItems = items.filter((i) => i.status === "QUEUED");
    if (validItems.length === 0) return;

    setIsProcessing(true);
    setBatchError(null);

    // Update items to PROCESSING
    setItems((prev) =>
      prev.map((i) =>
        i.status === "QUEUED" ? { ...i, status: "PROCESSING", progress: 20 } : i
      )
    );

    const formData = new FormData();
    if (globalPassword) {
      formData.append("password", globalPassword);
    }

    validItems.forEach((item) => {
      formData.append("files", item.file, item.fileName);
    });

    try {
      const response = await fetch("/api/batches", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Batch processing failed.");
      }

      setActiveBatchId(data.batchId);
      if (data.batchId) {
        startStatusPolling(data.batchId);
      }

      // Merge server results into items
      const serverDocs: Array<{
        documentId: string | null;
        fileName: string;
        fileSize: number;
        status: "COMPLETED" | "FAILED" | "NEEDS_REVIEW" | "PASSWORD_REQUIRED" | "CANCELLED";
        progress: number;
        error: string | null;
        bank: string | null;
        transactionCount: number;
        isDuplicate?: boolean;
      }> = data.documents || [];

      setItems((prev) => {
        return prev.map((item) => {
          const match = serverDocs.find((sd) => sd.fileName === item.fileName);
          if (match) {
            return {
              ...item,
              status: match.status,
              progress: 100,
              error: match.error,
              bank: match.bank,
              transactionCount: match.transactionCount,
              documentId: match.documentId,
              isDuplicate: match.isDuplicate,
            };
          }
          return item;
        });
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An error occurred during batch processing.";
      setBatchError(msg);
      setItems((prev) =>
        prev.map((i) =>
          i.status === "PROCESSING" ? { ...i, status: "FAILED", error: msg, progress: 0 } : i
        )
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Workspace Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 text-xs font-semibold mb-2">
            <Layers className="w-3.5 h-3.5" />
            <span>Multi-File Pipeline</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Batch PDF Processing
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Upload and analyze multiple Indonesian bank statements simultaneously with auto bank detection and transaction extraction.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {onNavigateHistory && (
            <button
              type="button"
              onClick={onNavigateHistory}
              className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors shadow-xs cursor-pointer flex items-center gap-1.5"
            >
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>View History</span>
            </button>
          )}

          {items.length > 0 && !isProcessing && (
            <button
              type="button"
              onClick={handleClearQueue}
              className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 text-slate-600 text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Queue</span>
            </button>
          )}
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Total Files
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-900 font-mono">
            {summary.total}
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs">
          <div className="text-[11px] font-semibold text-blue-600 uppercase tracking-wider">
            Processing
          </div>
          <div className="mt-1 text-2xl font-bold text-blue-600 font-mono">
            {summary.processing}
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs">
          <div className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wider">
            Completed
          </div>
          <div className="mt-1 text-2xl font-bold text-emerald-600 font-mono">
            {summary.completed}
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs">
          <div className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider">
            Needs Review
          </div>
          <div className="mt-1 text-2xl font-bold text-amber-600 font-mono">
            {summary.needsReview}
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs col-span-2 sm:col-span-1">
          <div className="text-[11px] font-semibold text-rose-600 uppercase tracking-wider">
            Failed
          </div>
          <div className="mt-1 text-2xl font-bold text-rose-600 font-mono">
            {summary.failed}
          </div>
        </div>
      </div>

      {/* Global Error Banner */}
      {batchError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold">Batch Processing Error:</span> {batchError}
          </div>
          <button
            type="button"
            onClick={() => setBatchError(null)}
            className="text-rose-500 hover:text-rose-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Drag & Drop Zone */}
      <section
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`bg-white border-2 border-dashed rounded-3xl p-8 sm:p-10 text-center transition-all shadow-xs ${
          isDragging
            ? "border-blue-500 bg-blue-50/50 scale-[0.99]"
            : "border-slate-200 hover:border-slate-300"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="hidden"
          onChange={handleFileInputChange}
          disabled={isProcessing}
        />

        <div className="max-w-md mx-auto space-y-4">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shadow-xs">
            <UploadCloud className="w-7 h-7" />
          </div>

          <div>
            <h3 className="text-base font-bold text-slate-900 tracking-tight">
              Drag &amp; Drop Bank Statements Here
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Select multiple PDFs from BCA, BNI, BRI, or Mandiri (up to 20 MB per file).
            </p>
          </div>

          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => fileInputRef.current?.click()}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-xs font-semibold transition-colors shadow-xs cursor-pointer"
            >
              Browse PDF Files
            </button>
          </div>
        </div>
      </section>

      {/* Batch Password & Controls Bar */}
      {items.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex-1 max-w-md">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Default Password for Encrypted Statements (Optional)
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="e.g. DDMMYYYY or PIN"
                value={globalPassword}
                onChange={(e) => setGlobalPassword(e.target.value)}
                disabled={isProcessing}
                className="w-full text-xs px-3.5 py-2 pr-10 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Applied automatically to any password-protected PDF in this batch.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {isProcessing ? (
              <button
                type="button"
                onClick={handleCancelBatch}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition-colors shadow-xs cursor-pointer flex items-center gap-2"
              >
                <StopCircle className="w-4 h-4" />
                <span>Cancel Batch</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStartBatch}
                disabled={items.filter((i) => i.status === "QUEUED").length === 0}
                className="px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-xs sm:text-sm font-semibold transition-colors shadow-xs cursor-pointer flex items-center gap-2"
              >
                <Layers className="w-4 h-4" />
                <span>Process {items.filter((i) => i.status === "QUEUED").length} Files</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Queue Table */}
      {items.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
          <div className="p-4 sm:px-6 sm:py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900">
                Batch File Queue
              </h2>
              <span className="text-xs font-mono font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                {items.length}
              </span>
            </div>

            {isProcessing && (
              <div className="flex items-center gap-2 text-xs font-semibold text-blue-600">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Processing queue with concurrency control (2 workers)...</span>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4 sm:px-6">File Name</th>
                  <th className="py-3 px-4">Size</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Detected Bank</th>
                  <th className="py-3 px-4">Transactions</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-normal">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                    {/* Filename */}
                    <td className="py-3.5 px-4 sm:px-6">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate max-w-xs sm:max-w-md" title={item.fileName}>
                            {item.fileName}
                          </p>
                          {item.error && (
                            <p className="text-[11px] text-rose-600 truncate max-w-xs sm:max-w-md mt-0.5">
                              {item.error}
                            </p>
                          )}
                          {item.isDuplicate && (
                            <span className="text-[10px] text-blue-600 font-medium">
                              (Existing Document / SHA-256 Match)
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Size */}
                    <td className="py-3.5 px-4 text-slate-600 whitespace-nowrap">
                      {formatBytes(item.fileSize)}
                    </td>

                    {/* Status Pill */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {item.status === "QUEUED" && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-medium text-[11px]">
                          <Clock className="w-3 h-3 text-slate-400" />
                          Queued
                        </span>
                      )}
                      {item.status === "PROCESSING" && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 font-medium text-[11px]">
                          <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                          Processing
                        </span>
                      )}
                      {item.status === "COMPLETED" && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-medium text-[11px]">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          Completed
                        </span>
                      )}
                      {item.status === "NEEDS_REVIEW" && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-medium text-[11px]">
                          <AlertTriangle className="w-3 h-3 text-amber-600" />
                          Needs Review
                        </span>
                      )}
                      {item.status === "PASSWORD_REQUIRED" && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-medium text-[11px]">
                          <Lock className="w-3 h-3 text-amber-600" />
                          Password Needed
                        </span>
                      )}
                      {item.status === "FAILED" && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 font-medium text-[11px]">
                          <AlertCircle className="w-3 h-3 text-rose-600" />
                          Failed
                        </span>
                      )}
                      {item.status === "CANCELLED" && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 font-medium text-[11px]">
                          <StopCircle className="w-3 h-3 text-slate-400" />
                          Cancelled
                        </span>
                      )}
                    </td>

                    {/* Bank */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {item.bank ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-bold font-mono text-[11px]">
                          <Landmark className="w-3 h-3" />
                          {item.bank}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>

                    {/* Transaction Count */}
                    <td className="py-3.5 px-4 font-mono font-medium text-slate-700 whitespace-nowrap">
                      {item.transactionCount > 0 ? (
                        <span>{item.transactionCount.toLocaleString()} txs</span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 sm:px-6 text-right whitespace-nowrap">
                      {item.documentId && onOpenDocument ? (
                        <button
                          type="button"
                          onClick={() => onOpenDocument(item.documentId!)}
                          className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-xs transition-colors cursor-pointer"
                        >
                          <span>View</span>
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      ) : !isProcessing ? (
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(item.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 transition-colors"
                          title="Remove from queue"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
