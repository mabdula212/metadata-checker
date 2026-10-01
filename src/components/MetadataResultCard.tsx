import React, { useState } from "react";
import type { DocumentRecord, DocumentMetadataRecord } from "../types/metadata";
import { formatBytes } from "../lib/utils";
import {
  FileText,
  Copy,
  Check,
  Layers,
  Hash,
  Info,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";

interface MetadataResultCardProps {
  document: DocumentRecord;
  metadata: DocumentMetadataRecord;
  isDuplicate?: boolean;
  onReset: () => void;
}

export function MetadataResultCard({
  document,
  metadata,
  isDuplicate,
  onReset,
}: MetadataResultCardProps) {
  const [copiedHash, setCopiedHash] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);

  const handleCopyHash = () => {
    if (metadata.fileHash) {
      navigator.clipboard.writeText(metadata.fileHash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    }
  };

  const formatDate = (isoString: string | null | undefined): string => {
    if (!isoString) return "Not available";
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return "Not available";
      return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      });
    } catch {
      return "Not available";
    }
  };

  const rawObj = (metadata.rawMetadataJson as Record<string, unknown>) || {};
  const pdfVersion = typeof rawObj.pdfVersion === "string" ? rawObj.pdfVersion : null;
  const metadataStatus = typeof rawObj.metadataStatus === "string" ? rawObj.metadataStatus : "SUCCESS";
  const isPartial = metadataStatus === "PARTIAL" || (!metadata.title && !metadata.author && metadata.pageCount && metadata.pageCount > 0);
  const explanation = typeof rawObj.explanation === "string" ? rawObj.explanation : null;

  const metadataFields = [
    { label: "Title", value: metadata.title },
    { label: "Author", value: metadata.author },
    { label: "Subject", value: metadata.subject },
    { label: "Creator", value: metadata.creator },
    { label: "Producer", value: metadata.producer },
    { label: "Creation Date", value: metadata.creationDate ? formatDate(metadata.creationDate) : null },
    { label: "Modification Date", value: metadata.modificationDate ? formatDate(metadata.modificationDate) : null },
    { label: "Page Count", value: metadata.pageCount !== null ? `${metadata.pageCount} ${metadata.pageCount === 1 ? "page" : "pages"}` : null },
    { label: "PDF Version", value: pdfVersion ? `v${pdfVersion}` : null },
  ];

  return (
    <div id="pdf-metadata-card" className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-7 shadow-xs space-y-6">
      {/* Duplicate Notice Banner */}
      {isDuplicate && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-2.5 text-xs"
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5 flex-1">
            <div className="font-semibold text-amber-950">Duplicate Document Detected</div>
            <p className="text-amber-800 leading-relaxed">
              This PDF has already been analyzed. Displaying existing record from the database.
            </p>
          </div>
        </div>
      )}

      {/* Partial Metadata Notice */}
      {isPartial && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 text-amber-900 flex items-start gap-2.5 text-xs"
        >
          <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-semibold text-amber-950">Partial Metadata Available: </span>
            <span className="text-amber-900/90">
              {explanation || "Document pages and structure were read successfully. Some title/author tags were not explicitly set by the bank's PDF generator."}
            </span>
          </div>
        </div>
      )}

      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0 border border-blue-100">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900 tracking-tight">
                PDF Metadata
              </h3>
              <span className="text-xs text-slate-500 font-normal">
                · {formatBytes(document.fileSize)}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Inspected on {formatDate(metadata.createdAt || document.createdAt)}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors cursor-pointer shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Analyze Another File
        </button>
      </div>

      {/* File Hash & Primary Metadata Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-xl bg-slate-50/70 border border-slate-200/80">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
            File Name
          </span>
          <span className="text-xs font-semibold text-slate-900 truncate block mt-1" title={document.originalFileName}>
            {document.originalFileName}
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50/70 border border-slate-200/80">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
            Page Count
          </span>
          <span className="text-xs font-semibold text-slate-900 flex items-center gap-1.5 mt-1">
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            {metadata.pageCount !== null ? `${metadata.pageCount} ${metadata.pageCount === 1 ? "page" : "pages"}` : "Not available"}
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50/70 border border-slate-200/80">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <Hash className="w-3 h-3" />
              File Hash (SHA-256)
            </span>
            <button
              type="button"
              onClick={handleCopyHash}
              className="text-[10px] text-blue-600 hover:text-blue-800 font-medium inline-flex items-center gap-1 cursor-pointer"
            >
              {copiedHash ? (
                <>
                  <Check className="w-3 h-3 text-emerald-600" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  Copy
                </>
              )}
            </button>
          </div>
          <span className="text-xs font-mono text-slate-800 truncate block mt-1" title={metadata.fileHash || ""}>
            {metadata.fileHash || "Not available"}
          </span>
        </div>
      </div>

      {/* Detailed Metadata Grid */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
          Technical Metadata Properties
        </h4>

        <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
          {metadataFields.map((field) => (
            <div
              key={field.label}
              className="px-4 py-2.5 sm:py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 hover:bg-slate-50/50 transition-colors text-xs"
            >
              <div className="sm:w-1/3 font-medium text-slate-600">
                {field.label}
              </div>
              <div className="sm:w-2/3">
                {field.value ? (
                  <span className="font-medium text-slate-900 break-words">
                    {field.value}
                  </span>
                ) : (
                  <span className="text-slate-400 italic">
                    Not available
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Expandable Raw Metadata JSON */}
      <div className="border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={() => setShowRawJson(!showRawJson)}
          className="flex items-center justify-between w-full text-left text-xs font-medium text-slate-500 hover:text-slate-900 cursor-pointer py-1"
        >
          <span>View Raw Metadata JSON Payload</span>
          {showRawJson ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {showRawJson && (
          <div className="mt-3 p-4 rounded-xl bg-slate-900 text-slate-200 font-mono text-[11px] overflow-x-auto max-h-80 select-all border border-slate-800">
            <pre className="whitespace-pre-wrap leading-relaxed">
              {JSON.stringify(metadata.rawMetadataJson, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
