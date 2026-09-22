import React, { useState } from "react";
import {
  FileSpreadsheet,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileCheck,
  Calendar,
  Layers,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import type { TransactionExtractionResultUi } from "../types/transaction";

interface ExcelExportCardProps {
  documentId: string;
  extraction: TransactionExtractionResultUi | null;
  isExtractingTransactions: boolean;
  isScannedOrImageOnly?: boolean;
}

type ExportStatus = "IDLE" | "PROCESSING" | "SUCCESS" | "ERROR";

interface ExportSummaryData {
  exportId: string;
  fileName: string;
  transactionCount: number;
  reviewCount: number;
  createdAt: string;
  downloadUrl: string;
  fileSize?: number;
}

export function ExcelExportCard({
  documentId,
  extraction,
  isExtractingTransactions,
  isScannedOrImageOnly,
}: ExcelExportCardProps) {
  const [status, setStatus] = useState<ExportStatus>("IDLE");
  const [exportData, setExportData] = useState<ExportSummaryData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hasTransactions =
    extraction && extraction.transactions && extraction.transactions.length > 0;
  const isFailed = extraction?.status === "FAILED";

  const handleExport = async () => {
    if (!documentId) return;

    setStatus("PROCESSING");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/excel-export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          documentId,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to generate Excel export.");
      }

      setExportData({
        exportId: data.exportId,
        fileName: data.fileName,
        transactionCount: data.transactionCount,
        reviewCount: data.reviewCount,
        createdAt: data.createdAt,
        downloadUrl: data.downloadUrl || `/api/excel-export/${data.exportId}`,
        fileSize: data.fileSize,
      });
      setStatus("SUCCESS");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Export process failed.";
      setErrorMessage(msg);
      setStatus("ERROR");
    }
  };

  const handleDownload = () => {
    if (!exportData?.downloadUrl) return;
    const link = document.createElement("a");
    link.href = exportData.downloadUrl;
    link.setAttribute("download", exportData.fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return "Generated XLSX";
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const formatDateTime = (isoString?: string) => {
    if (!isoString) return "-";
    try {
      const d = new Date(isoString);
      return d.toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div
      id="excel-export-section"
      className="bg-white border border-neutral-200 rounded-2xl shadow-xs overflow-hidden"
    >
      {/* Header */}
      <div className="p-6 border-b border-neutral-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200/80 flex items-center justify-center text-emerald-700 shrink-0">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-neutral-900">
              Bank Statement Excel Export Engine
            </h3>
            <p className="text-xs text-neutral-500">
              Generate a formatted 4-sheet .xlsx workbook (Summary, Transactions, Needs Review, Metadata)
            </p>
          </div>
        </div>

        {/* Action Button */}
        <div>
          {status === "IDLE" && (
            <button
              id="export-excel-button"
              type="button"
              onClick={handleExport}
              disabled={!hasTransactions || isExtractingTransactions || isScannedOrImageOnly || isFailed}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 text-white text-xs font-medium rounded-lg shadow-xs transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Export Excel
            </button>
          )}

          {status === "PROCESSING" && (
            <button
              id="export-excel-button-processing"
              type="button"
              disabled
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-neutral-800 text-white text-xs font-medium rounded-lg shadow-xs cursor-wait"
            >
              <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
              Generating Excel...
            </button>
          )}

          {status === "SUCCESS" && (
            <div className="flex items-center gap-2">
              <button
                id="export-excel-button-success"
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg shadow-xs transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Download Excel
              </button>
              <button
                type="button"
                onClick={handleExport}
                title="Regenerate workbook"
                className="p-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-lg text-xs cursor-pointer transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          )}

          {status === "ERROR" && (
            <div className="flex items-center gap-2">
              <button
                id="export-excel-button-error"
                type="button"
                onClick={handleExport}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium rounded-lg shadow-xs transition-colors cursor-pointer"
              >
                <AlertCircle className="w-4 h-4" />
                Export Failed
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Body Content */}
      <div className="p-6 space-y-4">
        {/* Error notification if failed */}
        {status === "ERROR" && errorMessage && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3 text-rose-900 text-xs">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-semibold block">Export Error</span>
              <p>{errorMessage}</p>
              <p className="text-rose-700 text-[11px] mt-1">
                Click &quot;Export Failed&quot; above to retry.
              </p>
            </div>
          </div>
        )}

        {/* Informational states when extraction hasn't completed or is scanned */}
        {!hasTransactions && !isExtractingTransactions && !isScannedOrImageOnly && (
          <div className="p-4 bg-neutral-50 border border-neutral-200/80 rounded-xl flex items-center justify-between text-xs text-neutral-600">
            <div className="flex items-center gap-2">
              <FileCheck className="w-4 h-4 text-neutral-400" />
              <span>Complete transaction extraction before exporting.</span>
            </div>
            <span className="text-[11px] text-neutral-400 font-mono">XLSX Engine Ready</span>
          </div>
        )}

        {isScannedOrImageOnly && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3 text-amber-900 text-xs">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block mb-0.5">Scanned Document Guard</span>
              Export is unavailable because this document is an image-based PDF requiring OCR.
            </div>
          </div>
        )}

        {/* Successful Export Summary Box */}
        {status === "SUCCESS" && exportData && (
          <div
            id="export-summary-panel"
            className="p-5 bg-emerald-50/50 border border-emerald-200 rounded-xl space-y-4 animate-in fade-in duration-200"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-900">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span className="text-sm font-semibold">
                  Excel export created successfully.
                </span>
              </div>
              <span className="text-xs text-emerald-700 font-medium">
                {formatFileSize(exportData.fileSize)}
              </span>
            </div>

            {/* Metrics grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3 bg-white rounded-lg border border-emerald-100 shadow-2xs">
                <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block">
                  File Name
                </span>
                <span className="text-xs font-semibold text-neutral-900 mt-1 block truncate font-mono">
                  {exportData.fileName}
                </span>
              </div>

              <div className="p-3 bg-white rounded-lg border border-emerald-100 shadow-2xs">
                <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block">
                  Transactions
                </span>
                <span className="text-sm font-semibold text-neutral-900 mt-1 block">
                  {exportData.transactionCount} Rows
                </span>
              </div>

              <div className="p-3 bg-white rounded-lg border border-emerald-100 shadow-2xs">
                <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block">
                  Needing Review
                </span>
                <span
                  className={`text-sm font-semibold mt-1 block ${
                    exportData.reviewCount > 0 ? "text-amber-700" : "text-emerald-700"
                  }`}
                >
                  {exportData.reviewCount > 0
                    ? `${exportData.reviewCount} Row(s)`
                    : "None (0)"}
                </span>
              </div>

              <div className="p-3 bg-white rounded-lg border border-emerald-100 shadow-2xs">
                <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block">
                  Export Date/Time
                </span>
                <span className="text-xs font-semibold text-neutral-900 mt-1 block">
                  {formatDateTime(exportData.createdAt)}
                </span>
              </div>
            </div>

            {/* Primary Download Button */}
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-xs text-neutral-600">
                The generated workbook includes <strong>Summary</strong>,{" "}
                <strong>Transactions</strong>, <strong>Needs Review</strong>, and{" "}
                <strong>Metadata</strong> sheets with mathematical precision.
              </p>
              <button
                id="export-summary-download-button"
                type="button"
                onClick={handleDownload}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer shrink-0"
              >
                <Download className="w-4 h-4" />
                Download Excel
              </button>
            </div>
          </div>
        )}

        {/* Workbook Architecture Overview */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1 text-xs">
          <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200/60">
            <span className="font-semibold text-neutral-800 block text-[11px]">1. Summary</span>
            <span className="text-neutral-500 text-[10px]">
              Bank info, balances, period & reconciliation
            </span>
          </div>
          <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200/60">
            <span className="font-semibold text-neutral-800 block text-[11px]">2. Transactions</span>
            <span className="text-neutral-500 text-[10px]">
              Freeze pane, AutoFilter, numeric decimals
            </span>
          </div>
          <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200/60">
            <span className="font-semibold text-neutral-800 block text-[11px]">3. Needs Review</span>
            <span className="text-neutral-500 text-[10px]">
              Ambiguous rows & parsing exceptions
            </span>
          </div>
          <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200/60">
            <span className="font-semibold text-neutral-800 block text-[11px]">4. Metadata</span>
            <span className="text-neutral-500 text-[10px]">
              PDF properties, hash & masked account
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
