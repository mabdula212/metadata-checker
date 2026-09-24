import type { TransactionType } from "../types.js";

/**
 * Normalizes unicode whitespace, non-breaking spaces, and trim artifacts.
 */
export function normalizeTextWhitespace(text: string): string {
  if (!text) return "";
  return text
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Cleans multi-line or fragmented transaction description strings.
 */
export function cleanTransactionDescription(rawDesc: string): string {
  if (!rawDesc) return "";
  return rawDesc
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts a reference number from description or dedicated column if present.
 * Looks for patterns like:
 * - "NO REF: 12345678"
 * - "REF 998877"
 * - "TRX ID: ABC12345"
 * - "0208/FTSCY/WS95011"
 * - "CHQ: 12345"
 */
export function extractReferenceNumber(text: string): string | null {
  if (!text) return null;

  const patterns = [
    /(?:no\.?\s*ref(?:erensi)?|ref(?:erence)?\s*(?:no\.?|number)?|trx\s*id|transaksi\s*id)\s*[:=]\s*([A-Za-z0-9\/-]{4,30})/i,
    /\b(?:ref|referensi)\s*[:=]?\s*([A-Za-z0-9\/-]{5,30})\b/i,
    /\b(\d{4}\/[A-Z0-9]+\/[A-Z0-9]+)\b/, // Common BCA/Mandiri batch reference pattern e.g. 0208/FTSCY/WS95011
  ];

  for (const regex of patterns) {
    const match = text.match(regex);
    if (match && match[1]) {
      const candidate = match[1].trim();
      // Avoid false matches like date or words
      if (!/^(jan|feb|mar|apr|mei|jun|jul|agu|sep|okt|nov|des)/i.test(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Derives normalized transaction type from explicit terminology and keywords.
 * Never fabricates types.
 */
export function deriveTransactionType(
  description: string,
  isCredit: boolean,
  isDebit: boolean
): TransactionType {
  const upper = description.toUpperCase();

  // QRIS
  if (upper.includes("QRIS") || upper.includes("QR PAYMENT")) {
    return "QRIS";
  }

  // ATM
  if (
    upper.includes("ATM") ||
    upper.includes("TARIK TUNAI ATM") ||
    upper.includes("PENARIKAN ATM")
  ) {
    return upper.includes("SETOR") ? "CASH_DEPOSIT" : "ATM";
  }

  // Cash deposit / withdrawal
  if (
    upper.includes("SETORAN TUNAI") ||
    upper.includes("SETOR TUNAI") ||
    upper.includes("CASH DEPOSIT")
  ) {
    return "CASH_DEPOSIT";
  }
  if (
    upper.includes("TARIK TUNAI") ||
    upper.includes("PENARIKAN TUNAI") ||
    upper.includes("CASH WITHDRAWAL")
  ) {
    return "CASH_WITHDRAWAL";
  }

  // Fees, Admin, Tax, Interest
  if (
    upper.includes("BIAYA ADM") ||
    upper.includes("ADMINISTRASI") ||
    upper.includes("BIAYA TRANSFER") ||
    upper.includes("FEE") ||
    upper.includes("CHARGE")
  ) {
    return "FEE";
  }
  if (upper.includes("BUNGA") || upper.includes("INTEREST")) {
    return "INTEREST";
  }
  if (upper.includes("PAJAK") || upper.includes("TAX") || upper.includes("PPN")) {
    return "TAX";
  }

  // Reversal / Correction
  if (
    upper.includes("KOREKSI") ||
    upper.includes("REVERSAL") ||
    upper.includes("PEMBATALAN")
  ) {
    return "REVERSAL";
  }

  // Card payment / POS
  if (
    upper.includes("DEBIT CARD") ||
    upper.includes("KARTU DEBIT") ||
    upper.includes("POS PURCHASE") ||
    upper.includes("EDC")
  ) {
    return "CARD";
  }

  // Bill payment
  if (
    upper.includes("PEMBAYARAN") ||
    upper.includes("TAGIHAN") ||
    upper.includes("BILL") ||
    upper.includes("PLN") ||
    upper.includes("BPJS") ||
    upper.includes("TELKOM")
  ) {
    return "BILL_PAYMENT";
  }

  // Transfers
  if (
    upper.includes("TRSF") ||
    upper.includes("TRANSFER") ||
    upper.includes("PEMINDAHBUKUAN") ||
    upper.includes("BI-FAST") ||
    upper.includes("LLG") ||
    upper.includes("RTGS")
  ) {
    if (isCredit || upper.includes("CR") || upper.includes("DARI ") || upper.includes("TRANSFER MASUK")) {
      return "TRANSFER_IN";
    }
    if (isDebit || upper.includes("DB") || upper.includes("KE ") || upper.includes("TRANSFER KELUAR")) {
      return "TRANSFER_OUT";
    }
    return isCredit ? "TRANSFER_IN" : "TRANSFER_OUT";
  }

  // Fallback based strictly on directional credit/debit
  if (isCredit) return "CREDIT";
  if (isDebit) return "DEBIT";

  return "UNKNOWN";
}
