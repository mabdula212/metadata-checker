import React from "react";
import {
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Loader2,
  Clock,
  Gauge,
  HardDrive,
} from "lucide-react";
import {
  type UploadProgressData,
  formatBytesDisplay,
} from "../lib/upload-client";

interface UploadProgressBarProps {
  progress: UploadProgressData;
  onCancel?: () => void;
  fileName?: string;
}

export const UploadProgressBar: React.FC<UploadProgressBarProps> = ({
  progress,
  onCancel,
  fileName,
}) => {
  const {
    state,
    percentage,
    loadedBytes,
    totalBytes,
    formattedSpeed,
    formattedEta,
    statusText,
    errorMessage,
  } = progress;

  if (state === "IDLE" || state === "SELECTED") {
    return null;
  }

  const isUploading = state === "UPLOADING";
  const isUploaded = state === "UPLOADED";
  const isProcessing = state === "PROCESSING";
  const isCompleted = state === "COMPLETED";
  const isFailed = state === "FAILED";
  const isCancelled = state === "CANCELLED";

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
      {/* Header with Title and Cancel button */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              isCompleted
                ? "bg-emerald-50 text-emerald-600"
                : isFailed || isCancelled
                ? "bg-rose-50 text-rose-600"
                : isProcessing
                ? "bg-indigo-50 text-indigo-600"
                : "bg-blue-50 text-blue-600"
            }`}
          >
            {isCompleted ? (
              <CheckCircle2 className="w-5 h-5" />
            ) : isFailed ? (
              <AlertCircle className="w-5 h-5" />
            ) : isCancelled ? (
              <XCircle className="w-5 h-5" />
            ) : isProcessing ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <UploadCloud className="w-5 h-5 animate-pulse" />
            )}
          </div>

          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-slate-900 truncate">
              {isUploading
                ? "Uploading document..."
                : isUploaded || isProcessing
                ? "Upload complete"
                : isCompleted
                ? "Processing complete"
                : isCancelled
                ? "Upload cancelled"
                : "Upload failed"}
            </h4>
            <div className="text-xs text-slate-500 truncate mt-0.5">
              {fileName || "PDF Document"}
            </div>
          </div>
        </div>

        {/* Right action / percentage */}
        <div className="flex items-center gap-2">
          {isUploading && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-xs font-medium text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100/80 border border-rose-200 rounded-lg transition-colors cursor-pointer"
              aria-label="Cancel upload"
            >
              Cancel Upload
            </button>
          )}

          <div className="text-xs font-semibold font-mono px-2.5 py-1 bg-slate-100 text-slate-800 rounded-md">
            {isUploading
              ? `${percentage}%`
              : isUploaded || isProcessing || isCompleted
              ? "100%"
              : isCancelled
              ? "Cancelled"
              : "Failed"}
          </div>
        </div>
      </div>

      {/* Progress Track */}
      <div className="relative w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          role="progressbar"
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Upload progress"
          className={`h-full transition-all duration-200 rounded-full ${
            isCompleted
              ? "bg-emerald-600"
              : isFailed
              ? "bg-rose-600"
              : isCancelled
              ? "bg-amber-500"
              : isProcessing
              ? "bg-indigo-600 animate-pulse"
              : "bg-blue-600"
          }`}
          style={{ width: `${Math.max(percentage, isProcessing ? 100 : 2)}%` }}
        />
      </div>

      {/* Metrics Row: Size, Speed, ETA, Status */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-slate-600 pt-2 border-t border-slate-100">
        {/* Uploaded / Total Size */}
        <div className="flex items-center gap-2">
          <HardDrive className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <div className="truncate">
            <span className="text-slate-400 mr-1 block text-[10px] uppercase tracking-wider font-semibold">Size</span>
            <span className="text-slate-800 font-mono font-medium">
              {totalBytes > 0
                ? `${formatBytesDisplay(loadedBytes)} / ${formatBytesDisplay(totalBytes)}`
                : "—"}
            </span>
          </div>
        </div>

        {/* Rolling Speed */}
        <div className="flex items-center gap-2">
          <Gauge className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <div className="truncate">
            <span className="text-slate-400 mr-1 block text-[10px] uppercase tracking-wider font-semibold">Upload speed</span>
            <span className="text-slate-800 font-mono font-medium">
              {isUploading ? formattedSpeed : isProcessing ? "—" : "0 KB/s"}
            </span>
          </div>
        </div>

        {/* ETA */}
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <div className="truncate">
            <span className="text-slate-400 mr-1 block text-[10px] uppercase tracking-wider font-semibold">Remaining</span>
            <span className="text-slate-800 font-mono font-medium">
              {isUploading
                ? formattedEta
                : isUploaded || isProcessing || isCompleted
                ? "Complete"
                : "—"}
            </span>
          </div>
        </div>

        {/* Status */}
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full shrink-0 ${
              isCompleted
                ? "bg-emerald-500"
                : isFailed
                ? "bg-rose-500"
                : isCancelled
                ? "bg-amber-500"
                : "bg-blue-500 animate-pulse"
            }`}
          />
          <div className="truncate">
            <span className="text-slate-400 mr-1 block text-[10px] uppercase tracking-wider font-semibold">Status</span>
            <span className="text-slate-800 font-medium">
              {isUploading ? "Uploading securely..." : statusText}
            </span>
          </div>
        </div>
      </div>

      {/* Error / Cancellation Message */}
      {(errorMessage || isCancelled) && (
        <div
          role="alert"
          className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{errorMessage || "Upload process was cancelled by user."}</span>
        </div>
      )}
    </div>
  );
};
