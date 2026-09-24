import React, { useState, useMemo } from "react";
import {
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Search,
  Filter,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  Eye,
  Info,
  Layers,
  Sparkles,
} from "lucide-react";
import type {
  TransactionExtractionResultUi,
  ParsedTransactionUi,
  ReviewRowUi,
  TransactionType,
} from "../types/transaction";
import { TransactionSummaryChart } from "./TransactionSummaryChart";

interface TransactionExtractionCardProps {
  extraction: TransactionExtractionResultUi | null;
  isLoading: boolean;
  onExtractTransactions: () => void;
  documentId: string;
  isScannedOrImageOnly?: boolean;
}

function formatCurrencyIdr(amountStr: string | null | undefined): string {
  if (!amountStr || amountStr === "0.00") return "-";
  const num = parseFloat(amountStr);
  if (isNaN(num)) return amountStr;
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 2,
  }).format(num);
}

function getTypeBadge(type: TransactionType) {
  switch (type) {
    case "TRANSFER_IN":
    case "CREDIT":
    case "CASH_DEPOSIT":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "TRANSFER_OUT":
    case "DEBIT":
    case "CASH_WITHDRAWAL":
    case "ATM":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "FEE":
    case "TAX":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "INTEREST":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "QRIS":
    case "BILL_PAYMENT":
      return "bg-indigo-50 text-indigo-700 border-indigo-200";
    default:
      return "bg-stone-50 text-stone-700 border-stone-200";
  }
}

export function TransactionExtractionCard({
  extraction,
  isLoading,
  onExtractTransactions,
  documentId: _documentId,
  isScannedOrImageOnly,
}: TransactionExtractionCardProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedType, setSelectedType] = useState<string>("ALL");
  const [showOnlyReviewRows, setShowOnlyReviewRows] = useState(false);

  const transactions = extraction?.transactions || [];
  const reviewRows = extraction?.reviewRows || [];
  const summary = extraction?.summary;

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      const matchSearch =
        searchTerm.trim() === "" ||
        tx.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (tx.referenceNumber &&
          tx.referenceNumber.toLowerCase().includes(searchTerm.toLowerCase())) ||
        tx.transactionDate.includes(searchTerm);

      const matchType =
        selectedType === "ALL" ||
        (selectedType === "CREDIT" && Boolean(tx.credit)) ||
        (selectedType === "DEBIT" && Boolean(tx.debit)) ||
        tx.transactionType === selectedType;

      return matchSearch && matchType;
    });
  }, [transactions, searchTerm, selectedType]);

  return (
    <div
      id="transaction-extraction-card"
      className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden"
    >
      {/* Header bar */}
      <div className="px-6 py-5 border-b border-stone-100 flex flex-wrap items-center justify-between gap-4 bg-stone-50/60">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center text-white shadow-sm">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-stone-900">
                Bank Statement Transaction Extraction
              </h3>
              {extraction && (
                <span
                  id="extraction-status-badge"
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                    extraction.status === "COMPLETED"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : extraction.status === "PARTIAL"
                      ? "bg-amber-50 text-amber-700 border-amber-200"
                      : extraction.status === "NEEDS_REVIEW"
                      ? "bg-orange-50 text-orange-700 border-orange-200"
                      : "bg-rose-50 text-rose-700 border-rose-200"
                  }`}
                >
                  {extraction.status === "COMPLETED" && (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  {extraction.status === "PARTIAL" && (
                    <AlertTriangle className="w-3.5 h-3.5" />
                  )}
                  {extraction.status === "NEEDS_REVIEW" && (
                    <HelpCircle className="w-3.5 h-3.5" />
                  )}
                  {extraction.status}
                </span>
              )}
            </div>
            <p className="text-xs text-stone-500 mt-0.5">
              Deterministic parsing, financial normalization to Decimal(18,2), and balance continuity
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {extraction && extraction.transactions.length > 0 && (
            <button
              id="jump-to-excel-export-button"
              onClick={() => {
                const el = document.getElementById("excel-export-section");
                el?.scrollIntoView({ behavior: "smooth" });
                const exportBtn = document.getElementById("export-excel-button") as HTMLButtonElement | null;
                if (exportBtn) exportBtn.click();
              }}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium rounded-lg shadow-sm transition-colors cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              Export Excel
            </button>
          )}

          <button
            id="extract-transactions-button"
            onClick={onExtractTransactions}
            disabled={isLoading || isScannedOrImageOnly}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-stone-300 text-white text-xs font-medium rounded-lg shadow-sm transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            {isLoading
              ? "Extracting Transactions..."
              : extraction
              ? "Re-extract Transactions"
              : "Extract Transactions"}
          </button>
        </div>
      </div>

      {/* Scanned / Image-Only Alert */}
      {isScannedOrImageOnly && (
        <div className="p-4 mx-6 mt-6 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3 text-amber-900">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs">
            <span className="font-semibold block mb-0.5">Image-Based Document Detected</span>
            This PDF appears to be image-based and requires OCR before transactions can be extracted reliably.
            Text-based parsing has been paused to guarantee data correctness.
          </div>
        </div>
      )}

      {/* Warning Notice if any */}
      {extraction?.warning && !isScannedOrImageOnly && (
        <div className="p-4 mx-6 mt-6 bg-amber-50/80 border border-amber-200 rounded-lg flex items-start gap-3 text-amber-900">
          <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs">
            <span className="font-semibold block mb-0.5">Extraction Notice</span>
            {extraction.warning}
          </div>
        </div>
      )}

      {/* Extraction Content */}
      {extraction ? (
        <div className="p-6 space-y-6">
          {/* Summary metrics */}
          {summary && (
            <div
              id="extraction-summary-grid"
              className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3"
            >
              <div className="p-3 bg-stone-50 rounded-lg border border-stone-200/70">
                <span className="text-[11px] font-medium text-stone-500 uppercase tracking-wider block">
                  Rows Detected
                </span>
                <span className="text-lg font-semibold text-stone-900 mt-1 block">
                  {summary.totalRowsDetected}
                </span>
              </div>
              <div className="p-3 bg-emerald-50/60 rounded-lg border border-emerald-200/70">
                <span className="text-[11px] font-medium text-emerald-700 uppercase tracking-wider block">
                  Parsed Valid
                </span>
                <span className="text-lg font-semibold text-emerald-800 mt-1 block">
                  {summary.totalTransactionsParsed}
                </span>
              </div>
              <div className="p-3 bg-amber-50/60 rounded-lg border border-amber-200/70">
                <span className="text-[11px] font-medium text-amber-700 uppercase tracking-wider block">
                  Needs Review
                </span>
                <span className="text-lg font-semibold text-amber-800 mt-1 block">
                  {summary.totalTransactionsNeedingReview}
                </span>
              </div>
              <div className="p-3 bg-stone-50 rounded-lg border border-stone-200/70">
                <span className="text-[11px] font-medium text-stone-500 uppercase tracking-wider block">
                  Total Debits
                </span>
                <span className="text-xs font-semibold text-rose-600 mt-1 block truncate">
                  {formatCurrencyIdr(summary.totalDebit)}
                </span>
              </div>
              <div className="p-3 bg-stone-50 rounded-lg border border-stone-200/70">
                <span className="text-[11px] font-medium text-stone-500 uppercase tracking-wider block">
                  Total Credits
                </span>
                <span className="text-xs font-semibold text-emerald-600 mt-1 block truncate">
                  {formatCurrencyIdr(summary.totalCredit)}
                </span>
              </div>
              <div className="p-3 bg-stone-50 rounded-lg border border-stone-200/70">
                <span className="text-[11px] font-medium text-stone-500 uppercase tracking-wider block">
                  Reconciliation
                </span>
                <span
                  className={`text-xs font-semibold mt-1 block ${
                    summary.balanceReconciliationStatus === "VALID"
                      ? "text-emerald-700"
                      : "text-amber-700"
                  }`}
                >
                  {summary.balanceReconciliationStatus}
                </span>
              </div>
            </div>
          )}

          {/* Summary Chart: Credit vs. Debit Distributions (Recharts) */}
          <TransactionSummaryChart transactions={transactions} summary={summary} />

          {/* Needs Review Section banner if any rows require manual inspection */}
          {reviewRows.length > 0 && (
            <div
              id="needs-review-section"
              className="p-4 bg-orange-50/80 border border-orange-200 rounded-xl space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-orange-600" />
                  <span className="text-xs font-semibold text-orange-900">
                    {reviewRows.length} Row(s) Requiring Verification
                  </span>
                </div>
                <button
                  onClick={() => setShowOnlyReviewRows(!showOnlyReviewRows)}
                  className="text-xs font-medium text-orange-800 hover:text-orange-950 underline cursor-pointer"
                >
                  {showOnlyReviewRows ? "Show All Rows" : "Focus on Review Rows"}
                </button>
              </div>
              <p className="text-xs text-orange-700">
                To guarantee financial precision, ambiguous lines or formatting exceptions are never silently discarded.
              </p>

              <div className="space-y-2 max-h-48 overflow-y-auto">
                {reviewRows.map((row, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 bg-white rounded-lg border border-orange-200 text-xs font-mono space-y-1"
                  >
                    <div className="flex items-center justify-between text-[11px] text-stone-500">
                      <span>Page {row.pageNumber}</span>
                      <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 font-semibold uppercase text-[10px]">
                        {row.reason}
                      </span>
                    </div>
                    <p className="text-stone-800 whitespace-pre-wrap">{row.rawSourceText}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Search and Filters */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="relative min-w-[240px] flex-1 max-w-sm">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                id="transaction-search-input"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search description, date, ref..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-white"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
              <span className="text-stone-400 mr-1 flex items-center gap-1 text-[11px]">
                <Filter className="w-3 h-3" /> Filter:
              </span>
              {["ALL", "DEBIT", "CREDIT", "FEE", "TRANSFER_IN", "TRANSFER_OUT"].map((t) => (
                <button
                  key={t}
                  onClick={() => setSelectedType(t)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                    selectedType === t
                      ? "bg-stone-900 text-white"
                      : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                  }`}
                >
                  {t.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>

          {/* Transactions Table */}
          <div className="border border-stone-200 rounded-xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto max-h-[500px]">
              <table
                id="extracted-transactions-table"
                className="w-full text-left border-collapse text-xs"
              >
                <thead className="bg-stone-100/80 sticky top-0 z-10 border-b border-stone-200">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold text-stone-700">Date</th>
                    <th className="py-2.5 px-3 font-semibold text-stone-700 min-w-[200px]">
                      Description
                    </th>
                    <th className="py-2.5 px-3 font-semibold text-stone-700">Type</th>
                    <th className="py-2.5 px-3 font-semibold text-stone-700 text-right">Debit</th>
                    <th className="py-2.5 px-3 font-semibold text-stone-700 text-right">Credit</th>
                    <th className="py-2.5 px-3 font-semibold text-stone-700 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filteredTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-stone-400">
                        No transactions found matching your criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredTransactions.map((tx, idx) => (
                      <tr
                        key={tx.id || idx}
                        className="hover:bg-stone-50/80 transition-colors"
                      >
                        <td className="py-2.5 px-3 text-stone-600 font-mono whitespace-nowrap">
                          {tx.transactionDate}
                          {tx.rawDate && tx.rawDate !== tx.transactionDate && (
                            <span className="block text-[10px] text-stone-400">
                              ({tx.rawDate})
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-stone-900 whitespace-pre-wrap">
                            {tx.description}
                          </div>
                          {tx.referenceNumber && (
                            <div className="text-[10px] text-stone-500 font-mono mt-0.5">
                              Ref: {tx.referenceNumber}
                            </div>
                          )}
                          {tx.category && (
                            <span className="inline-block mt-1 px-1.5 py-0.5 text-[9px] rounded bg-stone-100 text-stone-600 border border-stone-200">
                              {tx.category}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ${getTypeBadge(
                              tx.transactionType
                            )}`}
                          >
                            {tx.credit ? (
                              <ArrowDownLeft className="w-2.5 h-2.5 text-emerald-600" />
                            ) : (
                              <ArrowUpRight className="w-2.5 h-2.5 text-rose-600" />
                            )}
                            {tx.transactionType.replace("_", " ")}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-medium text-rose-600 whitespace-nowrap">
                          {tx.debit ? formatCurrencyIdr(tx.debit) : "-"}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-medium text-emerald-600 whitespace-nowrap">
                          {tx.credit ? formatCurrencyIdr(tx.credit) : "-"}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold text-stone-900 whitespace-nowrap">
                          {formatCurrencyIdr(tx.balance)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-2.5 bg-stone-50 border-t border-stone-200 text-[11px] text-stone-500 flex justify-between items-center">
              <span>Showing {filteredTransactions.length} of {transactions.length} transactions</span>
              <span className="font-mono">Precision: Decimal(18,2)</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-8 text-center text-stone-500 space-y-3">
          <div className="w-12 h-12 mx-auto rounded-full bg-stone-100 flex items-center justify-center text-stone-400">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-stone-800">
              Transaction Extraction Ready
            </h4>
            <p className="text-xs text-stone-500 max-w-md mx-auto mt-1">
              Click &quot;Extract Transactions&quot; to parse every detectable transaction row,
              reconcile debits and credits, and identify rows requiring manual review.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
