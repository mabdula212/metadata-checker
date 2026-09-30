import React from "react";
import {
  CheckCircle2,
  Loader2,
  Circle,
  MinusCircle,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import type { AnalysisFeature } from "../../lib/analysis/feature-pipeline";

export type StepStatus =
  | "COMPLETED"
  | "PROCESSING"
  | "PENDING"
  | "SKIPPED"
  | "FAILED"
  | "PARTIAL";

export interface TimelineStep {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
  isSkipped?: boolean;
}

interface ProcessingTimelineProps {
  steps: TimelineStep[];
}

export const ProcessingTimeline: React.FC<ProcessingTimelineProps> = ({ steps }) => {
  return (
    <div className="w-full bg-slate-900/80 border border-slate-800 rounded-xl p-4 sm:p-5 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-3.5 pb-2.5 border-b border-slate-800">
        <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
          Processing Timeline
        </h4>
        <span className="text-[11px] text-slate-400">Tahapan Analisis Dokumen</span>
      </div>

      <div className="space-y-2.5">
        {steps.map((step, idx) => {
          const isLast = idx === steps.length - 1;
          const { status, label, detail, isSkipped } = step;

          return (
            <div key={step.id} className="flex items-center justify-between text-xs py-1">
              <div className="flex items-center gap-2.5 min-w-0">
                {/* Status Icon */}
                <div className="shrink-0">
                  {status === "COMPLETED" ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : status === "PROCESSING" ? (
                    <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                  ) : status === "PARTIAL" ? (
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                  ) : status === "FAILED" ? (
                    <XCircle className="w-4 h-4 text-rose-400" />
                  ) : isSkipped || status === "SKIPPED" ? (
                    <MinusCircle className="w-4 h-4 text-slate-600" />
                  ) : (
                    <Circle className="w-4 h-4 text-slate-600" />
                  )}
                </div>

                {/* Step Label */}
                <span
                  className={`font-medium ${
                    status === "COMPLETED"
                      ? "text-slate-200"
                      : status === "PROCESSING"
                      ? "text-blue-300"
                      : status === "PARTIAL"
                      ? "text-amber-300"
                      : status === "FAILED"
                      ? "text-rose-300"
                      : isSkipped || status === "SKIPPED"
                      ? "text-slate-500"
                      : "text-slate-400"
                  }`}
                >
                  {label}
                </span>

                {detail && (
                  <span className="text-[11px] text-slate-500 hidden sm:inline truncate">
                    ({detail})
                  </span>
                )}
              </div>

              {/* Status Badge */}
              <div className="shrink-0 text-[11px]">
                {status === "COMPLETED" ? (
                  <span className="text-emerald-400 font-medium">✓ Selesai</span>
                ) : status === "PROCESSING" ? (
                  <span className="text-blue-400 font-medium">⟳ Memproses...</span>
                ) : status === "PARTIAL" ? (
                  <span className="text-amber-400 font-medium">Perlu Tinjauan</span>
                ) : status === "FAILED" ? (
                  <span className="text-rose-400 font-medium">✕ Gagal</span>
                ) : isSkipped || status === "SKIPPED" ? (
                  <span className="text-slate-500 italic">— Skipped</span>
                ) : (
                  <span className="text-slate-600">○ Antrean</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
