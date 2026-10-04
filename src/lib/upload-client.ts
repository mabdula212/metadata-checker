/**
 * Client-side Upload Service with genuine progress monitoring,
 * rolling window speed calculation, ETA estimation, cancellation, and state management.
 */

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

export type UploadState =
  | "IDLE"
  | "SELECTED"
  | "UPLOADING"
  | "UPLOADED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface UploadProgressData {
  state: UploadState;
  loadedBytes: number;
  totalBytes: number;
  percentage: number;
  speedBytesPerSec: number;
  formattedSpeed: string;
  etaSeconds: number | null;
  formattedEta: string;
  statusText: string;
  errorMessage?: string | null;
}

export interface SpeedSample {
  timestamp: number; // ms
  loaded: number; // bytes
}

export interface UploadOptions {
  url: string;
  formData: FormData;
  token?: string | null;
  onProgress?: (progress: UploadProgressData) => void;
}

export interface UploadTask<T = any> {
  promise: Promise<{ ok: boolean; status: number; data?: T; error?: string }>;
  abort: () => void;
}

/**
 * Format bytes into human readable MB or KB
 */
export function formatBytesDisplay(bytes: number): string {
  if (!bytes || isNaN(bytes) || bytes <= 0) return "0 B";
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

/**
 * Format speed in MB/s or KB/s
 */
export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0 || !isFinite(bytesPerSec)) {
    return "0 KB/s";
  }
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
}

/**
 * Format ETA in seconds / minutes
 */
export function formatEta(seconds: number | null): string {
  if (seconds === null || !isFinite(seconds) || seconds < 0) {
    return "Calculating...";
  }
  if (seconds === 0) {
    return "Complete";
  }
  if (seconds < 1) {
    return "< 1 second";
  }
  if (seconds < 60) {
    return `${seconds.toFixed(1)} seconds`;
  }
  const mins = Math.floor(seconds / 60);
  const remSecs = Math.round(seconds % 60);
  return `${mins}m ${remSecs}s`;
}

/**
 * Calculates rolling average speed from historical samples (moving window of ~4 samples)
 */
export function calculateRollingSpeed(samples: SpeedSample[]): number {
  if (samples.length < 2) return 0;

  // Use up to the last 5 samples for a smooth moving average
  const windowSamples = samples.slice(-5);
  const oldest = windowSamples[0];
  const newest = windowSamples[windowSamples.length - 1];

  const timeDiffSec = (newest.timestamp - oldest.timestamp) / 1000;
  const bytesDiff = newest.loaded - oldest.loaded;

  if (timeDiffSec <= 0 || bytesDiff < 0) return 0;
  return bytesDiff / timeDiffSec;
}

/**
 * Executes upload via XMLHttpRequest to track genuine upload progress and support cancellation.
 */
export function executeUpload<T = any>(options: UploadOptions): UploadTask<T> {
  const { url, formData, token, onProgress } = options;
  const xhr = new XMLHttpRequest();
  const speedSamples: SpeedSample[] = [];
  const startTime = Date.now();

  let isAborted = false;
  let hasFinished = false;

  const emitProgress = (data: UploadProgressData) => {
    if (onProgress) {
      onProgress(data);
    }
  };

  const promise = new Promise<{ ok: boolean; status: number; data?: T; error?: string }>(
    (resolve) => {
      xhr.open("POST", url, true);

      // Auth header
      if (token) {
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      }

      // Track genuine upload progress
      xhr.upload.onprogress = (event: ProgressEvent) => {
        if (!event.lengthComputable) return;

        const now = Date.now();
        speedSamples.push({ timestamp: now, loaded: event.loaded });

        // Calculate rolling speed
        const speed = calculateRollingSpeed(speedSamples);
        const remainingBytes = Math.max(0, event.total - event.loaded);
        const eta = speed > 0 ? remainingBytes / speed : null;

        // Ensure UI never displays 100% until upload has actually completed!
        const rawPercentage = (event.loaded / event.total) * 100;
        const percentage = Math.min(Math.floor(rawPercentage), 99);

        emitProgress({
          state: "UPLOADING",
          loadedBytes: event.loaded,
          totalBytes: event.total,
          percentage,
          speedBytesPerSec: speed,
          formattedSpeed: formatSpeed(speed),
          etaSeconds: eta,
          formattedEta: formatEta(eta),
          statusText: "Uploading...",
        });
      };

      // Upload completed on the client side, now server processing
      xhr.upload.onload = () => {
        emitProgress({
          state: "UPLOADED",
          loadedBytes: speedSamples.length > 0 ? speedSamples[speedSamples.length - 1].loaded : 0,
          totalBytes: speedSamples.length > 0 ? speedSamples[speedSamples.length - 1].loaded : 0,
          percentage: 100,
          speedBytesPerSec: 0,
          formattedSpeed: "0 KB/s",
          etaSeconds: 0,
          formattedEta: "Complete",
          statusText: "Upload complete",
        });

        // Immediately transition to processing
        setTimeout(() => {
          if (!hasFinished && !isAborted) {
            emitProgress({
              state: "PROCESSING",
              loadedBytes: 0,
              totalBytes: 0,
              percentage: 100,
              speedBytesPerSec: 0,
              formattedSpeed: "0 KB/s",
              etaSeconds: 0,
              formattedEta: "Complete",
              statusText: "Processing PDF...",
            });
          }
        }, 150);
      };

      // Full server response received
      xhr.onload = () => {
        hasFinished = true;
        const status = xhr.status;
        const contentType = xhr.getResponseHeader("content-type") || "";

        let responseData: any = null;
        if (contentType.includes("application/json")) {
          try {
            responseData = JSON.parse(xhr.responseText);
          } catch {
            responseData = null;
          }
        }

        const isOk = status >= 200 && status < 300;

        if (isOk) {
          emitProgress({
            state: "COMPLETED",
            loadedBytes: 0,
            totalBytes: 0,
            percentage: 100,
            speedBytesPerSec: 0,
            formattedSpeed: "0 KB/s",
            etaSeconds: 0,
            formattedEta: "Complete",
            statusText: "Analysis complete",
          });
          resolve({ ok: true, status, data: responseData });
        } else {
          const errMsg =
            responseData?.error ||
            responseData?.message ||
            (status === 422 && responseData?.requiresPassword
              ? "Dokumen ini dilindungi password."
              : `Request failed with status ${status}`);

          emitProgress({
            state: "FAILED",
            loadedBytes: 0,
            totalBytes: 0,
            percentage: 0,
            speedBytesPerSec: 0,
            formattedSpeed: "0 KB/s",
            etaSeconds: null,
            formattedEta: "Calculating...",
            statusText: "Upload or analysis failed",
            errorMessage: errMsg,
          });
          resolve({ ok: false, status, data: responseData, error: errMsg });
        }
      };

      xhr.onerror = () => {
        hasFinished = true;
        if (isAborted) return;
        const errMsg = "Network error: Failed to connect to server.";
        emitProgress({
          state: "FAILED",
          loadedBytes: 0,
          totalBytes: 0,
          percentage: 0,
          speedBytesPerSec: 0,
          formattedSpeed: "0 KB/s",
          etaSeconds: null,
          formattedEta: "Calculating...",
          statusText: "Network error",
          errorMessage: errMsg,
        });
        resolve({ ok: false, status: 0, error: errMsg });
      };

      xhr.onabort = () => {
        hasFinished = true;
        isAborted = true;
        emitProgress({
          state: "CANCELLED",
          loadedBytes: 0,
          totalBytes: 0,
          percentage: 0,
          speedBytesPerSec: 0,
          formattedSpeed: "0 KB/s",
          etaSeconds: null,
          formattedEta: "Calculating...",
          statusText: "Upload cancelled",
        });
        resolve({ ok: false, status: 0, error: "Upload cancelled by user." });
      };

      xhr.send(formData);
    }
  );

  return {
    promise,
    abort: () => {
      if (!hasFinished && !isAborted) {
        isAborted = true;
        xhr.abort();
      }
    },
  };
}
