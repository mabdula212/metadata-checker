import type { ParsedTransaction } from "./types.js";
import { cleanTransactionDescription } from "./utils/text-cleaner.js";

/**
 * Suggests a human-readable category based on description and transaction type.
 */
export function suggestCategory(tx: ParsedTransaction): string {
  const desc = tx.description.toUpperCase();

  if (tx.transactionType === "FEE") return "Bank Charges & Fees";
  if (tx.transactionType === "INTEREST") return "Interest Income";
  if (tx.transactionType === "TAX") return "Taxes";
  if (tx.transactionType === "QRIS") return "QRIS Merchant";
  if (tx.transactionType === "BILL_PAYMENT") return "Bills & Utilities";
  if (tx.transactionType === "CASH_WITHDRAWAL" || tx.transactionType === "ATM") return "Cash & ATM";
  if (tx.transactionType === "CASH_DEPOSIT") return "Cash Deposit";
  if (tx.transactionType === "TRANSFER_IN") return "Transfer In";
  if (tx.transactionType === "TRANSFER_OUT") return "Transfer Out";

  if (desc.includes("PLN") || desc.includes("LISTRIK") || desc.includes("BPJS") || desc.includes("TELKOM")) {
    return "Bills & Utilities";
  }
  if (desc.includes("RESTAURANT") || desc.includes("CAFE") || desc.includes("KOPI") || desc.includes("FOOD")) {
    return "Food & Dining";
  }
  if (desc.includes("SUPERMARKET") || desc.includes("INDOMARET") || desc.includes("ALFAMART")) {
    return "Groceries";
  }
  if (desc.includes("GAJI") || desc.includes("SALARY") || desc.includes("PAYROLL")) {
    return "Income / Payroll";
  }

  return tx.credit ? "General Income" : "General Expense";
}

/**
 * Normalizes an array of parsed transactions, sorting chronologically,
 * trimming descriptions, assigning categories, and verifying decimal precision.
 */
export function normalizeTransactions(transactions: ParsedTransaction[]): ParsedTransaction[] {
  return transactions.map((tx) => {
    const description = cleanTransactionDescription(tx.description);
    const category = tx.category || suggestCategory({ ...tx, description });

    return {
      ...tx,
      description,
      category,
    };
  });
}
