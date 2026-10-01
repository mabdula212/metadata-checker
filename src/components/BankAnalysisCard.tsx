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
  const [showEvidence, setShowEvidence] = useState(true);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  if (isLoading) {
    return (
      <div
        id="bank-analysis-loading"
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 animate-spin items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Landmark className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Analyzing Document Structure & Bank Signals...
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Evaluating rule-based Indonesian bank models, statement periods, and masked account identifiers.
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
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 border border-blue-200/70">
            <Landmark className="h-3.5 w-3.5" />
            Bank Statement
          </span>
        );
      case "OTHER_PDF":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 border border-slate-200">
            <Layers className="h-3.5 w-3.5" />
            Other PDF
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 border border-amber-200">
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
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
            <ShieldCheck className="h-3.5 w-3.5" />
            High Confidence
          </span>
        );
      case "MEDIUM":
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 border border-amber-200">
            <ShieldCheck className="h-3.5 w-3.5" />
            Medium Confidence
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 border border-slate-200">
            <FileQuestion className="h-3.5 w-3.5" />
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
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs"
    >
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700 border border-blue-100">
            <Landmark className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900 tracking-tight">
                Bank Detection
              </h3>
              {getDocTypeBadge()}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Identify the Indonesian bank and statement information.
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
            <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-900">
              Scanned / Image-Only Document
            </h4>
            <p className="mt-0.5 text-xs text-amber-800 leading-relaxed">
              {detection.warning ||
                "This PDF appears to contain scanned images rather than selectable text. Text extraction has been protected to ensure data fidelity."}
            </p>
          </div>
        </div>
      )}

      {/* Core Entity Grid: Bank, Confidence, Account, Account Holder, Period */}
      <div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
        {/* Bank */}
        <div className="p-5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            <Landmark className="h-3.5 w-3.5 text-slate-400" />
            <span>Bank</span>
          </div>
          <div className="mt-2">
            {detection.bankName ? (
              <div>
                <p className="text-sm sm:text-base font-bold text-slate-900">
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
                <p className="text-xs font-medium text-slate-500 italic">
                  Not detected
                </p>
                {detection.notDetectedReason && (
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {detection.notDetectedReason}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Statement Period */}
        <div className="p-5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            <Calendar className="h-3.5 w-3.5 text-slate-400" />
            <span>Statement Period</span>
          </div>
          <div className="mt-2">
            {detection.statementPeriodStart || detection.statementPeriodEnd ? (
              <div>
                <p className="text-xs sm:text-sm font-semibold text-slate-900">
                  {formatDate(detection.statementPeriodStart) || "Start Unknown"}{" "}
                  <span className="text-slate-400 font-normal">to</span>{" "}
                  {formatDate(detection.statementPeriodEnd) || "End Unknown"}
                </p>
                <span className="mt-0.5 inline-block text-[11px] font-mono text-slate-500">
                  {detection.statementPeriodStart || "—"} / {detection.statementPeriodEnd || "—"}
                </span>
              </div>
            ) : (
              <p className="text-xs font-medium text-slate-500 italic">
                Not detected
              </p>
            )}
          </div>
        </div>

        {/* Account Number (Masked) */}
        <div className="p-5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            <CreditCard className="h-3.5 w-3.5 text-slate-400" />
            <span>Account (Masked)</span>
          </div>
          <div className="mt-2">
            {detection.accountNumberMasked ? (
              <div>
                <p className="text-sm sm:text-base font-mono font-bold tracking-wider text-slate-900">
                  {detection.accountNumberMasked}
                </p>
                <span className="text-[11px] text-emerald-600 font-medium">
                  Masked for Privacy
                </span>
              </div>
            ) : (
              <p className="text-xs font-medium text-slate-500 italic">
                Not detected
              </p>
            )}
          </div>
        </div>

        {/* Account Holder */}
        <div className="p-5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            <User className="h-3.5 w-3.5 text-slate-400" />
            <span>Account Holder</span>
          </div>
          <div className="mt-2">
            {detection.accountHolderName ? (
              <p className="text-xs sm:text-sm font-semibold text-slate-900 uppercase">
                {detection.accountHolderName}
              </p>
            ) : (
              <p className="text-xs font-medium text-slate-500 italic">
                Not detected
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Detection Evidence Section */}
      <div className="border-t border-slate-100 bg-slate-50/50 p-5">
        <button
          type="button"
          onClick={() => setShowEvidence(!showEvidence)}
          className="flex w-full items-center justify-between text-left cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-semibold tracking-wider text-slate-700 uppercase">
              Detection Evidence ({detection.matchedSignals.length} signals)
            </h4>
          </div>
          <span className="text-xs font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1">
            {showEvidence ? "Hide evidence" : "Show evidence"}
            {showEvidence ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </span>
        </button>

        {showEvidence && (
          <div className="mt-3 pt-3 border-t border-slate-200/60">
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
                No specific bank signals identified in this document.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Technical Breakdown Details Toggle */}
      {detection.advancedDetails && (
        <div className="border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
            className="flex w-full items-center justify-between text-xs font-medium text-slate-500 hover:text-slate-800 cursor-pointer"
          >
            <span>Candidate Bank Scores & Analysis Invariants</span>
            {showTechnicalDetails ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>

          {showTechnicalDetails && (
            <div className="mt-3 space-y-3 pt-3 border-t border-slate-100">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {detection.advancedDetails.allCandidates.map((cand) => (
                  <div
                    key={cand.bankCode}
                    className={`rounded-xl border p-2.5 text-xs ${
                      cand.bankCode === detection.bankCode
                        ? "border-blue-300 bg-blue-50/50"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">
                        {cand.bankCode}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.2 text-[10px] font-mono font-semibold ${
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
                    <p className="truncate text-[11px] text-slate-500 mt-1">
                      {cand.bankName}
                    </p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-4 text-xs text-slate-500 pt-2 border-t border-slate-100">
                <div>
                  <span>Total Pages:</span>{" "}
                  <span className="font-mono font-semibold text-slate-900">
                    {detection.advancedDetails.totalPages}
                  </span>
                </div>
                <div>
                  <span>Characters Analyzed:</span>{" "}
                  <span className="font-mono font-semibold text-slate-900">
                    {detection.advancedDetails.totalCharacterCount.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
