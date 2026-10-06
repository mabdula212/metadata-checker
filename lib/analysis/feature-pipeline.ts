/**
 * Analysis Feature Pipeline Definitions, Dependency Resolution,
 * and Server-side Normalization.
 */

export type AnalysisFeature =
  | "metadata"
  | "bankDetection"
  | "transactionExtraction"
  | "validation"
  | "excelExport";

export interface FeatureDefinition {
  id: AnalysisFeature;
  label: string;
  shortExplanation: string;
  dependencies: AnalysisFeature[];
}

export const ALL_ANALYSIS_FEATURES: readonly AnalysisFeature[] = [
  "metadata",
  "bankDetection",
  "transactionExtraction",
  "validation",
  "excelExport",
] as const;

export const DEFAULT_ANALYSIS_FEATURES: readonly AnalysisFeature[] = [
  "metadata",
  "bankDetection",
  "transactionExtraction",
  "validation",
  "excelExport",
] as const;

export const FEATURE_DEFINITIONS: Record<AnalysisFeature, FeatureDefinition> = {
  metadata: {
    id: "metadata",
    label: "PDF Metadata",
    shortExplanation: "Inspect PDF creator, producer, dates, pages and file metadata.",
    dependencies: [],
  },
  bankDetection: {
    id: "bankDetection",
    label: "Bank Detection",
    shortExplanation: "Identify the Indonesian bank and statement information.",
    dependencies: [],
  },
  transactionExtraction: {
    id: "transactionExtraction",
    label: "Transaction Extraction",
    shortExplanation: "Extract transaction dates, descriptions, debit, credit and balance.",
    dependencies: ["bankDetection"],
  },
  validation: {
    id: "validation",
    label: "Balance Validation",
    shortExplanation: "Check transaction balance continuity and totals.",
    dependencies: ["transactionExtraction"],
  },
  excelExport: {
    id: "excelExport",
    label: "Excel Export",
    shortExplanation: "Export analysis results into a structured Excel workbook.",
    dependencies: ["transactionExtraction", "validation"],
  },
};

/**
 * Validates and normalizes feature selections from any client request.
 * - Filters unknown features
 * - Automatically resolves required dependencies
 * - Returns a canonical ordered array
 */
export function normalizeAnalysisOptions(input: unknown): AnalysisFeature[] {
  let requested: string[] = [];

  if (Array.isArray(input)) {
    requested = input.filter((item): item is string => typeof item === "string");
  } else if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) {
        requested = parsed.filter((item): item is string => typeof item === "string");
      } else {
        requested = input.split(",").map((s) => s.trim());
      }
    } catch {
      requested = input.split(",").map((s) => s.trim());
    }
  } else if (input && typeof input === "object" && "features" in input) {
    const objFeatures = (input as { features: unknown }).features;
    if (Array.isArray(objFeatures)) {
      requested = objFeatures.filter((item): item is string => typeof item === "string");
    }
  }

  // If nothing specified, use default all features
  if (requested.length === 0) {
    return [...DEFAULT_ANALYSIS_FEATURES];
  }

  // Filter out unknown features
  const validFeatures = new Set<AnalysisFeature>();
  for (const item of requested) {
    if ((ALL_ANALYSIS_FEATURES as readonly string[]).includes(item)) {
      validFeatures.add(item as AnalysisFeature);
    }
  }

  // If no valid features were provided after filtering, return default
  if (validFeatures.size === 0) {
    return [...DEFAULT_ANALYSIS_FEATURES];
  }

  // Resolve dependencies recursively:
  // Rule 1: excelExport requires transactionExtraction and validation
  if (validFeatures.has("excelExport")) {
    validFeatures.add("transactionExtraction");
    validFeatures.add("validation");
    validFeatures.add("bankDetection");
  }

  // Rule 2: validation requires transactionExtraction
  if (validFeatures.has("validation")) {
    validFeatures.add("transactionExtraction");
    validFeatures.add("bankDetection");
  }

  // Rule 3: transactionExtraction requires bankDetection
  if (validFeatures.has("transactionExtraction")) {
    validFeatures.add("bankDetection");
  }

  // Return canonical order
  return ALL_ANALYSIS_FEATURES.filter((f) => validFeatures.has(f));
}

/**
 * Helper to update selected features when a user toggles an option in the UI,
 * returning the updated list and an explanation if dependencies were added/removed.
 */
export function toggleFeatureWithDependencies(
  feature: AnalysisFeature,
  currentSelection: AnalysisFeature[]
): {
  updatedFeatures: AnalysisFeature[];
  explanation: string | null;
} {
  const currentSet = new Set<AnalysisFeature>(currentSelection);
  const isCurrentlySelected = currentSet.has(feature);

  if (!isCurrentlySelected) {
    // ENABLING feature
    currentSet.add(feature);
    let explanation: string | null = null;

    if (feature === "excelExport") {
      currentSet.add("transactionExtraction");
      currentSet.add("validation");
      currentSet.add("bankDetection");
      explanation = "Excel Export membutuhkan Transaction Extraction dan Validation.";
    } else if (feature === "validation") {
      currentSet.add("transactionExtraction");
      currentSet.add("bankDetection");
      explanation = "Balance Validation membutuhkan Transaction Extraction.";
    } else if (feature === "transactionExtraction") {
      currentSet.add("bankDetection");
      explanation = "Transaction Extraction membutuhkan Bank Detection.";
    }

    const updated = ALL_ANALYSIS_FEATURES.filter((f) => currentSet.has(f));
    return { updatedFeatures: updated, explanation };
  } else {
    // DISABLING feature
    currentSet.delete(feature);
    let explanation: string | null = null;

    // Cascade disable dependents
    if (feature === "bankDetection") {
      // Disabling bankDetection must disable transactionExtraction, validation, excelExport
      const hadDependents =
        currentSet.has("transactionExtraction") ||
        currentSet.has("validation") ||
        currentSet.has("excelExport");
      currentSet.delete("transactionExtraction");
      currentSet.delete("validation");
      currentSet.delete("excelExport");
      if (hadDependents) {
        explanation = "Transaction Extraction dan fitur turunannya dinonaktifkan karena membutuhkan Bank Detection.";
      }
    } else if (feature === "transactionExtraction") {
      // Disabling transactionExtraction must disable validation and excelExport
      const hadDependents = currentSet.has("validation") || currentSet.has("excelExport");
      currentSet.delete("validation");
      currentSet.delete("excelExport");
      if (hadDependents) {
        explanation = "Balance Validation dan Excel Export dinonaktifkan karena membutuhkan Transaction Extraction.";
      }
    } else if (feature === "validation") {
      // Disabling validation must disable excelExport
      const hadDependents = currentSet.has("excelExport");
      currentSet.delete("excelExport");
      if (hadDependents) {
        explanation = "Excel Export dinonaktifkan karena membutuhkan Balance Validation.";
      }
    }

    const updated = ALL_ANALYSIS_FEATURES.filter((f) => currentSet.has(f));
    return { updatedFeatures: updated, explanation };
  }
}
