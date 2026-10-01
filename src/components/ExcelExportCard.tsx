import React, { useState } from "react";
import {
  FileSpreadsheet,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileCheck,
  Calendar,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import type { TransactionExtractionResultUi } from "../types/transaction";
import { safeApiFetch } from "../lib/api-client";

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
      const res = await safeApiFetch<any>("/api/excel-export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          documentId,
        }),
      });

      if (!res.ok || !res.data?.success) {
        throw new Error(res.error || res.data?.error || "Failed to generate Excel export.");
      }

      const data = res.data;

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
      className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden p-6 sm:p-7 space-y-5"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900 tracking-tight">
              Export Results
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Download your analysis as an Excel workbook.
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
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Export to Excel
            </button>
          )}

          {status === "PROCESSING" && (
            <button
              id="export-excel-button-processing"
              type="button"
              disabled
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-xs cursor-wait"
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
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Download Excel
              </button>
              <button
                type="button"
                onClick={handleExport}
                title="Regenerate workbook"
                className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs cursor-pointer transition-colors"
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
                className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
              >
                <AlertCircle className="w-4 h-4" />
                Export Failed
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Sheets Structure Badge Row */}
      <div className="p-4 bg-slate-50/70 border border-slate-200/80 rounded-xl space-y-2.5">
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
          Workbook Sheets Included in Export:
        </span>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="flex items-center gap-2 p-2 bg-white rounded-lg border border-slate-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="font-medium text-slate-800">Summary</span>
          </div>
          <div className="flex items-center gap-2 p-2 bg-white rounded-lg border border-slate-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="font-medium text-slate-800">Transactions</span>
          </div>
          <div className="flex items-center gap-2 p-2 bg-white rounded-lg border border-slate-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="font-medium text-slate-800">Needs Review</span>
          </div>
          <div className="flex items-center gap-2 p-2 bg-white rounded-lg border border-slate-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="font-medium text-slate-800">Metadata</span>
          </div>
        </div>
      </div>

      {/* Error notification if failed */}
      {status === "ERROR" && errorMessage && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3 text-rose-900 text-xs">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold block">Export Error</span>
            <p>{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Informational states when extraction hasn't completed or is scanned */}
      {!hasTransactions && !isExtractingTransactions && !isScannedOrImageOnly && (
        <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <FileCheck className="w-4 h-4 text-slate-400" />
            <span>Complete transaction extraction before exporting.</span>
          </div>
          <span className="text-[11px] text-slate-400 font-mono">XLSX Engine Ready</span>
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
                Excel Workbook Successfully Generated
              </span>
            </div>
            <span className="text-xs font-mono font-medium text-emerald-700 bg-white px-2 py-0.5 rounded border border-emerald-200">
              {formatFileSize(exportData.fileSize)}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 bg-white rounded-lg border border-emerald-100">
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">File Name</span>
              <span className="font-mono text-slate-900 font-medium truncate block mt-0.5" title={exportData.fileName}>
                {exportData.fileName}
              </span>
            </div>
            <div className="p-3 bg-white rounded-lg border border-emerald-100">
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">Transactions</span>
              <span className="font-mono text-slate-900 font-semibold mt-0.5 block">
                {exportData.transactionCount}
              </span>
            </div>
            <div className="p-3 bg-white rounded-lg border border-emerald-100">
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">Review Rows</span>
              <span className="font-mono text-amber-700 font-semibold mt-0.5 block">
                {exportData.reviewCount}
              </span>
            </div>
            <div className="p-3 bg-white rounded-lg border border-emerald-100">
              <span className="text-slate-400 block text-[10px] uppercase font-semibold flex items-center gap-1">
                <Calendar className="w-3 h-3 text-slate-400" /> Generated
              </span>
              <span className="text-slate-800 text-[11px] mt-0.5 block">
                {formatDateTime(exportData.createdAt)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
