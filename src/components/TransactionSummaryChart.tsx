import React, { useState, useMemo } from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  PieChart as PieChartIcon,
  BarChart3,
  Calendar,
  Layers,
  ArrowDownLeft,
  ArrowUpRight,
  Scale,
} from "lucide-react";
import type {
  ParsedTransactionUi,
  TransactionExtractionSummaryUi,
} from "../types/transaction";

interface TransactionSummaryChartProps {
  transactions: ParsedTransactionUi[];
  summary?: TransactionExtractionSummaryUi;
}

type ChartViewMode = "distribution" | "timeline" | "categories";

function parseNum(val: string | null | undefined): number {
  if (!val) return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function formatCurrencyShort(amount: number): string {
  if (Math.abs(amount) >= 1_000_000_000) {
    return `Rp ${(amount / 1_000_000_000).toFixed(1)}M`;
  }
  if (Math.abs(amount) >= 1_000_000) {
    return `Rp ${(amount / 1_000_000).toFixed(1)}jt`;
  }
  if (Math.abs(amount) >= 1_000) {
    return `Rp ${(amount / 1_000).toFixed(0)}rb`;
  }
  return `Rp ${amount.toLocaleString("id-ID")}`;
}

function formatFullCurrency(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Colors for Financial Inflow vs Outflow
const COLOR_CREDIT = "#059669"; // Emerald 600
const COLOR_CREDIT_LIGHT = "#10b981"; // Emerald 500
const COLOR_DEBIT = "#e11d48"; // Rose 600
const COLOR_DEBIT_LIGHT = "#f43f5e"; // Rose 500

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number;
    color?: string;
    payload?: Record<string, unknown>;
  }>;
  label?: string;
}

function FinancialTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="bg-stone-900/95 backdrop-blur-sm text-white px-3.5 py-2.5 rounded-lg shadow-xl border border-stone-800 text-xs min-w-[170px] pointer-events-none z-50">
      {label && <div className="font-semibold text-stone-300 pb-1.5 mb-1.5 border-b border-stone-800">{label}</div>}
      <div className="space-y-1">
        {payload.map((entry, index) => {
          const val = Number(entry.value || 0);
          return (
            <div key={`item-${index}`} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-stone-300 text-[11px]">
                <span
                  className="w-2 h-2 rounded-full inline-block"
                  style={{ backgroundColor: entry.color || "#10b981" }}
                />
                {entry.name || "Amount"}:
              </span>
              <span className="font-mono font-semibold text-white text-[11px]">
                {formatFullCurrency(val)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TransactionSummaryChart({
  transactions,
  summary,
}: TransactionSummaryChartProps) {
  const [viewMode, setViewMode] = useState<ChartViewMode>("distribution");

  // Calculate aggregation metrics
  const {
    totalCreditVal,
    totalDebitVal,
    creditCount,
    debitCount,
    netFlow,
    pieDataAmount,
    pieDataCount,
    timelineData,
    categoryData,
  } = useMemo(() => {
    let creditSum = 0;
    let debitSum = 0;
    let cCount = 0;
    let dCount = 0;

    const timelineMap = new Map<string, { date: string; credit: number; debit: number; count: number }>();
    const typeMap = new Map<string, { name: string; credit: number; debit: number }>();

    for (const tx of transactions) {
      const c = parseNum(tx.credit);
      const d = parseNum(tx.debit);

      if (c > 0) {
        creditSum += c;
        cCount++;
      }
      if (d > 0) {
        debitSum += d;
        dCount++;
      }

      // Date timeline
      const dateKey = tx.transactionDate || tx.rawDate || "Unknown";
      const existingDate = timelineMap.get(dateKey) || { date: dateKey, credit: 0, debit: 0, count: 0 };
      existingDate.credit += c;
      existingDate.debit += d;
      existingDate.count += 1;
      timelineMap.set(dateKey, existingDate);

      // Type / Category
      const typeKey = tx.transactionType || "OTHER";
      const existingType = typeMap.get(typeKey) || {
        name: typeKey.replace(/_/g, " "),
        credit: 0,
        debit: 0,
      };
      existingType.credit += c;
      existingType.debit += d;
      typeMap.set(typeKey, existingType);
    }

    // Fall back to summary values if transactions were empty or partial
    const finalCreditVal = creditSum > 0 ? creditSum : parseNum(summary?.totalCredit);
    const finalDebitVal = debitSum > 0 ? debitSum : parseNum(summary?.totalDebit);
    const flow = finalCreditVal - finalDebitVal;

    const pieAmount = [
      { name: "Total Credits (Inflow)", value: finalCreditVal, color: COLOR_CREDIT },
      { name: "Total Debits (Outflow)", value: finalDebitVal, color: COLOR_DEBIT },
    ].filter((d) => d.value > 0);

    const pieCount = [
      { name: "Credit Transactions", value: cCount, color: COLOR_CREDIT_LIGHT },
      { name: "Debit Transactions", value: dCount, color: COLOR_DEBIT_LIGHT },
    ].filter((d) => d.value > 0);

    // Sort timeline chronologically if possible
    const sortedTimeline = Array.from(timelineMap.values()).sort((a, b) => {
      return a.date.localeCompare(b.date);
    });

    const sortedTypes = Array.from(typeMap.values())
      .filter((t) => t.credit > 0 || t.debit > 0)
      .sort((a, b) => b.credit + b.debit - (a.credit + a.debit))
      .slice(0, 6);

    return {
      totalCreditVal: finalCreditVal,
      totalDebitVal: finalDebitVal,
      creditCount: cCount,
      debitCount: dCount,
      netFlow: flow,
      pieDataAmount: pieAmount,
      pieDataCount: pieCount,
      timelineData: sortedTimeline,
      categoryData: sortedTypes,
    };
  }, [transactions, summary]);

  const totalVolume = totalCreditVal + totalDebitVal;
  const creditRatio = totalVolume > 0 ? (totalCreditVal / totalVolume) * 100 : 0;
  const debitRatio = totalVolume > 0 ? (totalDebitVal / totalVolume) * 100 : 0;

  if (transactions.length === 0 && totalCreditVal === 0 && totalDebitVal === 0) {
    return null;
  }

  return (
    <div
      id="transaction-summary-chart-container"
      className="bg-stone-50/70 border border-stone-200 rounded-xl p-5 space-y-4"
    >
      {/* Top Header with navigation tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-stone-200/80">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 border border-emerald-200 flex items-center justify-center text-emerald-800">
            <PieChartIcon className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-stone-900 tracking-tight flex items-center gap-2">
              Credit vs. Debit Distribution Analysis
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-stone-200/70 text-stone-700 font-medium">
                Recharts
              </span>
            </h4>
            <p className="text-[11px] text-stone-500">
              Visualizing inflow vs. outflow proportions, cash flow balance, and transaction distribution
            </p>
          </div>
        </div>

        {/* Chart View Modes */}
        <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-stone-200 shadow-xs text-xs">
          <button
            type="button"
            onClick={() => setViewMode("distribution")}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
              viewMode === "distribution"
                ? "bg-stone-900 text-white shadow-xs"
                : "text-stone-600 hover:text-stone-900 hover:bg-stone-100"
            }`}
          >
            <PieChartIcon className="w-3.5 h-3.5" />
            Distribution
          </button>
          <button
            type="button"
            onClick={() => setViewMode("timeline")}
            disabled={timelineData.length < 2}
            title={timelineData.length < 2 ? "Requires multiple transaction dates" : undefined}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              viewMode === "timeline"
                ? "bg-stone-900 text-white shadow-xs"
                : "text-stone-600 hover:text-stone-900 hover:bg-stone-100"
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            Daily Timeline
          </button>
          <button
            type="button"
            onClick={() => setViewMode("categories")}
            disabled={categoryData.length === 0}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              viewMode === "categories"
                ? "bg-stone-900 text-white shadow-xs"
                : "text-stone-600 hover:text-stone-900 hover:bg-stone-100"
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            By Type
          </button>
        </div>
      </div>

      {/* Main visualization area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
        {/* VIEW 1: Distribution (Donut Chart + Side Breakdown) */}
        {viewMode === "distribution" && (
          <>
            <div className="lg:col-span-5 flex flex-col items-center justify-center p-2 bg-white rounded-xl border border-stone-200/80 shadow-xs relative">
              <div className="w-full h-56 flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip content={<FinancialTooltip />} />
                    <Pie
                      data={pieDataAmount}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="#ffffff"
                      strokeWidth={2}
                    >
                      {pieDataAmount.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Center Donut Label */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none mt-[-4px]">
                <span className="text-[10px] text-stone-400 font-semibold uppercase tracking-wider block">
                  Total Volume
                </span>
                <span className="text-xs font-bold text-stone-800 font-mono block">
                  {formatCurrencyShort(totalVolume)}
                </span>
              </div>

              {/* Pie Legends with percentage badges */}
              <div className="w-full flex items-center justify-around pt-2 pb-1 border-t border-stone-100 text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-emerald-600 inline-block" />
                  <div>
                    <span className="text-stone-600 text-[11px] block font-medium">Credits</span>
                    <span className="text-emerald-700 font-mono font-semibold text-xs">
                      {creditRatio.toFixed(1)}%
                    </span>
                  </div>
                </div>

                <div className="h-6 w-px bg-stone-200" />

                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-rose-600 inline-block" />
                  <div>
                    <span className="text-stone-600 text-[11px] block font-medium">Debits</span>
                    <span className="text-rose-700 font-mono font-semibold text-xs">
                      {debitRatio.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Side: Key Inflow / Outflow & Net Cash Flow Breakdown Cards */}
            <div className="lg:col-span-7 space-y-3">
              {/* Credits & Debits Comparative Split */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Credit Card */}
                <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-900">
                      <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-600" />
                      Total Credit (Inflow)
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                      {creditCount} txs
                    </span>
                  </div>
                  <div className="text-base sm:text-lg font-bold font-mono text-emerald-800">
                    {formatFullCurrency(totalCreditVal)}
                  </div>
                  <div className="flex justify-between items-center text-[11px] text-emerald-700 pt-1 border-t border-emerald-200/60">
                    <span>Avg / Credit:</span>
                    <span className="font-mono font-medium">
                      {creditCount > 0 ? formatCurrencyShort(totalCreditVal / creditCount) : "-"}
                    </span>
                  </div>
                </div>

                {/* Debit Card */}
                <div className="p-3.5 bg-rose-50/70 border border-rose-200 rounded-xl space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-900">
                      <ArrowUpRight className="w-3.5 h-3.5 text-rose-600" />
                      Total Debit (Outflow)
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-800">
                      {debitCount} txs
                    </span>
                  </div>
                  <div className="text-base sm:text-lg font-bold font-mono text-rose-800">
                    {formatFullCurrency(totalDebitVal)}
                  </div>
                  <div className="flex justify-between items-center text-[11px] text-rose-700 pt-1 border-t border-rose-200/60">
                    <span>Avg / Debit:</span>
                    <span className="font-mono font-medium">
                      {debitCount > 0 ? formatCurrencyShort(totalDebitVal / debitCount) : "-"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Net Cash Flow Banner */}
              <div className="p-3.5 bg-white border border-stone-200 rounded-xl flex items-center justify-between shadow-xs">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                      netFlow >= 0
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-rose-100 text-rose-700"
                    }`}
                  >
                    {netFlow >= 0 ? (
                      <TrendingUp className="w-5 h-5" />
                    ) : (
                      <TrendingDown className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <span className="text-[11px] text-stone-500 font-medium block">
                      Net Statement Cash Flow
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm sm:text-base font-bold font-mono ${
                          netFlow >= 0 ? "text-emerald-700" : "text-rose-700"
                        }`}
                      >
                        {netFlow >= 0 ? "+" : ""}
                        {formatFullCurrency(netFlow)}
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${
                          netFlow >= 0
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-rose-100 text-rose-800"
                        }`}
                      >
                        {netFlow >= 0 ? "Net Surplus" : "Net Deficit"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="hidden sm:block text-right text-xs">
                  <span className="text-[11px] text-stone-400 block">Total Extracted</span>
                  <span className="font-semibold text-stone-700 font-mono">
                    {transactions.length} rows
                  </span>
                </div>
              </div>

              {/* Proportional Distribution Bar */}
              <div className="space-y-1 pt-1">
                <div className="flex justify-between text-[11px] text-stone-500 font-medium">
                  <span>Distribution Ratio</span>
                  <span className="font-mono">
                    {creditRatio.toFixed(0)}% Inflow / {debitRatio.toFixed(0)}% Outflow
                  </span>
                </div>
                <div className="h-2 w-full bg-stone-200 rounded-full overflow-hidden flex">
                  <div
                    className="h-full bg-emerald-600 transition-all duration-500"
                    style={{ width: `${creditRatio}%` }}
                    title={`Credits: ${creditRatio.toFixed(1)}%`}
                  />
                  <div
                    className="h-full bg-rose-600 transition-all duration-500"
                    style={{ width: `${debitRatio}%` }}
                    title={`Debits: ${debitRatio.toFixed(1)}%`}
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {/* VIEW 2: Timeline Bar Chart (Daily credits vs debits) */}
        {viewMode === "timeline" && (
          <div className="col-span-12 p-3 bg-white rounded-xl border border-stone-200 shadow-xs">
            <div className="flex items-center justify-between mb-2 text-xs">
              <span className="font-semibold text-stone-800 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-stone-500" />
                Daily Credit vs. Debit Distribution
              </span>
              <span className="text-stone-400 text-[11px]">Values in IDR (Rp)</span>
            </div>
            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timelineData} margin={{ top: 10, right: 15, left: 10, bottom: 25 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "#78716c" }}
                    angle={-30}
                    textAnchor="end"
                    tickMargin={6}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#78716c" }}
                    tickFormatter={(v) => formatCurrencyShort(Number(v))}
                  />
                  <Tooltip content={<FinancialTooltip />} />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
                  />
                  <Bar dataKey="credit" name="Credit (Inflow)" fill={COLOR_CREDIT} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="debit" name="Debit (Outflow)" fill={COLOR_DEBIT} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* VIEW 3: By Transaction Type Breakdown */}
        {viewMode === "categories" && (
          <div className="col-span-12 p-3 bg-white rounded-xl border border-stone-200 shadow-xs">
            <div className="flex items-center justify-between mb-2 text-xs">
              <span className="font-semibold text-stone-800 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-stone-500" />
                Distribution by Transaction Type
              </span>
              <span className="text-stone-400 text-[11px]">Top detected types</span>
            </div>
            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={categoryData}
                  layout="vertical"
                  margin={{ top: 10, right: 20, left: 40, bottom: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e7e5e4" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10, fill: "#78716c" }}
                    tickFormatter={(v) => formatCurrencyShort(Number(v))}
                  />
                  <YAxis
                    dataKey="name"
                    type="category"
                    tick={{ fontSize: 10, fill: "#44403c" }}
                    width={90}
                  />
                  <Tooltip content={<FinancialTooltip />} />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
                  />
                  <Bar dataKey="credit" name="Credit (Inflow)" fill={COLOR_CREDIT} radius={[0, 4, 4, 0]} />
                  <Bar dataKey="debit" name="Debit (Outflow)" fill={COLOR_DEBIT} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
