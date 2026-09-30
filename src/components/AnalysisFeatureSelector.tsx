import React from "react";
import {
  FileText,
  Landmark,
  Layers,
  ShieldCheck,
  FileSpreadsheet,
  Info,
  CheckSquare,
  Square,
} from "lucide-react";
import {
  type AnalysisFeature,
  FEATURE_DEFINITIONS,
  ALL_ANALYSIS_FEATURES,
  toggleFeatureWithDependencies,
} from "../../lib/analysis/feature-pipeline";

interface AnalysisFeatureSelectorProps {
  selectedFeatures: AnalysisFeature[];
  onChange: (features: AnalysisFeature[]) => void;
  disabled?: boolean;
}

const FEATURE_ICONS: Record<AnalysisFeature, React.ElementType> = {
  metadata: FileText,
  bankDetection: Landmark,
  transactionExtraction: Layers,
  validation: ShieldCheck,
  excelExport: FileSpreadsheet,
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
      // Auto clear notice after 5 seconds
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

  const handleClearAll = () => {
    if (disabled) return;
    // Keep at least metadata or bankDetection if desired, but allow user to select minimal
    onChange(["metadata"]);
    setDependencyNotice(null);
  };

  return (
    <div className="w-full bg-slate-900/60 border border-slate-800 rounded-xl p-4 sm:p-5 backdrop-blur-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-200 tracking-wide flex items-center gap-2">
            <span>What do you want to analyze?</span>
            <span className="text-xs text-slate-400 font-normal">
              ({selectedFeatures.length} of {ALL_ANALYSIS_FEATURES.length} selected)
            </span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Pilih fitur analisis yang ingin dijalankan pada berkas PDF ini.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={handleSelectAll}
            disabled={disabled || selectedFeatures.length === ALL_ANALYSIS_FEATURES.length}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-50 transition-colors"
          >
            Pilih Semua
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            disabled={disabled || selectedFeatures.length <= 1}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-300 disabled:opacity-50 transition-colors"
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
          className="mb-4 flex items-start gap-2.5 px-3 py-2.5 bg-blue-950/40 border border-blue-800/60 rounded-lg text-xs text-blue-200"
        >
          <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <div className="flex-1">{dependencyNotice}</div>
          <button
            type="button"
            onClick={() => setDependencyNotice(null)}
            className="text-blue-400 hover:text-blue-200 font-bold px-1"
            aria-label="Tutup notifikasi ketergantungan fitur"
          >
            ×
          </button>
        </div>
      )}

      {/* Feature cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {ALL_ANALYSIS_FEATURES.map((featureId) => {
          const def = FEATURE_DEFINITIONS[featureId];
          const isSelected = selectedFeatures.includes(featureId);
          const Icon = FEATURE_ICONS[featureId];

          return (
            <label
              key={featureId}
              htmlFor={`feature-checkbox-${featureId}`}
              className={`relative flex items-start gap-3 p-3.5 rounded-lg border transition-all cursor-pointer select-none ${
                isSelected
                  ? "bg-slate-800/90 border-blue-500/50 shadow-sm shadow-blue-500/10"
                  : "bg-slate-900/40 border-slate-800/80 hover:border-slate-700 opacity-75 hover:opacity-100"
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
                  aria-label={def.label}
                />
                {isSelected ? (
                  <CheckSquare className="w-4 h-4 text-blue-400" />
                ) : (
                  <Square className="w-4 h-4 text-slate-500" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <Icon
                    className={`w-3.5 h-3.5 ${
                      isSelected ? "text-blue-400" : "text-slate-500"
                    }`}
                  />
                  <span
                    className={`text-xs font-medium ${
                      isSelected ? "text-slate-100" : "text-slate-400"
                    }`}
                  >
                    {def.label}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 leading-snug line-clamp-2">
                  {def.shortExplanation}
                </p>

                {def.dependencies.length > 0 && (
                  <div className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-500">
                    <span>Memerlukan:</span>
                    <span className="font-mono text-slate-400">
                      {def.dependencies
                        .map((dep) => FEATURE_DEFINITIONS[dep].label)
                        .join(", ")}
                    </span>
                  </div>
                )}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
};
