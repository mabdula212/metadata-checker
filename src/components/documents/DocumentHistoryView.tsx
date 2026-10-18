import React, { useState, useEffect, useCallback } from "react";
import {
  Search,
  Filter,
  Calendar,
  Landmark,
  FileText,
  Trash2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  X,
  AlertCircle,
  FileSpreadsheet,
  Clock,
  ArrowUpDown,
} from "lucide-react";
import { safeApiFetch } from "../../lib/api-client";
import { formatDate, formatBytes } from "../../lib/utils";

export interface HistoryDocumentItem {
  id: string;
  originalFileName: string;
  fileSize: number;
  mimeType: string;
  status: string;
  documentType: string;
  processingDuration: number | null;
  lastAccessedAt: string | null;
  analysisVersion: string | null;
  createdAt: string;
  updatedAt: string;
  bankName: string | null;
  accountNumberMasked: string | null;
  accountHolderName: string | null;
  statementPeriodStart: string | null;
  statementPeriodEnd: string | null;
  transactionCount: number;
  totalCredit: number | null;
  totalDebit: number | null;
  hasExport: boolean;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface DocumentHistoryApiResponse {
  success: boolean;
  data?: HistoryDocumentItem[];
  pagination?: PaginationMeta;
  error?: string;
}

interface DocumentHistoryViewProps {
  onOpenDocument: (documentId: string) => void;
  onNavigateAnalyze: () => void;
}

const INDONESIAN_BANKS = [
  "BCA",
  "Bank Mandiri",
  "BNI",
  "BRI",
  "BSI",
  "BTN",
  "CIMB Niaga",
  "Bank Permata",
  "Bank Danamon",
  "Bank Mega",
  "OCBC NISP",
  "Maybank",
];

export function DocumentHistoryView({
  onOpenDocument,
  onNavigateAnalyze,
}: DocumentHistoryViewProps) {
  // Filter states
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [bank, setBank] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [sortBy, setSortBy] = useState<"createdAt" | "originalFileName" | "fileSize">("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Data states
  const [documents, setDocuments] = useState<HistoryDocumentItem[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({
    total: 0,
    page: 1,
    limit: 10,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Deletion state
  const [docToDelete, setDocToDelete] = useState<HistoryDocumentItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch document history
  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch.trim()) params.append("search", debouncedSearch.trim());
      if (bank && bank !== "ALL") params.append("bank", bank);
      if (status && status !== "ALL") params.append("status", status);
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      params.append("page", page.toString());
      params.append("limit", limit.toString());
      params.append("sortBy", sortBy);
      params.append("sortOrder", sortOrder);

      const res = await safeApiFetch<DocumentHistoryApiResponse>(`/api/documents?${params.toString()}`);
      if (res.ok && res.data?.success && res.data.data) {
        setDocuments(res.data.data);
        if (res.data.pagination) {
          setPagination(res.data.pagination);
        }
      } else {
        setError(res.data?.error || "Gagal memuat riwayat dokumen.");
      }
    } catch {
      setError("Terjadi kesalahan jaringan saat memuat riwayat dokumen.");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, bank, status, startDate, endDate, page, limit, sortBy, sortOrder]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleResetFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setBank("ALL");
    setStatus("ALL");
    setStartDate("");
    setEndDate("");
    setPage(1);
  };

  const hasActiveFilters = Boolean(
    debouncedSearch.trim() || bank !== "ALL" || status !== "ALL" || startDate || endDate
  );

  const handleDeleteDocument = async () => {
    if (!docToDelete) return;
    setIsDeleting(true);
    try {
      const res = await safeApiFetch<{ success: boolean; error?: string }>(
        `/api/documents/${docToDelete.id}`,
        { method: "DELETE" }
      );
      if (res.ok && res.data?.success) {
        setDocToDelete(null);
        await fetchHistory();
      } else {
        alert(res.data?.error || "Gagal menghapus dokumen.");
      }
    } catch {
      alert("Terjadi kesalahan saat menghapus dokumen.");
    } finally {
      setIsDeleting(false);
    }
  };

  const getStatusBadge = (docStatus: string) => {
    switch (docStatus) {
      case "COMPLETED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            Completed
          </span>
        );
      case "PROCESSING":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
            Processing
          </span>
        );
      case "FAILED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
            Failed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
            {docStatus}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#0F172A]">
            Document History
          </h1>
          <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">
            Cari, filter, dan buka kembali hasil analisis dokumen rekening koran Anda.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={fetchHistory}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-xs cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={onNavigateAnalyze}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            <span>Analyze New PDF</span>
          </button>
        </div>
      </div>

      {/* FILTER CONTROLS BAR */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search filename or title..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-400 bg-white"
            />
          </div>

          {/* Bank Filter Dropdown */}
          <div className="relative">
            <select
              value={bank}
              onChange={(e) => {
                setBank(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-700 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
            >
              <option value="ALL">All Banks</option>
              {INDONESIAN_BANKS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter Dropdown */}
          <div className="relative">
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-700 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              <option value="COMPLETED">Completed</option>
              <option value="PROCESSING">Processing</option>
              <option value="FAILED">Failed</option>
              <option value="UPLOADED">Uploaded</option>
            </select>
          </div>

          {/* Date Range Inputs */}
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
              title="Start Date"
              className="w-1/2 px-2.5 py-2 rounded-xl border border-slate-200 text-[11px] text-slate-700 bg-white focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-slate-400 text-xs">-</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
              title="End Date"
              className="w-1/2 px-2.5 py-2 rounded-xl border border-slate-200 text-[11px] text-slate-700 bg-white focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Active Filters & Reset */}
        {hasActiveFilters && (
          <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
            <span className="text-slate-500 text-[11px]">
              Filter aktif: {pagination.total} dokumen ditemukan
            </span>
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:text-rose-700 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Reset Filter</span>
            </button>
          </div>
        )}
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
            onClick={fetchHistory}
            className="underline font-semibold hover:text-rose-900 cursor-pointer"
          >
            Coba lagi
          </button>
        </div>
      )}

      {/* DOCUMENT LIST TABLE */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-16 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
            <RefreshCw className="w-7 h-7 animate-spin text-blue-500" />
            <span>Memuat riwayat dokumen...</span>
          </div>
        ) : documents.length === 0 ? (
          <div className="p-16 text-center space-y-3">
            <FileText className="w-12 h-12 text-slate-300 mx-auto" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">
                {hasActiveFilters ? "Tidak ada dokumen yang cocok dengan filter" : "Belum ada dokumen yang dianalisis"}
              </p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                {hasActiveFilters
                  ? "Coba sesuaikan kata kunci pencarian, filter bank, atau rentang tanggal."
                  : "Mulai dengan mengunggah dan menganalisis rekening koran bank PDF pertama Anda."}
              </p>
            </div>
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Reset Semua Filter
              </button>
            ) : (
              <button
                type="button"
                onClick={onNavigateAnalyze}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold cursor-pointer shadow-xs"
              >
                Unggah PDF Sekarang
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/75 border-b border-slate-200/80 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4 sm:px-6">Document</th>
                  <th className="py-3 px-4">Bank &amp; Account</th>
                  <th className="py-3 px-4">Period</th>
                  <th className="py-3 px-4 text-center">Transactions</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Uploaded / Accessed</th>
                  <th className="py-3 px-4 sm:px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {documents.map((doc) => (
                  <tr
                    key={doc.id}
                    className="hover:bg-slate-50/60 transition-colors group"
                  >
                    {/* Document Name & Size */}
                    <td className="py-3.5 px-4 sm:px-6">
                      <div className="flex items-center gap-2.5 max-w-xs sm:max-w-sm">
                        <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate" title={doc.originalFileName}>
                            {doc.originalFileName}
                          </p>
                          <div className="flex items-center gap-2 text-[10px] text-slate-400">
                            <span>{formatBytes(doc.fileSize)}</span>
                            {doc.processingDuration && (
                              <span>· {(doc.processingDuration / 1000).toFixed(1)}s</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Bank & Masked Account */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div>
                        <span className="font-semibold text-slate-900 flex items-center gap-1">
                          <Landmark className="w-3 h-3 text-slate-400" />
                          {doc.bankName || "Unknown Bank"}
                        </span>
                        {doc.accountNumberMasked && (
                          <span className="text-[10px] font-mono text-slate-500 block">
                            {doc.accountNumberMasked}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Period */}
                    <td className="py-3.5 px-4 text-slate-600 whitespace-nowrap">
                      <span className="text-[11px] font-mono">
                        {doc.statementPeriodStart && doc.statementPeriodEnd
                          ? `${new Date(doc.statementPeriodStart).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "2-digit" })} — ${new Date(doc.statementPeriodEnd).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "2-digit" })}`
                          : "N/A"}
                      </span>
                    </td>

                    {/* Transactions */}
                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-800">
                        {doc.transactionCount}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {getStatusBadge(doc.status)}
                    </td>

                    {/* Date */}
                    <td className="py-3.5 px-4 text-slate-500 whitespace-nowrap">
                      <div className="text-[11px]">
                        <div>{formatDate(doc.createdAt)}</div>
                        {doc.lastAccessedAt && (
                          <div className="text-[10px] text-slate-400">
                            Accessed: {formatDate(doc.lastAccessedAt)}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 sm:px-6 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenDocument(doc.id)}
                          className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold text-blue-600 hover:text-white bg-blue-50 hover:bg-blue-600 rounded-lg transition-colors cursor-pointer"
                          title="Buka kembali hasil analisis"
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

        {/* PAGINATION FOOTER */}
        {pagination.total > 0 && (
          <div className="p-4 sm:px-6 border-t border-slate-200/80 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <span>
                Menampilkan <strong className="text-slate-900">{(pagination.page - 1) * pagination.limit + 1}</strong> - <strong className="text-slate-900">{Math.min(pagination.page * pagination.limit, pagination.total)}</strong> dari <strong className="text-slate-900">{pagination.total}</strong> dokumen
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Items per page selector */}
              <div className="flex items-center gap-1.5 pr-2 border-r border-slate-200">
                <span className="text-[11px] text-slate-500">Per page:</span>
                <select
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value));
                    setPage(1);
                  }}
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs cursor-pointer"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>

              {/* Prev / Next controls */}
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={!pagination.hasPrevPage || loading}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                title="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="text-xs font-semibold px-2">
                Halaman {pagination.page} dari {pagination.totalPages}
              </span>

              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={!pagination.hasNextPage || loading}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                title="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* DELETE CONFIRMATION DIALOG */}
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
                Apakah Anda yakin ingin menghapus <strong className="text-slate-900">{docToDelete.originalFileName}</strong>? Dokumen ini akan disembunyikan dari riwayat Anda dan tidak lagi dapat dibuka.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDocToDelete(null)}
                disabled={isDeleting}
                className="px-3.5 py-1.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleDeleteDocument}
                disabled={isDeleting}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                {isDeleting ? (
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
