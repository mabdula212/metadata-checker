import React, { useState } from "react";
import {
  Landmark,
  ShieldCheck,
  Calendar,
  CreditCard,
  User,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  FileQuestion,
  Layers,
  HelpCircle,
} from "lucide-react";
import type { BankDetectionResultUi } from "../types/metadata";

interface BankAnalysisCardProps {
  detection: BankDetectionResultUi | null;
  isLoading?: boolean;
}

export const BankAnalysisCard: React.FC<BankAnalysisCardProps> = ({
  detection,
  isLoading = false,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  if (isLoading) {
    return (
      <div
        id="bank-analysis-loading"
        className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 animate-spin items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <Landmark className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Analyzing Document Structure & Bank Signals...
            </h3>
            <p className="text-xs text-slate-500">
              Evaluating rule-based Indonesian bank models, statement periods, and account markers
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!detection) {
    return null;
  }

  const getDocTypeBadge = () => {
    switch (detection.documentType) {
      case "BANK_STATEMENT":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200/70 ring-inset">
            <Landmark className="h-3.5 w-3.5" />
            Bank Statement
          </span>
        );
      case "OTHER_PDF":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 ring-inset">
            <Layers className="h-3.5 w-3.5" />
            Other PDF
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 ring-inset">
            <HelpCircle className="h-3.5 w-3.5" />
            Unknown Classification
          </span>
        );
    }
  };

  const getConfidenceBadge = () => {
    switch (detection.confidence) {
      case "HIGH":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 ring-inset">
            <ShieldCheck className="h-3 w-3" />
            High Confidence
          </span>
        );
      case "MEDIUM":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200 ring-inset">
            <ShieldCheck className="h-3 w-3" />
            Medium Confidence
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 ring-inset">
            <FileQuestion className="h-3 w-3" />
            Low Confidence
          </span>
        );
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return null;
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("id-ID", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  };

  return (
    <div
      id="bank-analysis-card"
      className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xs"
    >
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs">
            <Landmark className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold tracking-wider text-slate-900 uppercase">
                Document Analysis
              </h3>
              {getDocTypeBadge()}
            </div>
            <p className="text-xs text-slate-500">
              Rule-based Indonesian bank statement detection and entity identification
            </p>
          </div>
        </div>
        <div>{getConfidenceBadge()}</div>
      </div>

      {/* Scanned PDF warning if applicable */}
      {detection.isScannedOrImageOnly && (
        <div
          id="scanned-pdf-warning-banner"
          className="flex items-start gap-3 border-b border-amber-200 bg-amber-50/90 px-6 py-3.5 text-amber-900"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-800">
              Scanned / Image-Only Document
            </h4>
            <p className="mt-0.5 text-xs text-amber-800/90 leading-relaxed">
              {detection.warning ||
                "This PDF appears to contain scanned images rather than selectable text. Transaction extraction may require OCR."}
            </p>
          </div>
        </div>
      )}

      {/* Core Entity Grid */}
      <div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
        {/* Detected Bank */}
        <div className="p-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <Landmark className="h-3.5 w-3.5 text-slate-400" />
            <span>BANK INSTITUTION</span>
          </div>
          <div className="mt-1.5">
            {detection.bankName ? (
              <div>
                <p className="text-base font-bold text-slate-900">
                  {detection.bankName}
                </p>
                {detection.bankCode && (
                  <span className="mt-0.5 inline-block text-xs font-mono font-medium text-slate-500">
                    Code: {detection.bankCode}
                  </span>
                )}
              </div>
            ) : (
              <div>
                <p className="text-sm font-medium text-slate-500 italic">
                  Not detected
                </p>
                {detection.notDetectedReason && (
                  <p className="mt-0.5 text-xs text-slate-400">
                    {detection.notDetectedReason}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Statement Period */}
        <div className="p-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <Calendar className="h-3.5 w-3.5 text-slate-400" />
            <span>STATEMENT PERIOD</span>
          </div>
          <div className="mt-1.5">
            {detection.statementPeriodStart || detection.statementPeriodEnd ? (
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {formatDate(detection.statementPeriodStart) || "Start Unknown"}{" "}
                  <span className="text-slate-400 font-normal">to</span>{" "}
                  {formatDate(detection.statementPeriodEnd) || "End Unknown"}
                </p>
                <span className="mt-0.5 inline-block text-xs font-mono text-slate-500">
                  {detection.statementPeriodStart || "—"} / {detection.statementPeriodEnd || "—"}
                </span>
              </div>
            ) : (
              <p className="text-sm font-medium text-slate-500 italic">
                Not detected
              </p>
            )}
          </div>
        </div>

        {/* Account Number */}
        <div className="p-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <CreditCard className="h-3.5 w-3.5 text-slate-400" />
            <span>ACCOUNT NUMBER (MASKED)</span>
          </div>
          <div className="mt-1.5">
            {detection.accountNumberMasked ? (
              <div>
                <p className="text-base font-mono font-bold tracking-wider text-slate-900">
                  {detection.accountNumberMasked}
                </p>
                <span className="text-xs text-emerald-600 font-medium">
                  Verified Masked
                </span>
              </div>
            ) : (
              <p className="text-sm font-medium text-slate-500 italic">
                Not detected
              </p>
            )}
          </div>
        </div>

        {/* Account Holder */}
        <div className="p-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <User className="h-3.5 w-3.5 text-slate-400" />
            <span>ACCOUNT HOLDER</span>
          </div>
          <div className="mt-1.5">
            {detection.accountHolderName ? (
              <p className="text-sm font-semibold text-slate-900 uppercase">
                {detection.accountHolderName}
              </p>
            ) : (
              <p className="text-sm font-medium text-slate-500 italic">
                Not detected
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Detected Evidence Section */}
      <div className="border-t border-slate-100 bg-slate-50/40 p-5">
        <div className="mb-2.5 flex items-center justify-between">
          <h4 className="text-xs font-semibold tracking-wider text-slate-700 uppercase">
            Detection Evidence ({detection.matchedSignals.length} matched signals)
          </h4>
        </div>

        {detection.matchedSignals.length > 0 ? (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {detection.matchedSignals.map((signal, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2 text-xs text-slate-700"
              >
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <span>{signal}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500 italic">
            No specific bank or statement signals identified in this document.
          </p>
        )}
      </div>

      {/* Advanced Details Toggle */}
      <div className="border-t border-slate-100 px-5 py-3">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex w-full items-center justify-between text-xs font-medium text-slate-600 hover:text-slate-900 focus:outline-hidden"
        >
          <span className="flex items-center gap-1.5">
            <span>Advanced Technical Details & Bank Scores</span>
            {showAdvanced ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </span>
          <span className="text-slate-400">
            {showAdvanced ? "Hide details" : "Show technical breakdown"}
          </span>
        </button>

        {showAdvanced && detection.advancedDetails && (
          <div className="mt-4 space-y-4 pt-3 border-t border-slate-100">
            {/* Candidate Bank Scores */}
            <div>
              <h5 className="text-xs font-bold uppercase text-slate-700 mb-2">
                Evaluated Bank Candidate Scores
              </h5>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {detection.advancedDetails.allCandidates.map((cand) => (
                  <div
                    key={cand.bankCode}
                    className={`rounded-lg border p-2.5 text-xs ${
                      cand.bankCode === detection.bankCode
                        ? "border-indigo-300 bg-indigo-50/50"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-800">
                        {cand.bankCode}
                      </span>
                      <span
                        className={`rounded-sm px-1.5 py-0.2 text-[10px] font-mono font-bold ${
                          cand.score >= 60
                            ? "bg-emerald-100 text-emerald-800"
                            : cand.score >= 35
                            ? "bg-amber-100 text-amber-800"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {cand.score} pts
                      </span>
                    </div>
                    <p className="truncate text-[11px] text-slate-500 mt-0.5">
                      {cand.bankName}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Document stats */}
            <div className="flex flex-wrap gap-4 text-xs text-slate-600">
              <div>
                <span className="font-medium text-slate-500">Total Pages:</span>{" "}
                <span className="font-mono font-semibold text-slate-800">
                  {detection.advancedDetails.totalPages}
                </span>
              </div>
              <div>
                <span className="font-medium text-slate-500">Character Count:</span>{" "}
                <span className="font-mono font-semibold text-slate-800">
                  {detection.advancedDetails.totalCharacterCount.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
