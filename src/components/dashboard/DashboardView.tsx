import React, { useState, useEffect } from "react";
import {
  FileText,
  Layers,
  AlertCircle,
  HardDrive,
  UploadCloud,
  ArrowRight,
  RefreshCw,
  Clock,
  Landmark,
  CheckCircle2,
  Trash2,
  FileSpreadsheet,
  ExternalLink,
  Calendar,
} from "lucide-react";
import { safeApiFetch } from "../../lib/api-client";
import { formatDate } from "../../lib/utils";
import type { UserProfile } from "../../context/AuthContext";

export interface DashboardStats {
  documentsAnalyzed: number;
  transactionsExtracted: number;
  needsReview: number;
  storageUsed: {
    bytes: number;
    formatted: string;
  };
}

export interface RecentDocItem {
  id: string;
  filename: string;
  bank: string;
  period: {
    start: string | null;
    end: string | null;
  } | null;
  transactionCount: number;
  status: string;
  createdDate: string;
  processingDuration: number | null;
  lastAccessedAt: string | null;
}

export interface BankDistributionItem {
  bank: string;
  count: number;
  percentage: number;
}

export interface DashboardApiResponse {
  success: boolean;
  data?: {
    stats: DashboardStats;
    recentDocuments: RecentDocItem[];
    bankDistribution: BankDistributionItem[];
  };
  error?: string;
}

interface DashboardViewProps {
  user: UserProfile;
  onNavigateAnalyze: () => void;
  onNavigateHistory: () => void;
  onOpenDocument: (documentId: string) => void;
}

export function DashboardView({
  user,
  onNavigateAnalyze,
  onNavigateHistory,
  onOpenDocument,
}: DashboardViewProps) {
  const [data, setData] = useState<{
    stats: DashboardStats;
    recentDocuments: RecentDocItem[];
    bankDistribution: BankDistributionItem[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [docToDelete, setDocToDelete] = useState<RecentDocItem | null>(null);

  const fetchDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await safeApiFetch<DashboardApiResponse>("/api/dashboard");
      if (res.ok && res.data?.success && res.data.data) {
        setData(res.data.data);
      } else {
        setError(res.data?.error || "Gagal memuat statistik dashboard.");
      }
    } catch {
      setError("Terjadi kesalahan jaringan saat memuat dashboard.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const handleConfirmDelete = async () => {
    if (!docToDelete) return;
    setDeletingId(docToDelete.id);
    try {
      const res = await safeApiFetch<{ success: boolean; error?: string }>(
        `/api/documents/${docToDelete.id}`,
        { method: "DELETE" }
      );
      if (res.ok && res.data?.success) {
        setDocToDelete(null);
        await fetchDashboard();
      } else {
        alert(res.data?.error || "Gagal menghapus dokumen.");
      }
    } catch {
      alert("Terjadi kesalahan saat menghapus dokumen.");
    } finally {
      setDeletingId(null);
    }
  };

  const formatPeriod = (period: RecentDocItem["period"]) => {
    if (!period || (!period.start && !period.end)) return "N/A";
    const startStr = period.start ? new Date(period.start).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "";
    const endStr = period.end ? new Date(period.end).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "";
    if (startStr && endStr) return `${startStr} — ${endStr}`;
    return startStr || endStr;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            Completed
          </span>
        );
      case "PROCESSING":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
            Processing
          </span>
        );
      case "FAILED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
            Failed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* HEADER BAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-md bg-blue-50 text-blue-700 text-xs font-semibold mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB]"></span>
            Financial Ledger &amp; Document Intelligence
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#0F172A]">
            Dashboard
          </h1>
          <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">
            Selamat datang, <span className="font-semibold text-slate-900">{user.name || user.email}</span>. Berikut ikhtisar analisis dokumen dan transaksi Anda.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          <button
            type="button"
            onClick={fetchDashboard}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-xs cursor-pointer disabled:opacity-50"
            title="Refresh data"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={onNavigateAnalyze}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Analyze New PDF</span>
          </button>
        </div>
      </div>

      {/* ERROR NOTICE */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={fetchDashboard}
            className="underline font-semibold hover:text-rose-900 cursor-pointer"
          >
            Coba lagi
          </button>
        </div>
      )}

      {/* STATISTIC CARDS (4 Cards Required) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Documents Analyzed */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-xs hover:border-blue-200 transition-all space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
              Documents Analyzed
            </span>
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-[#2563EB] border border-blue-100 flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#0F172A] tracking-tight">
              {loading ? "..." : (data?.stats.documentsAnalyzed ?? 0).toLocaleString()}
            </span>
            <span className="text-xs text-slate-500 font-medium">files</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-tight">
            Total active statements processed with SHA-256 verification.
          </p>
        </div>

        {/* Card 2: Transactions Extracted */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-xs hover:border-emerald-200 transition-all space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
              Transactions Extracted
            </span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#0F172A] tracking-tight">
              {loading ? "..." : (data?.stats.transactionsExtracted ?? 0).toLocaleString()}
            </span>
            <span className="text-xs text-slate-500 font-medium">entries</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-tight">
            Debits, credits, and normalized balance ledger records.
          </p>
        </div>

        {/* Card 3: Needs Review */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-xs hover:border-amber-200 transition-all space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
              Needs Review
            </span>
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center">
              <AlertCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#0F172A] tracking-tight">
              {loading ? "..." : (data?.stats.needsReview ?? 0).toLocaleString()}
            </span>
            <span className="text-xs text-slate-500 font-medium">items</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-tight">
            Discrepancies, unclassified rows, or unparsed fields.
          </p>
        </div>

        {/* Card 4: Storage Used */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-xs hover:border-indigo-200 transition-all space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
              Storage Used
            </span>
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center">
              <HardDrive className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#0F172A] tracking-tight">
              {loading ? "..." : data?.stats.storageUsed.formatted || "0 Bytes"}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 leading-tight">
            Encrypted PDF storage allocated to your account.
          </p>
        </div>
      </div>

      {/* BANK DISTRIBUTION BREAKDOWN */}
      {data && data.bankDistribution && data.bankDistribution.length > 0 && (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Landmark className="w-4 h-4 text-[#2563EB]" />
              <h3 className="text-sm font-bold text-[#0F172A]">Bank Distribution</h3>
            </div>
            <span className="text-xs text-slate-500 font-medium">
              {data.bankDistribution.length} bank detected
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {data.bankDistribution.map((item) => (
              <div
                key={item.bank}
                className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col justify-between space-y-1 hover:border-blue-200 transition-colors"
              >
                <div className="text-xs font-bold text-[#0F172A] truncate" title={item.bank}>
                  {item.bank}
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>{item.count} file{item.count > 1 ? "s" : ""}</span>
                  <span className="font-semibold text-blue-600">{item.percentage}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RECENT DOCUMENTS SECTION */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-xs overflow-hidden">
        <div className="p-5 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-[#0F172A] tracking-tight">
              Recent Documents
            </h2>
            <p className="text-xs text-[#64748B] mt-0.5">
              5 dokumen bank statement terakhir yang telah Anda proses.
            </p>
          </div>

          <button
            type="button"
            onClick={onNavigateHistory}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2563EB] hover:text-[#1D4ED8] cursor-pointer group self-start sm:self-auto"
          >
            <span>View Full Document History</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
            <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
            <span>Memuat dokumen terbaru...</span>
          </div>
        ) : !data || data.recentDocuments.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <FileText className="w-10 h-10 text-slate-300 mx-auto" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">Belum ada dokumen yang dianalisis</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Unggah rekening koran bank pertama Anda untuk mengekstrak transaksi dan melihat statistik visual.
              </p>
            </div>
            <button
              type="button"
              onClick={onNavigateAnalyze}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs cursor-pointer transition-colors"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>Unggah PDF Sekarang</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/75 border-b border-slate-200/80 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4 sm:px-6">Filename</th>
                  <th className="py-3 px-4">Bank</th>
                  <th className="py-3 px-4">Period</th>
                  <th className="py-3 px-4 text-center">Transactions</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Created Date</th>
                  <th className="py-3 px-4 sm:px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recentDocuments.map((doc) => (
                  <tr
                    key={doc.id}
                    className="hover:bg-slate-50/60 transition-colors group"
                  >
                    <td className="py-3.5 px-4 sm:px-6">
                      <div className="flex items-center gap-2.5 max-w-xs sm:max-w-sm">
                        <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0">
                          <FileText className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate" title={doc.filename}>
                            {doc.filename}
                          </p>
                          {doc.processingDuration && (
                            <span className="text-[10px] text-slate-400 font-mono">
                              {(doc.processingDuration / 1000).toFixed(1)}s processing
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                        <Landmark className="w-3.5 h-3.5 text-slate-400" />
                        {doc.bank}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-slate-600 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-[11px]">
                        <Calendar className="w-3 h-3 text-slate-400" />
                        {formatPeriod(doc.period)}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-800">
                        {doc.transactionCount}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {getStatusBadge(doc.status)}
                    </td>

                    <td className="py-3.5 px-4 text-slate-500 whitespace-nowrap">
                      <span className="text-[11px]">{formatDate(doc.createdDate)}</span>
                    </td>

                    <td className="py-3.5 px-4 sm:px-6 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenDocument(doc.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-600 hover:text-white bg-blue-50 hover:bg-blue-600 rounded-lg transition-colors cursor-pointer"
                          title="Buka hasil analisis"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>Open</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDocToDelete(doc)}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="Hapus dokumen"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* DELETE CONFIRMATION MODAL */}
      {docToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 border border-rose-100 flex items-center justify-center">
              <Trash2 className="w-5 h-5" />
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-900">
                Hapus Dokumen?
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Apakah Anda yakin ingin menghapus dokumen <strong className="text-slate-900">{docToDelete.filename}</strong>? Dokumen tidak akan lagi ditampilkan pada ledger dan riwayat Anda.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDocToDelete(null)}
                disabled={Boolean(deletingId)}
                className="px-3.5 py-1.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={Boolean(deletingId)}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                {deletingId ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Menghapus...</span>
                  </>
                ) : (
                  <span>Ya, Hapus Dokumen</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
