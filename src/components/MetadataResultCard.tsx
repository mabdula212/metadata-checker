import React, { useState } from "react";
import type { DocumentRecord, DocumentMetadataRecord } from "../types/metadata";
import { formatBytes } from "../lib/utils";
import {
  FileText,
  Copy,
  Check,
  Calendar,
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

  // Safely extract PDF version from rawMetadataJson
  const rawObj = (metadata.rawMetadataJson as Record<string, unknown>) || {};
  const pdfVersion = typeof rawObj.pdfVersion === "string" ? rawObj.pdfVersion : null;

  const metadataFields = [
    { label: "Title", value: metadata.title },
    { label: "Author", value: metadata.author },
    { label: "Subject", value: metadata.subject },
    { label: "Creator", value: metadata.creator },
    { label: "Producer", value: metadata.producer },
    { label: "Creation Date", value: metadata.creationDate ? formatDate(metadata.creationDate) : null },
    { label: "Modification Date", value: metadata.modificationDate ? formatDate(metadata.modificationDate) : null },
    { label: "PDF Version", value: pdfVersion ? `v${pdfVersion}` : null },
    { label: "Document Type", value: "Unknown", note: "Classification deferred to Bank Detection stage" },
  ];

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-6 sm:p-8 shadow-xs space-y-6">
      {/* Duplicate Notice Banner */}
      {isDuplicate && (
        <div
          role="status"
          className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-3 text-xs sm:text-sm"
        >
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5 flex-1">
            <div className="font-semibold text-amber-950">Duplicate Document Detected</div>
            <p className="text-amber-800 leading-relaxed">
              This PDF has already been analyzed. Displaying existing metadata record from the database. No duplicate entry was created.
            </p>
          </div>
        </div>
      )}

      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-neutral-100">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-neutral-900 text-white flex items-center justify-center shrink-0 shadow-xs">
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg sm:text-xl font-extrabold text-neutral-950 tracking-tight">
                METADATA RESULT
              </h2>
              <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-200 uppercase tracking-wide">
                Verified PDF
              </span>
            </div>
            <p className="text-xs text-neutral-500 mt-0.5">
              Inspected on {formatDate(metadata.createdAt || document.createdAt)}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-medium transition-colors cursor-pointer shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Inspect Another PDF
        </button>
      </div>

      {/* Primary File Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200/80">
          <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block">
            File Name
          </span>
          <span className="text-xs sm:text-sm font-semibold text-neutral-900 truncate block mt-1" title={document.originalFileName}>
            {document.originalFileName}
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200/80">
          <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block">
            File Size
          </span>
          <span className="text-xs sm:text-sm font-semibold text-neutral-900 block mt-1">
            {formatBytes(document.fileSize)}
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200/80">
          <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block">
            Total Pages
          </span>
          <span className="text-xs sm:text-sm font-semibold text-neutral-900 flex items-center gap-1.5 mt-1">
            <Layers className="w-3.5 h-3.5 text-neutral-500" />
            {metadata.pageCount !== null ? `${metadata.pageCount} ${metadata.pageCount === 1 ? "page" : "pages"}` : "Not available"}
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200/80">
          <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block">
            Document Type
          </span>
          <span className="text-xs sm:text-sm font-semibold text-neutral-900 block mt-1">
            {document.documentType === "UNKNOWN" ? "Unknown" : document.documentType}
          </span>
        </div>
      </div>

      {/* SHA-256 Checksum Card */}
      <div className="p-4 rounded-xl bg-neutral-900 text-white space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-neutral-400 font-mono flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
            <Hash className="w-3.5 h-3.5 text-neutral-400" />
            SHA-256 Checksum
          </span>
          <button
            type="button"
            onClick={handleCopyHash}
            className="inline-flex items-center gap-1 text-[11px] font-mono text-neutral-300 hover:text-white px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 transition-colors cursor-pointer"
          >
            {copiedHash ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                Copied
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                Copy Hash
              </>
            )}
          </button>
        </div>
        <div className="font-mono text-xs sm:text-sm text-neutral-200 break-all select-all">
          {metadata.fileHash || "Not available"}
        </div>
      </div>

      {/* Detailed PDF Metadata Section */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-neutral-900 uppercase tracking-wider flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-neutral-500" />
          PDF Metadata Attributes
        </h3>

        <div className="border border-neutral-200 rounded-xl overflow-hidden divide-y divide-neutral-100">
          {metadataFields.map((field) => (
            <div
              key={field.label}
              className="px-4 py-3 sm:py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 hover:bg-neutral-50/60 transition-colors"
            >
              <div className="sm:w-1/3">
                <span className="text-xs font-semibold text-neutral-700">
                  {field.label}
                </span>
                {field.note && (
                  <p className="text-[10px] text-neutral-400">{field.note}</p>
                )}
              </div>
              <div className="sm:w-2/3">
                {field.value ? (
                  <span className="text-xs sm:text-sm font-medium text-neutral-950 break-words">
                    {field.value}
                  </span>
                ) : (
                  <span className="inline-block text-[11px] font-medium text-neutral-400 italic bg-neutral-100 px-2 py-0.5 rounded">
                    Not available
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Expandable Raw Metadata JSON */}
      <div className="border-t border-neutral-100 pt-4">
        <button
          type="button"
          onClick={() => setShowRawJson(!showRawJson)}
          className="flex items-center justify-between w-full text-left text-xs font-semibold text-neutral-600 hover:text-neutral-900 cursor-pointer py-1"
        >
          <span>Raw Metadata JSON Payload</span>
          {showRawJson ? (
            <ChevronUp className="w-4 h-4 text-neutral-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-neutral-500" />
          )}
        </button>

        {showRawJson && (
          <div className="mt-3 p-4 rounded-xl bg-neutral-950 text-emerald-400 font-mono text-[11px] sm:text-xs overflow-x-auto max-h-80 select-all border border-neutral-800">
            <pre className="whitespace-pre-wrap leading-relaxed">
              {JSON.stringify(metadata.rawMetadataJson, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
