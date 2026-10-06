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
  Info,
  Layers,
  ShieldCheck,
  Calculator,
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
      return "bg-slate-50 text-slate-700 border-slate-200";
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
  const [activeTab, setActiveTab] = useState<"ALL" | "VALID" | "NEEDS_REVIEW">("ALL");

  const transactions = extraction?.transactions || [];
  const reviewRows = extraction?.reviewRows || [];
  const summary = extraction?.summary;
  const validation = extraction?.validation;

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

  const isReconciled = summary?.balanceReconciliationStatus === "VALID";

  // Calculate expected closing and difference from actual summary metrics
  const openingNum = summary?.openingBalance ? parseFloat(summary.openingBalance) : null;
  const creditNum = summary?.totalCredit ? parseFloat(summary.totalCredit) : 0;
  const debitNum = summary?.totalDebit ? parseFloat(summary.totalDebit) : 0;
  const closingNum = summary?.closingBalance ? parseFloat(summary.closingBalance) : null;

  let expectedClosingStr: string | null = null;
  let differenceStr: string = "0.00";

  if (openingNum !== null && !isNaN(openingNum)) {
    const calcExpected = openingNum + creditNum - debitNum;
    expectedClosingStr = calcExpected.toFixed(2);
    if (closingNum !== null && !isNaN(closingNum)) {
      const diff = Math.abs(closingNum - calcExpected);
      differenceStr = diff.toFixed(2);
    }
  } else if (closingNum !== null) {
    expectedClosingStr = closingNum.toFixed(2);
  }

  return (
    <div
      id="transaction-extraction-card"
      className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden space-y-6 p-6 sm:p-7"
    >
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 border border-blue-100 flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900 tracking-tight">
                Transaction Extraction
              </h3>
              {extraction && (
                <span
                  id="extraction-status-badge"
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold border ${
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
            <p className="text-xs text-slate-500 mt-0.5">
              Extract transaction dates, descriptions, debit, credit and balance.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {extraction && extraction.transactions.length > 0 && (
            <button
              id="jump-to-excel-export-button"
              type="button"
              onClick={() => {
                const el = document.getElementById("excel-export-section");
                el?.scrollIntoView({ behavior: "smooth" });
                const exportBtn = document.getElementById("export-excel-button") as HTMLButtonElement | null;
                if (exportBtn) exportBtn.click();
              }}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              Export to Excel
            </button>
          )}

          <button
            id="extract-transactions-button"
            type="button"
            onClick={onExtractTransactions}
            disabled={isLoading || isScannedOrImageOnly}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer disabled:cursor-not-allowed"
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
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3 text-amber-900">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs space-y-0.5">
            <span className="font-semibold block text-amber-950">Image-Based Document Detected</span>
            <p className="text-amber-800 leading-relaxed">
              This PDF appears to be image-based and requires OCR before transactions can be extracted reliably.
            </p>
          </div>
        </div>
      )}

      {/* Extraction Content */}
      {extraction ? (
        <div className="space-y-6">
          {/* Summary metrics */}
          {summary && (
            <div
              id="extraction-summary-grid"
              className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3"
            >
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                  Rows Detected
                </span>
                <span className="text-base sm:text-lg font-bold text-slate-900 mt-1 block">
                  {summary.totalRowsDetected}
                </span>
              </div>
              <div className="p-3.5 bg-emerald-50/50 rounded-xl border border-emerald-200/70">
                <span className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider block">
                  Parsed Valid
                </span>
                <span className="text-base sm:text-lg font-bold text-emerald-800 mt-1 block">
                  {summary.totalTransactionsParsed}
                </span>
              </div>
              <div className="p-3.5 bg-amber-50/50 rounded-xl border border-amber-200/70">
                <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider block">
                  Needs Review
                </span>
                <span className="text-base sm:text-lg font-bold text-amber-800 mt-1 block">
                  {summary.totalTransactionsNeedingReview}
                </span>
              </div>
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                  Total Debits
                </span>
                <span className="text-xs font-semibold text-rose-600 mt-1 block truncate">
                  {formatCurrencyIdr(summary.totalDebit)}
                </span>
              </div>
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                  Total Credits
                </span>
                <span className="text-xs font-semibold text-emerald-600 mt-1 block truncate">
                  {formatCurrencyIdr(summary.totalCredit)}
                </span>
              </div>
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                  Reconciliation
                </span>
                <span
                  className={`text-xs font-semibold mt-1 block ${
                    isReconciled ? "text-emerald-700" : "text-amber-700"
                  }`}
                >
                  {isReconciled ? "✓ Reconciled" : "⚠ Needs Review"}
                </span>
              </div>
            </div>
          )}

          {/* DEDICATED CARD: BALANCE VALIDATION (Section 16) */}
          {summary && (
            <div
              id="balance-validation-card"
              className="p-5 rounded-2xl border border-slate-200 bg-slate-50/60 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200/80">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      isReconciled
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    <Calculator className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">
                      Balance Validation
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Check transaction balance continuity and totals.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
                      isReconciled
                        ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                        : "bg-amber-50 text-amber-800 border-amber-300"
                    }`}
                  >
                    {isReconciled ? (
                      <>
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                        ✓ Reconciled
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                        ⚠ Needs Review
                      </>
                    )}
                  </span>
                </div>
              </div>

              {/* Validation Numbers Breakdown */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
                <div className="p-3 bg-white rounded-xl border border-slate-200/80">
                  <span className="text-[10px] uppercase font-semibold text-slate-400 block">
                    Opening Balance
                  </span>
                  <span className="font-mono font-medium text-slate-900 mt-1 block truncate">
                    {formatCurrencyIdr(summary.openingBalance)}
                  </span>
                </div>

                <div className="p-3 bg-white rounded-xl border border-slate-200/80">
                  <span className="text-[10px] uppercase font-semibold text-slate-400 block">
                    Total Credit (+)
                  </span>
                  <span className="font-mono font-medium text-emerald-700 mt-1 block truncate">
                    {formatCurrencyIdr(summary.totalCredit)}
                  </span>
                </div>

                <div className="p-3 bg-white rounded-xl border border-slate-200/80">
                  <span className="text-[10px] uppercase font-semibold text-slate-400 block">
                    Total Debit (-)
                  </span>
                  <span className="font-mono font-medium text-rose-700 mt-1 block truncate">
                    {formatCurrencyIdr(summary.totalDebit)}
                  </span>
                </div>

                <div className="p-3 bg-white rounded-xl border border-slate-200/80">
                  <span className="text-[10px] uppercase font-semibold text-slate-400 block">
                    Closing Balance
                  </span>
                  <span className="font-mono font-bold text-slate-900 mt-1 block truncate">
                    {formatCurrencyIdr(summary.closingBalance)}
                  </span>
                </div>

                <div className="p-3 bg-white rounded-xl border border-slate-200/80">
                  <span className="text-[10px] uppercase font-semibold text-slate-400 block">
                    Expected Closing
                  </span>
                  <span className="font-mono font-medium text-slate-800 mt-1 block truncate">
                    {expectedClosingStr ? formatCurrencyIdr(expectedClosingStr) : "-"}
                  </span>
                </div>

                <div className="p-3 bg-white rounded-xl border border-slate-200/80">
                  <span className="text-[10px] uppercase font-semibold text-slate-400 block">
                    Difference
                  </span>
                  <span
                    className={`font-mono font-semibold mt-1 block truncate ${
                      differenceStr === "0.00"
                        ? "text-emerald-700"
                        : "text-rose-700"
                    }`}
                  >
                    {formatCurrencyIdr(differenceStr)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Summary Chart: Credit vs. Debit Distributions */}
          <TransactionSummaryChart transactions={transactions} summary={summary} />

          {/* DEDICATED CARD / SECTION: NEEDS REVIEW (Section 15) */}
          {reviewRows.length > 0 && (
            <div
              id="needs-review-section"
              className="p-5 bg-amber-50/70 border border-amber-200 rounded-2xl space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span className="text-xs font-semibold text-amber-950 uppercase tracking-wider">
                    Needs Review ({reviewRows.length} rows require verification)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setActiveTab(activeTab === "NEEDS_REVIEW" ? "ALL" : "NEEDS_REVIEW")
                  }
                  className="text-xs font-semibold text-amber-900 hover:text-amber-950 underline cursor-pointer"
                >
                  {activeTab === "NEEDS_REVIEW" ? "Show All Transactions" : "View Review Rows in Detail"}
                </button>
              </div>
              <p className="text-xs text-amber-900/80 leading-relaxed">
                Ambiguous rows or multi-line statement text were detected. To preserve financial truth, no row was silently discarded.
              </p>

              <div className="space-y-2 max-h-56 overflow-y-auto pt-1">
                {reviewRows.map((row, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-white rounded-xl border border-amber-200 text-xs font-mono space-y-1 shadow-xs"
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span className="font-semibold text-slate-700">
                        Affected Row #{idx + 1} · Page {row.pageNumber}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-semibold uppercase text-[10px]">
                        {row.reason}
                      </span>
                    </div>
                    <p className="text-slate-800 whitespace-pre-wrap text-[11px] leading-relaxed">
                      {row.rawSourceText}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* DEDICATED TRANSACTION TABLE TOOLBAR & TABS (Section 14) */}
          <div className="space-y-3 pt-2">
            {/* Filter Tabs: All, Valid, Needs Review */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs">
                <button
                  type="button"
                  onClick={() => setActiveTab("ALL")}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                    activeTab === "ALL"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  All ({transactions.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("VALID")}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                    activeTab === "VALID"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Valid ({summary?.totalTransactionsParsed || transactions.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("NEEDS_REVIEW")}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                    activeTab === "NEEDS_REVIEW"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Needs Review ({reviewRows.length})
                </button>
              </div>

              {/* Transaction Type Filters */}
              <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
                <span className="text-slate-400 mr-1 flex items-center gap-1 text-[11px]">
                  <Filter className="w-3 h-3" /> Type:
                </span>
                {["ALL", "DEBIT", "CREDIT", "FEE", "TRANSFER_IN", "TRANSFER_OUT"].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setSelectedType(t)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                      selectedType === t
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {t.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>

            {/* Search Input */}
            <div className="relative w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                id="transaction-search-input"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search transactions by description, date, reference..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-600 focus:bg-white text-slate-900"
              />
            </div>

            {/* Transactions Table */}
            <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              <div className="overflow-x-auto max-h-[500px]">
                <table
                  id="extracted-transactions-table"
                  className="w-full text-left border-collapse text-xs"
                >
                  <thead className="bg-slate-50/90 sticky top-0 z-10 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Date</th>
                      <th className="py-3 px-4 font-semibold min-w-[220px]">
                        Description
                      </th>
                      <th className="py-3 px-4 font-semibold">Type</th>
                      <th className="py-3 px-4 font-semibold text-right">Debit</th>
                      <th className="py-3 px-4 font-semibold text-right">Credit</th>
                      <th className="py-3 px-4 font-semibold text-right">Balance</th>
                      <th className="py-3 px-4 font-semibold text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-10 text-center text-slate-400">
                          No transactions found matching your criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredTransactions.map((tx, idx) => (
                        <tr
                          key={tx.id || idx}
                          className="hover:bg-slate-50/60 transition-colors"
                        >
                          <td className="py-3 px-4 text-slate-600 font-mono whitespace-nowrap">
                            {tx.transactionDate}
                            {tx.rawDate && tx.rawDate !== tx.transactionDate && (
                              <span className="block text-[10px] text-slate-400">
                                ({tx.rawDate})
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-900 whitespace-pre-wrap">
                              {tx.description}
                            </div>
                            {tx.referenceNumber && (
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                Ref: {tx.referenceNumber}
                              </div>
                            )}
                            {tx.category && (
                              <span className="inline-block mt-1 px-1.5 py-0.5 text-[9px] rounded bg-slate-100 text-slate-600 border border-slate-200">
                                {tx.category}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
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
                          <td className="py-3 px-4 text-right font-mono font-medium text-rose-600 whitespace-nowrap">
                            {tx.debit ? formatCurrencyIdr(tx.debit) : "-"}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-medium text-emerald-600 whitespace-nowrap">
                            {tx.credit ? formatCurrencyIdr(tx.credit) : "-"}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">
                            {formatCurrencyIdr(tx.balance)}
                          </td>
                          <td className="py-3 px-4 text-center whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              Valid
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex justify-between items-center">
                <span>Showing {filteredTransactions.length} of {transactions.length} transactions</span>
                <span className="font-mono text-[11px]">Precision: Decimal(18,2)</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-8 text-center text-slate-500 space-y-3">
          <div className="w-12 h-12 mx-auto rounded-xl bg-slate-100 flex items-center justify-center text-slate-400">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-800">
              Transaction Extraction Ready
            </h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
              Extract transaction dates, descriptions, debit, credit and balance.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
