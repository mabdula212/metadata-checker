import React from "react";
import type { RecentDocumentItem } from "../types/metadata";
import { formatBytes } from "../lib/utils";
import { Clock, FileText, CheckCircle2, ChevronRight, Hash } from "lucide-react";

interface RecentFilesTableProps {
  documents: RecentDocumentItem[];
  loading: boolean;
  onSelectDocument: (doc: RecentDocumentItem) => void;
}

export function RecentFilesTable({
  documents,
  loading,
  onSelectDocument,
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
      <div className="bg-white border border-neutral-200 rounded-xl p-8 text-center shadow-xs">
        <div className="animate-spin w-6 h-6 border-2 border-neutral-300 border-t-neutral-900 rounded-full mx-auto mb-2" />
        <p className="text-xs text-neutral-500">Loading recently analyzed documents...</p>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="bg-white border border-neutral-200 rounded-xl p-8 sm:p-10 text-center shadow-xs">
        <div className="w-12 h-12 rounded-full bg-neutral-100 text-neutral-400 flex items-center justify-center mx-auto mb-3">
          <Clock className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-neutral-900">No recent files</h3>
        <p className="text-xs text-neutral-500 mt-1 max-w-sm mx-auto leading-relaxed">
          Uploaded PDF bank statements will appear in this ledger once processed and stored in Neon PostgreSQL.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-xs">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500 font-semibold uppercase tracking-wider text-[10px]">
            <tr>
              <th className="py-3 px-4">Document</th>
              <th className="py-3 px-4">Type / Bank</th>
              <th className="py-3 px-4">Size</th>
              <th className="py-3 px-4">Pages</th>
              <th className="py-3 px-4">SHA-256</th>
              <th className="py-3 px-4">Analyzed</th>
              <th className="py-3 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 text-neutral-800">
            {documents.map((doc) => {
              const hash = doc.metadata?.fileHash;
              const pages = doc.metadata?.pageCount;
              const bankName = doc.statement?.bankName;
              return (
                <tr
                  key={doc.id}
                  onClick={() => doc.metadata && onSelectDocument(doc)}
                  className="hover:bg-neutral-50/70 transition-colors cursor-pointer group"
                >
                  <td className="py-3 px-4 font-medium text-neutral-950 flex items-center gap-2.5">
                    <FileText className="w-4 h-4 text-neutral-400 group-hover:text-neutral-900 shrink-0" />
                    <span className="truncate max-w-[180px] sm:max-w-xs" title={doc.originalFileName}>
                      {doc.originalFileName}
                    </span>
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    {doc.documentType === "BANK_STATEMENT" ? (
                      <span className="inline-flex items-center gap-1 rounded-sm bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                        {bankName && bankName !== "Unknown Bank" ? bankName : "Bank Statement"}
                      </span>
                    ) : doc.documentType === "OTHER_PDF" ? (
                      <span className="inline-flex items-center rounded-sm bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                        Other PDF
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400">
                        Unknown
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-neutral-600 whitespace-nowrap">
                    {formatBytes(doc.fileSize)}
                  </td>
                  <td className="py-3 px-4 text-neutral-600 whitespace-nowrap">
                    {pages !== null && pages !== undefined ? `${pages} pp` : "—"}
                  </td>
                  <td className="py-3 px-4 font-mono text-[11px] text-neutral-500 whitespace-nowrap">
                    {hash ? `${hash.slice(0, 8)}...${hash.slice(-6)}` : "—"}
                  </td>
                  <td className="py-3 px-4 text-neutral-500 whitespace-nowrap">
                    {formatDate(doc.createdAt)}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (doc.metadata) onSelectDocument(doc);
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-700 hover:text-neutral-950 group-hover:underline cursor-pointer"
                    >
                      <span>View</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
