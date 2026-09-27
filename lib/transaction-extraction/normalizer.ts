import type { ParsedTransaction } from "./types.js";
import { cleanTransactionDescription, deriveTransactionType } from "./utils/text-cleaner.js";
import { toCents, formatCents } from "./utils/balance-parser.js";

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
 * Detects if extracted transactions are sorted in reverse chronological order (newest to oldest).
 */
export function isReverseChronological(transactions: ParsedTransaction[]): boolean {
  if (transactions.length < 2) return false;

  let datesDescending = 0;
  let datesAscending = 0;

  for (let i = 1; i < transactions.length; i++) {
    const prevDate = transactions[i - 1].transactionDate;
    const currDate = transactions[i].transactionDate;

    if (currDate < prevDate) {
      datesDescending++;
    } else if (currDate > prevDate) {
      datesAscending++;
    }
  }

  return datesDescending > datesAscending && datesDescending > 0;
}

/**
 * Reconciles transaction order, auto-corrects ambiguous Debit vs Credit using printed
 * balance delta truth, and interpolates missing intermediate balances.
 */
export function reconcileTransactionOrderAndBalances(transactions: ParsedTransaction[]): ParsedTransaction[] {
  if (transactions.length === 0) return [];

  // 1. Order check: reverse if statement was extracted in reverse-chronological order
  let list = [...transactions];
  if (isReverseChronological(list)) {
    list.reverse();
  }

  // 2. Reconcile Debit vs Credit using statement balance deltas and interpolate missing balances
  for (let i = 0; i < list.length; i++) {
    const curr = list[i];

    if (i > 0) {
      const prev = list[i - 1];
      const prevBalCents = toCents(prev.balance);
      const currBalCents = toCents(curr.balance);

      if (prevBalCents !== 0n && currBalCents !== 0n) {
        const delta = currBalCents - prevBalCents;
        const mutCents = toCents(curr.credit || curr.debit);

        // Case A: Balance strictly increased
        if (delta > 0n) {
          // If delta matches mutation amount, it is mathematically 100% a CREDIT
          if (mutCents === delta || curr.debit) {
            curr.credit = formatCents(delta);
            curr.debit = null;
            curr.transactionType = deriveTransactionType(curr.description, true, false);
            if (!curr.confidenceReasons.some((r) => r.includes("statement balance increment"))) {
              curr.confidenceReasons.push("Reconciled as CREDIT based on statement balance increment");
            }
          }
        }
        // Case B: Balance strictly decreased
        else if (delta < 0n) {
          const absDelta = -delta;
          // If absDelta matches mutation amount, it is mathematically 100% a DEBIT
          if (mutCents === absDelta || curr.credit) {
            curr.debit = formatCents(absDelta);
            curr.credit = null;
            curr.transactionType = deriveTransactionType(curr.description, false, true);
            if (!curr.confidenceReasons.some((r) => r.includes("statement balance reduction"))) {
              curr.confidenceReasons.push("Reconciled as DEBIT based on statement balance reduction");
            }
          }
        }
      }
      // Case C: Missing intermediate printed balance (interpolate from previous running balance)
      else if (prevBalCents !== 0n && (currBalCents === 0n || !curr.balance)) {
        const crCents = toCents(curr.credit);
        const dbCents = toCents(curr.debit);
        const interpolated = prevBalCents + crCents - dbCents;
        curr.balance = formatCents(interpolated);
      }
    }
  }

  return list;
}

/**
 * Normalizes an array of parsed transactions, sorting chronologically,
 * trimming descriptions, assigning categories, and verifying decimal precision.
 */
export function normalizeTransactions(transactions: ParsedTransaction[]): ParsedTransaction[] {
  const reconciled = reconcileTransactionOrderAndBalances(transactions);

  return reconciled.map((tx) => {
    const description = cleanTransactionDescription(tx.description);
    const category = tx.category || suggestCategory({ ...tx, description });

    return {
      ...tx,
      description,
      category,
    };
  });
}
