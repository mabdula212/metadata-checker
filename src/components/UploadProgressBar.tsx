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
    <div className="w-full bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-lg">
      {/* Header with File and Status */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`p-2 rounded-lg shrink-0 ${
              isCompleted
                ? "bg-emerald-500/10 text-emerald-400"
                : isFailed || isCancelled
                ? "bg-rose-500/10 text-rose-400"
                : "bg-blue-500/10 text-blue-400"
            }`}
          >
            {isCompleted ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : isFailed ? (
              <AlertCircle className="w-4 h-4" />
            ) : isCancelled ? (
              <XCircle className="w-4 h-4" />
            ) : isProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <UploadCloud className="w-4 h-4 animate-pulse" />
            )}
          </div>

          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-200 truncate">
              {fileName || "Dokumen PDF"}
            </div>
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
              <span>Status:</span>
              <span
                className={`font-medium ${
                  isCompleted
                    ? "text-emerald-400"
                    : isFailed
                    ? "text-rose-400"
                    : isCancelled
                    ? "text-amber-400"
                    : isProcessing
                    ? "text-indigo-400"
                    : "text-blue-400"
                }`}
              >
                {statusText}
              </span>
            </div>
          </div>
        </div>

        {/* Action / Percentage Badge */}
        <div className="flex items-center gap-2">
          {isUploading && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-2.5 py-1 text-xs font-medium text-rose-400 hover:text-rose-300 bg-rose-950/40 hover:bg-rose-900/50 border border-rose-800/50 rounded-lg transition-colors"
              aria-label="Batalkan proses unggah PDF"
            >
              Batal Unggah
            </button>
          )}

          <div className="text-xs font-semibold font-mono px-2.5 py-1 bg-slate-800 text-slate-200 rounded-md">
            {isUploading
              ? `${percentage}%`
              : isUploaded || isProcessing || isCompleted
              ? "100%"
              : isCancelled
              ? "Dibatalkan"
              : "Gagal"}
          </div>
        </div>
      </div>

      {/* Progress Bar Container */}
      <div className="relative w-full h-2.5 bg-slate-800 rounded-full overflow-hidden mb-3">
        <div
          role="progressbar"
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progres unggah PDF"
          className={`h-full transition-all duration-200 rounded-full ${
            isCompleted
              ? "bg-emerald-500"
              : isFailed
              ? "bg-rose-500"
              : isCancelled
              ? "bg-amber-500"
              : isProcessing
              ? "bg-indigo-500 animate-pulse"
              : "bg-blue-500"
          }`}
          style={{ width: `${Math.max(percentage, isProcessing ? 100 : 2)}%` }}
        />
      </div>

      {/* Metrics Grid: Uploaded Size, Speed, ETA */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs text-slate-400 pt-1 border-t border-slate-800/80">
        {/* Uploaded / Total Size */}
        <div className="flex items-center gap-1.5">
          <HardDrive className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <div className="truncate">
            <span className="text-slate-500 mr-1">Ukuran:</span>
            <span className="text-slate-200 font-mono">
              {totalBytes > 0
                ? `${formatBytesDisplay(loadedBytes)} / ${formatBytesDisplay(totalBytes)}`
                : "—"}
            </span>
          </div>
        </div>

        {/* Rolling Speed */}
        <div className="flex items-center gap-1.5">
          <Gauge className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <div className="truncate">
            <span className="text-slate-500 mr-1">Speed:</span>
            <span className="text-slate-200 font-mono">
              {isUploading ? formattedSpeed : isProcessing ? "—" : "0 KB/s"}
            </span>
          </div>
        </div>

        {/* ETA */}
        <div className="flex items-center gap-1.5 col-span-2 sm:col-span-1">
          <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <div className="truncate">
            <span className="text-slate-500 mr-1">Estimated remaining:</span>
            <span className="text-slate-200 font-mono">
              {isUploading
                ? formattedEta
                : isUploaded || isProcessing || isCompleted
                ? "Complete"
                : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Error / Cancellation Message */}
      {(errorMessage || isCancelled) && (
        <div
          role="alert"
          className="mt-3 px-3 py-2 bg-rose-950/40 border border-rose-800/50 rounded-lg text-xs text-rose-300"
        >
          {errorMessage || "Proses unggah telah dibatalkan oleh pengguna."}
        </div>
      )}
    </div>
  );
};
