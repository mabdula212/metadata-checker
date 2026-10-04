import React from "react";
import type { RecentDocumentItem } from "../types/metadata";
import { formatBytes } from "../lib/utils";
import {
  FileText,
  Clock,
  Eye,
  FileSpreadsheet,
  RefreshCw,
  Landmark,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";

interface RecentFilesTableProps {
  documents: RecentDocumentItem[];
  loading: boolean;
  onSelectDocument: (doc: RecentDocumentItem) => void;
  onAnalyzeNew?: () => void;
}

export function RecentFilesTable({
  documents,
  loading,
  onSelectDocument,
  onAnalyzeNew,
}: RecentFilesTableProps) {
  const formatDate = (isoString: string): string => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  };

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center shadow-xs">
        <div className="animate-spin w-7 h-7 border-2 border-slate-200 border-t-blue-600 rounded-full mx-auto mb-3" />
        <p className="text-xs text-slate-500 font-medium">Loading recent documents...</p>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-10 sm:p-14 text-center shadow-xs space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
          <Clock className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-slate-900">No recent files</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
            Your analyzed documents will appear here. Upload a bank statement to begin analysis.
          </p>
        </div>
        {onAnalyzeNew && (
          <div className="pt-2">
            <button
              type="button"
              onClick={onAnalyzeNew}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              Analyze PDF
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
      {/* Desktop Table View */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
            <tr>
              <th className="py-3.5 px-4">File</th>
              <th className="py-3.5 px-4">Bank</th>
              <th className="py-3.5 px-4">Period</th>
              <th className="py-3.5 px-4">Status</th>
              <th className="py-3.5 px-4">Uploaded</th>
              <th className="py-3.5 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {documents.map((doc) => {
              const bankName = doc.statement?.bankName;
              const periodStart = doc.statement?.statementPeriodStart;
              const periodEnd = doc.statement?.statementPeriodEnd;

              return (
                <tr
                  key={doc.id}
                  className="hover:bg-slate-50/60 transition-colors group"
                >
                  {/* File */}
                  <td className="py-3.5 px-4 font-medium text-slate-900">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900 max-w-xs" title={doc.originalFileName}>
                          {doc.originalFileName}
                        </p>
                        <span className="text-[11px] text-slate-400 font-normal">
                          {formatBytes(doc.fileSize)} · {doc.metadata?.pageCount ? `${doc.metadata.pageCount} pgs` : "PDF"}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* Bank */}
                  <td className="py-3.5 px-4 whitespace-nowrap">
                    {doc.documentType === "BANK_STATEMENT" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 border border-blue-100">
                        <Landmark className="w-3 h-3 text-blue-500" />
                        {bankName && bankName !== "Unknown Bank" ? bankName : "Bank Statement"}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-500">
                        Other Document
                      </span>
                    )}
                  </td>

                  {/* Period */}
                  <td className="py-3.5 px-4 whitespace-nowrap font-mono text-[11px] text-slate-600">
                    {periodStart && periodEnd
                      ? `${periodStart} to ${periodEnd}`
                      : periodStart || periodEnd || "—"}
                  </td>

                  {/* Status */}
                  <td className="py-3.5 px-4 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                      <ShieldCheck className="w-3 h-3 text-emerald-600" />
                      Completed
                    </span>
                  </td>

                  {/* Uploaded */}
                  <td className="py-3.5 px-4 whitespace-nowrap text-slate-500 font-mono text-[11px]">
                    {formatDate(doc.createdAt)}
                  </td>

                  {/* Actions */}
                  <td className="py-3.5 px-4 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onSelectDocument(doc)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                        title="View Analysis Results"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        View
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Card Layout (Requirement: "For mobile: Convert table rows into cards") */}
      <div className="md:hidden divide-y divide-slate-100">
        {documents.map((doc) => {
          const bankName = doc.statement?.bankName;
          const periodStart = doc.statement?.statementPeriodStart;
          const periodEnd = doc.statement?.statementPeriodEnd;

          return (
            <div key={doc.id} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-xs text-slate-900 truncate" title={doc.originalFileName}>
                      {doc.originalFileName}
                    </p>
                    <span className="text-[11px] text-slate-400">
                      {formatBytes(doc.fileSize)} · {doc.metadata?.pageCount ? `${doc.metadata.pageCount} pages` : "PDF"}
                    </span>
                  </div>
                </div>

                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 shrink-0">
                  ✓ Completed
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-slate-100 text-slate-600">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">Bank</span>
                  <span className="font-medium text-slate-800">
                    {bankName && bankName !== "Unknown Bank" ? bankName : "Bank Statement"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">Period</span>
                  <span className="font-mono text-slate-700">
                    {periodStart && periodEnd ? `${periodStart}–${periodEnd}` : "—"}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 text-[11px]">
                <span className="text-slate-400 font-mono">
                  {formatDate(doc.createdAt)}
                </span>
                <button
                  type="button"
                  onClick={() => onSelectDocument(doc)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold cursor-pointer shadow-xs"
                >
                  <Eye className="w-3.5 h-3.5" />
                  View Results
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
