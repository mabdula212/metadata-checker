import React from "react";
import {
  FileText,
  Landmark,
  Layers,
  ShieldCheck,
  FileSpreadsheet,
  Lock,
  Database,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  UploadCloud,
  Code2,
} from "lucide-react";
import { Logo } from "./ui/Logo";

export interface AboutPageProps {
  isAuthenticated: boolean;
  onNavigateHome: () => void;
  onNavigateAnalyze?: () => void;
}

export const AboutPage: React.FC<AboutPageProps> = ({
  isAuthenticated,
  onNavigateHome,
  onNavigateAnalyze,
}) => {
  const capabilities = [
    {
      title: "PDF Metadata Analysis",
      description:
        "Inspect document properties, creation and modification timestamps, PDF producer attributes, and SHA-256 file fingerprints.",
      icon: FileText,
    },
    {
      title: "Bank Detection",
      description:
        "Automatically recognize major Indonesian banking statement formats, statement date ranges, currency, and masked account identifiers.",
      icon: Landmark,
    },
    {
      title: "Transaction Extraction",
      description:
        "Extract structured transaction dates, descriptions, debit and credit mutations, and running balances from digital PDF statements.",
      icon: Layers,
    },
    {
      title: "Balance Validation",
      description:
        "Reconcile opening balances, net transaction mutations, and closing balances to verify row-by-row mathematical continuity.",
      icon: ShieldCheck,
    },
    {
      title: "Excel Export",
      description:
        "Export validated statement data into structured multi-sheet Excel (.xlsx) workbooks ready for financial review and accounting workflows.",
      icon: FileSpreadsheet,
    },
    {
      title: "Password-Protected PDF Support",
      description:
        "Unlock encrypted PDF bank statements in memory during analysis without storing document passwords.",
      icon: Lock,
    },
  ];

  const workflowSteps = [
    {
      step: "01",
      title: "Upload Document",
      description: "Select a PDF bank statement up to 20 MB with format and signature verification.",
      icon: UploadCloud,
    },
    {
      step: "02",
      title: "Choose Analysis",
      description: "Select metadata inspection, bank detection, transaction extraction, or full validation.",
      icon: Layers,
    },
    {
      step: "03",
      title: "Review & Validate",
      description: "Inspect extracted metadata, parsed transactions, and balance reconciliation results.",
      icon: CheckCircle2,
    },
    {
      step: "04",
      title: "Export Structured Data",
      description: "Download a clean Excel workbook containing summary, transactions, and metadata sheets.",
      icon: FileSpreadsheet,
    },
  ];

  return (
    <div className="space-y-12 animate-in fade-in duration-200">
      {/* Top Breadcrumb / Back Navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onNavigateHome}
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{isAuthenticated ? "Back to Dashboard" : "Back to Sign In"}</span>
        </button>

        <span className="text-xs text-slate-400">
          Metadata Checker · Platform Overview
        </span>
      </div>

      {/* 1. HERO SECTION */}
      <section className="bg-white border border-[#E2E8F0] rounded-2xl p-8 sm:p-12 shadow-xs text-center space-y-4">
        <div className="flex justify-center">
          <Logo variant="full" size="md" />
        </div>

        <div className="space-y-2 max-w-2xl mx-auto pt-1">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-[#0F172A]">
            About Metadata Checker
          </h1>
          <p className="text-sm sm:text-base font-semibold text-[#2563EB] tracking-tight">
            Intelligent PDF &amp; Financial Document Analysis
          </p>
        </div>

        <p className="text-xs sm:text-sm text-slate-600 max-w-2xl mx-auto leading-relaxed">
          Metadata Checker is designed to simplify the process of analyzing financial documents,
          extracting useful information, validating transaction data, and exporting structured results.
        </p>

        <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
          {isAuthenticated && onNavigateAnalyze ? (
            <button
              type="button"
              onClick={onNavigateAnalyze}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <span>Analyze PDF Document</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onNavigateHome}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <span>Access Workspace</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </section>

      {/* 2. CORE CAPABILITIES */}
      <section className="space-y-6">
        <div className="max-w-xl space-y-1">
          <span className="text-xs font-semibold text-blue-600 block">
            Platform Capabilities
          </span>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            What Metadata Checker Does
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Purpose-built tools for inspecting PDF structure and turning financial statements into structured data.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {capabilities.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.title}
                className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-3 hover:border-slate-300 transition-colors"
              >
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Icon className="w-4 h-4" aria-hidden="true" />
                </div>
                <h3 className="text-sm font-bold text-slate-900 tracking-tight">
                  {item.title}
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {item.description}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. HOW IT WORKS */}
      <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-xs space-y-6">
        <div className="max-w-xl space-y-1">
          <span className="text-xs font-semibold text-blue-600 block">
            Structured Workflow
          </span>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
            How the Analysis Pipeline Works
          </h2>
          <p className="text-xs text-slate-500">
            Every uploaded PDF statement is processed through a clear, deterministic sequence.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {workflowSteps.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.step}
                className="p-4 rounded-xl border border-slate-200/80 bg-slate-50/60 space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-blue-600">
                    {item.step}
                  </span>
                  <Icon className="w-4 h-4 text-slate-400" aria-hidden="true" />
                </div>
                <h3 className="text-sm font-bold text-slate-900 tracking-tight">
                  {item.title}
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {item.description}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* 4. SECURITY & DATA HANDLING */}
      <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-xs space-y-6">
        <div className="max-w-xl space-y-1">
          <span className="text-xs font-semibold text-blue-600 block">
            Data Handling &amp; Security
          </span>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
            Built for Responsible Document Processing
          </h2>
          <p className="text-xs text-slate-500">
            Factual safeguards applied to uploaded financial documents and user accounts.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4 text-blue-600" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h3 className="text-xs font-bold text-slate-900">
                Secure Processing
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                PDF passwords provided for encrypted bank statements are processed in memory only during analysis and are never stored.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
              <Database className="w-4 h-4 text-blue-600" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h3 className="text-xs font-bold text-slate-900">
                Private Document Storage
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Uploaded documents and generated exports are scoped to the authenticated account owner with strict ownership validation.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4 text-blue-600" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h3 className="text-xs font-bold text-slate-900">
                Protected Account Data
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Account access is protected with bcrypt password hashing, SHA-256 session token hashing, and administrator account approval.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. CREATOR SECTION */}
      <section
        aria-label="Creator information"
        className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-10 shadow-xs"
      >
        <div className="max-w-xl mx-auto text-center space-y-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center mx-auto">
            <Code2 className="w-5 h-5 text-blue-600" aria-hidden="true" />
          </div>

          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-500 block">
              Created &amp; Developed by
            </span>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              Aziz
            </h2>
          </div>

          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-md mx-auto">
            &ldquo;Building practical software solutions that simplify complex workflows.&rdquo;
          </p>

          <div className="pt-2">
            <span className="text-[11px] text-slate-400">
              Designed &amp; Developed by Aziz · Metadata Checker
            </span>
          </div>
        </div>
      </section>
    </div>
  );
};
