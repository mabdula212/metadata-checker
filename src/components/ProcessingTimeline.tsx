import React from "react";
import {
  CheckCircle2,
  Loader2,
  Circle,
  MinusCircle,
  AlertTriangle,
  XCircle,
} from "lucide-react";

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
  title?: string;
  subtitle?: string;
  hideSkipped?: boolean;
}

export const ProcessingTimeline: React.FC<ProcessingTimelineProps> = ({
  steps,
  title = "Analyzing Your Document",
  subtitle = "We're processing the analysis you selected.",
  hideSkipped = true,
}) => {
  const visibleSteps = hideSkipped
    ? steps.filter((s) => !s.isSkipped && s.status !== "SKIPPED")
    : steps;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
        <div>
          <h4 className="text-sm font-semibold text-slate-900 tracking-tight">
            {title}
          </h4>
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        </div>
      </div>

      <div className="space-y-3">
        {visibleSteps.map((step) => {
          const { status, label, detail, isSkipped } = step;

          return (
            <div
              key={step.id}
              className={`flex items-center justify-between text-xs py-1.5 px-3 rounded-xl transition-colors ${
                status === "PROCESSING"
                  ? "bg-blue-50/60 border border-blue-100"
                  : "hover:bg-slate-50"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                {/* Status Icon */}
                <div className="shrink-0">
                  {status === "COMPLETED" ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : status === "PROCESSING" ? (
                    <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                  ) : status === "PARTIAL" ? (
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                  ) : status === "FAILED" ? (
                    <XCircle className="w-4 h-4 text-rose-500" />
                  ) : isSkipped || status === "SKIPPED" ? (
                    <MinusCircle className="w-4 h-4 text-slate-300" />
                  ) : (
                    <Circle className="w-4 h-4 text-slate-300" />
                  )}
                </div>

                {/* Step Label */}
                <span
                  className={`font-medium ${
                    status === "COMPLETED"
                      ? "text-slate-900"
                      : status === "PROCESSING"
                      ? "text-blue-900 font-semibold"
                      : status === "PARTIAL"
                      ? "text-amber-800 font-semibold"
                      : status === "FAILED"
                      ? "text-rose-800"
                      : isSkipped || status === "SKIPPED"
                      ? "text-slate-400"
                      : "text-slate-500"
                  }`}
                >
                  {label}
                </span>

                {detail && (
                  <span className="text-[11px] text-slate-400 hidden sm:inline truncate">
                    ({detail})
                  </span>
                )}
              </div>

              {/* Status Badge */}
              <div className="shrink-0 text-[11px]">
                {status === "COMPLETED" ? (
                  <span className="text-emerald-700 font-medium flex items-center gap-1">
                    ✓ Complete
                  </span>
                ) : status === "PROCESSING" ? (
                  <span className="text-blue-700 font-medium flex items-center gap-1">
                    ● Processing...
                  </span>
                ) : status === "PARTIAL" ? (
                  <span className="text-amber-700 font-medium">Needs Review</span>
                ) : status === "FAILED" ? (
                  <span className="text-rose-700 font-medium">× Failed</span>
                ) : isSkipped || status === "SKIPPED" ? (
                  <span className="text-slate-400 italic">— Skipped</span>
                ) : (
                  <span className="text-slate-400">○ Queued</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
