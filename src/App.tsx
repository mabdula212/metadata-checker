import React, { useState, useRef, useCallback } from "react";
import { formatBytes } from "./lib/utils";
import {
  FileText,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  X,
  ArrowRight,
  Shield,
  Layers,
  Search,
  FileSpreadsheet,
  Clock,
} from "lucide-react";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

interface ValidatedFile {
  name: string;
  size: number;
  type: string;
  lastModified: number;
}

export default function App() {
  const [selectedFile, setSelectedFile] = useState<ValidatedFile | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = useCallback((file: File): boolean => {
    setErrorMessage(null);

    // 1. File Type Validation (PDF only)
    const isPdfMime = file.type === "application/pdf" || file.type === "";
    const hasPdfExtension = file.name.toLowerCase().endsWith(".pdf");

    if (!isPdfMime || !hasPdfExtension) {
      setErrorMessage(
        `Invalid file format: "${file.name}". Only PDF files (.pdf) are permitted.`
      );
      setSelectedFile(null);
      return false;
    }

    // 2. Empty File Check
    if (file.size === 0) {
      setErrorMessage("The selected file is empty (0 bytes). Please choose a valid PDF file.");
      setSelectedFile(null);
      return false;
    }

    // 3. Maximum Size Check (20 MB)
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setErrorMessage(
        `File size exceeds 20 MB limit: "${file.name}" is ${formatBytes(file.size)}. Please upload a file under 20 MB.`
      );
      setSelectedFile(null);
      return false;
    }

    // Validated successfully
    setSelectedFile({
      name: file.name,
      size: file.size,
      type: file.type || "application/pdf",
      lastModified: file.lastModified,
    });
    return true;
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateFile(e.target.files[0]);
    }
  };

  const handleClearFile = () => {
    setSelectedFile(null);
    setErrorMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const workflowSteps = [
    {
      id: "upload",
      number: "01",
      name: "UPLOAD PDF",
      status: "CURRENT",
      description: "Select & validate PDF statement",
      icon: UploadCloud,
    },
    {
      id: "analyze",
      number: "02",
      name: "ANALYZE",
      status: "UPCOMING",
      description: "Extract metadata & statements",
      icon: Search,
    },
    {
      id: "review",
      number: "03",
      name: "REVIEW",
      status: "UPCOMING",
      description: "Verify transactions & balances",
      icon: Layers,
    },
    {
      id: "export",
      number: "04",
      name: "EXPORT",
      status: "UPCOMING",
      description: "Download structured report",
      icon: FileSpreadsheet,
    },
  ];

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col font-sans antialiased">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-neutral-900 flex items-center justify-center text-white shadow-xs">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-neutral-950">
                  Metadata Checker
                </span>
                <span className="text-[11px] font-medium bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded border border-neutral-200">
                  Foundation
                </span>
              </div>
              <p className="text-[11px] text-neutral-500 hidden sm:block">
                PDF Metadata &amp; Bank Statement Analyzer
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-neutral-500 font-medium">
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-neutral-100 border border-neutral-200/80">
              <Shield className="w-3.5 h-3.5 text-neutral-600" />
              <span>Client Validation Active</span>
            </span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8">
        {/* Title & Short Explanation */}
        <section className="text-center max-w-2xl mx-auto space-y-2">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-neutral-950">
            PDF Metadata &amp; Bank Statement Analyzer
          </h1>
          <p className="text-sm text-neutral-600 leading-relaxed">
            Upload a PDF bank statement to inspect metadata and analyze transactions.
          </p>
        </section>

        {/* Primary Workflow Stepper */}
        <section className="bg-white border border-neutral-200 rounded-xl p-4 sm:p-5 shadow-xs">
          <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-3 text-center sm:text-left">
            Primary Processing Workflow
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {workflowSteps.map((step, idx) => {
              const Icon = step.icon;
              const isCurrent = step.status === "CURRENT";
              return (
                <div
                  key={step.id}
                  className={`p-3.5 rounded-lg border transition-all ${
                    isCurrent
                      ? "bg-neutral-900 text-white border-neutral-900 shadow-xs"
                      : "bg-neutral-50/60 text-neutral-600 border-neutral-200/70"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold ${
                        isCurrent ? "bg-neutral-800 text-neutral-200" : "bg-neutral-200 text-neutral-700"
                      }`}
                    >
                      {step.number}
                    </span>
                    <Icon
                      className={`w-4 h-4 ${isCurrent ? "text-neutral-200" : "text-neutral-400"}`}
                    />
                  </div>
                  <div className="font-bold text-xs tracking-tight flex items-center gap-1.5">
                    <span>{step.name}</span>
                    {idx < workflowSteps.length - 1 && (
                      <span className="text-[10px] opacity-40 ml-auto hidden lg:inline">→</span>
                    )}
                  </div>
                  <p
                    className={`text-[11px] mt-1 line-clamp-1 ${
                      isCurrent ? "text-neutral-300" : "text-neutral-500"
                    }`}
                  >
                    {step.description}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Main Upload Area */}
        <section className="space-y-4">
          <div className="bg-white border border-neutral-200 rounded-2xl p-6 sm:p-8 shadow-xs">
            {/* Error Notification */}
            {errorMessage && (
              <div
                role="alert"
                className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-3 text-xs sm:text-sm animate-in fade-in duration-200"
              >
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5 flex-1">
                  <div className="font-semibold text-rose-900">Validation Error</div>
                  <div>{errorMessage}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setErrorMessage(null)}
                  className="text-rose-500 hover:text-rose-700 p-0.5 cursor-pointer"
                  aria-label="Dismiss error"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Drag and Drop Zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-xl p-8 sm:p-12 text-center cursor-pointer transition-all duration-150 ${
                isDragging
                  ? "border-neutral-900 bg-neutral-100/80 scale-[0.99]"
                  : selectedFile
                  ? "border-emerald-500 bg-emerald-50/20"
                  : "border-neutral-300 hover:border-neutral-400 bg-neutral-50/50"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={handleFileChange}
                className="hidden"
                id="pdf-file-upload-input"
              />

              <div className="flex flex-col items-center justify-center space-y-4 max-w-md mx-auto">
                <div
                  className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${
                    selectedFile
                      ? "bg-emerald-100 text-emerald-700"
                      : isDragging
                      ? "bg-neutral-900 text-white"
                      : "bg-neutral-100 text-neutral-700"
                  }`}
                >
                  {selectedFile ? (
                    <CheckCircle2 className="w-7 h-7" />
                  ) : (
                    <UploadCloud className="w-7 h-7" />
                  )}
                </div>

                <div className="space-y-1.5">
                  <h3 className="text-base sm:text-lg font-semibold text-neutral-900">
                    {selectedFile
                      ? "PDF Document Selected"
                      : isDragging
                      ? "Drop your PDF file here"
                      : "Upload your PDF bank statement"}
                  </h3>
                  <p className="text-xs sm:text-sm text-neutral-500">
                    Drag and drop your file here, or click to browse from your device
                  </p>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    className="inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-neutral-900 text-white text-xs sm:text-sm font-medium hover:bg-neutral-800 transition-colors shadow-xs cursor-pointer"
                  >
                    <UploadCloud className="w-4 h-4 mr-2" />
                    {selectedFile ? "Change PDF File" : "Select PDF Document"}
                  </button>
                </div>

                <div className="pt-2 text-[11px] text-neutral-400 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                  <span>Allowed format: PDF only</span>
                  <span>•</span>
                  <span>Max file size: 20 MB</span>
                </div>
              </div>
            </div>

            {/* Selected File Card Details */}
            {selectedFile && (
              <div className="mt-6 p-4 sm:p-5 rounded-xl border border-neutral-200 bg-neutral-50/70 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-neutral-900 truncate">
                        {selectedFile.name}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {formatBytes(selectedFile.size)} • {selectedFile.type}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Valid PDF (&le; 20 MB)
                    </span>
                    <button
                      type="button"
                      onClick={handleClearFile}
                      className="text-xs text-neutral-500 hover:text-rose-600 px-2.5 py-1 rounded-md hover:bg-neutral-200/60 transition-colors cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div className="pt-3 border-t border-neutral-200/80 text-xs text-neutral-600 flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                  <p className="leading-relaxed">
                    <strong>Validation passed:</strong> This file meets all format and size constraints. Document metadata extraction and bank statement transaction analysis will be executed in the next project stage.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Recent Files Section Placeholder */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold tracking-tight text-neutral-900 uppercase">
              Recent Files
            </h2>
            <span className="text-xs text-neutral-400">Foundation Stage Placeholder</span>
          </div>

          <div className="bg-white border border-neutral-200 rounded-xl p-8 sm:p-10 text-center shadow-xs">
            <div className="w-12 h-12 rounded-full bg-neutral-100 text-neutral-400 flex items-center justify-center mx-auto mb-3">
              <Clock className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-neutral-900">No recent files</h3>
            <p className="text-xs text-neutral-500 mt-1 max-w-sm mx-auto leading-relaxed">
              Uploaded PDF bank statements will appear in this ledger once document processing and transaction storage are enabled in subsequent phases.
            </p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-200 bg-white py-6 mt-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-neutral-500">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-neutral-800">Metadata Checker</span>
            <span>—</span>
            <span>PDF Metadata &amp; Bank Statement Analyzer</span>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-neutral-400">
            <span>Stage 1: Foundation</span>
            <span>•</span>
            <span>Client Validation Only</span>
            <span>•</span>
            <span>No External Services</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
