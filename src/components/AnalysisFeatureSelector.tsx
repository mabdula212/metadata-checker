import React from "react";
import {
  FileText,
  Landmark,
  Layers,
  ShieldCheck,
  FileSpreadsheet,
  Info,
  Check,
} from "lucide-react";
import {
  type AnalysisFeature,
  ALL_ANALYSIS_FEATURES,
  toggleFeatureWithDependencies,
} from "../../lib/analysis/feature-pipeline";

interface AnalysisFeatureSelectorProps {
  selectedFeatures: AnalysisFeature[];
  onChange: (features: AnalysisFeature[]) => void;
  disabled?: boolean;
}

const FEATURE_META: Record<
  AnalysisFeature,
  { label: string; description: string; icon: React.ElementType }
> = {
  metadata: {
    label: "PDF Metadata",
    description: "View document metadata and technical information.",
    icon: FileText,
  },
  bankDetection: {
    label: "Bank Detection",
    description: "Identify the bank and statement information.",
    icon: Landmark,
  },
  transactionExtraction: {
    label: "Transaction Extraction",
    description: "Extract transactions into structured data.",
    icon: Layers,
  },
  validation: {
    label: "Balance Validation",
    description: "Validate transaction balance continuity.",
    icon: ShieldCheck,
  },
  excelExport: {
    label: "Excel Export",
    description: "Export analysis results to Excel.",
    icon: FileSpreadsheet,
  },
};

export const AnalysisFeatureSelector: React.FC<AnalysisFeatureSelectorProps> = ({
  selectedFeatures,
  onChange,
  disabled = false,
}) => {
  const [dependencyNotice, setDependencyNotice] = React.useState<string | null>(null);

  const handleToggle = (feature: AnalysisFeature) => {
    if (disabled) return;
    const { updatedFeatures, explanation } = toggleFeatureWithDependencies(
      feature,
      selectedFeatures
    );
    onChange(updatedFeatures);
    if (explanation) {
      setDependencyNotice(explanation);
      setTimeout(() => {
        setDependencyNotice((curr) => (curr === explanation ? null : curr));
      }, 5000);
    }
  };

  const handleSelectAll = () => {
    if (disabled) return;
    onChange([...ALL_ANALYSIS_FEATURES]);
    setDependencyNotice(null);
  };

  const handleResetMinimal = () => {
    if (disabled) return;
    onChange(["metadata"]);
    setDependencyNotice(null);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900 tracking-tight">
              Choose What You Want to Analyze
            </h3>
            <span className="text-xs text-slate-500 font-normal">
              · {selectedFeatures.length} of {ALL_ANALYSIS_FEATURES.length} selected
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Select one or more analysis features to run on your bank statement.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={handleSelectAll}
            disabled={disabled || selectedFeatures.length === ALL_ANALYSIS_FEATURES.length}
            className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40 transition-colors font-medium cursor-pointer"
          >
            Select All
          </button>
          <button
            type="button"
            onClick={handleResetMinimal}
            disabled={disabled || selectedFeatures.length <= 1}
            className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-slate-700 disabled:opacity-40 transition-colors font-medium cursor-pointer"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Dependency explanation alert */}
      {dependencyNotice && (
        <div
          role="status"
          aria-live="polite"
          className="mb-5 flex items-start gap-2.5 px-3.5 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 animate-in fade-in duration-150"
        >
          <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <div className="flex-1 font-medium leading-relaxed">{dependencyNotice}</div>
          <button
            type="button"
            onClick={() => setDependencyNotice(null)}
            className="text-blue-500 hover:text-blue-800 font-bold px-1 cursor-pointer"
            aria-label="Dismiss notice"
          >
            ×
          </button>
        </div>
      )}

      {/* Feature cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {ALL_ANALYSIS_FEATURES.map((featureId) => {
          const meta = FEATURE_META[featureId];
          const isSelected = selectedFeatures.includes(featureId);
          const Icon = meta.icon;

          return (
            <label
              key={featureId}
              htmlFor={`feature-checkbox-${featureId}`}
              className={`relative flex items-start gap-3.5 p-4 rounded-xl border transition-all cursor-pointer select-none ${
                isSelected
                  ? "bg-blue-50/40 border-blue-600/70 shadow-xs"
                  : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50"
              } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
            >
              <div className="pt-0.5">
                <input
                  id={`feature-checkbox-${featureId}`}
                  type="checkbox"
                  checked={isSelected}
                  disabled={disabled}
                  onChange={() => handleToggle(featureId)}
                  className="sr-only"
                  aria-label={meta.label}
                />
                <div
                  className={`w-4 h-4 rounded flex items-center justify-center border transition-colors ${
                    isSelected
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "border-slate-300 bg-white"
                  }`}
                >
                  {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
                      isSelected
                        ? "bg-blue-100 text-blue-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <span
                    className={`text-xs font-semibold ${
                      isSelected ? "text-slate-900" : "text-slate-700"
                    }`}
                  >
                    {meta.label}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                  {meta.description}
                </p>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
};
