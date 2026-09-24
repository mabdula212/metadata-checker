import type {
  BankTransactionParser,
  TransactionParserInput,
  ParsedTransaction,
  ReviewRow,
} from "../types.js";
import { parseTransactionDate } from "../utils/date-parser.js";
import { parseFinancialAmount } from "../utils/amount-parser.js";
import { extractStatementBalances } from "../utils/balance-parser.js";
import {
  cleanTransactionDescription,
  extractReferenceNumber,
  deriveTransactionType,
} from "../utils/text-cleaner.js";
import { detectCandidateRows } from "../utils/row-detector.js";

export class BniTransactionParser implements BankTransactionParser {
  readonly bankCode = "BNI";
  readonly bankName = "Bank Negara Indonesia";

  canParse(input: TransactionParserInput): boolean {
    if (input.bankCode === "BNI") return true;
    const upper = input.fullText.toUpperCase();
    return upper.includes("BANK NEGARA INDONESIA") || upper.includes("BNI");
  }

  parse(input: TransactionParserInput) {
    const transactions: ParsedTransaction[] = [];
    const reviewRows: ReviewRow[] = [];
    let totalRowsDetected = 0;

    const { openingBalance, closingBalance } = extractStatementBalances(input.fullText);

    for (const page of input.pages) {
      const candidates = detectCandidateRows(page.text, page.pageNumber);
      totalRowsDetected += candidates.length;

      for (const cand of candidates) {
        const isoDate = parseTransactionDate(cand.dateStr, {
          statementPeriodStart: input.statementPeriodStart,
          statementPeriodEnd: input.statementPeriodEnd,
        });

        if (!isoDate) {
          reviewRows.push({
            pageNumber: page.pageNumber,
            rawSourceText: cand.allText,
            reason: "INVALID_DATE",
            extractedFields: { rawDate: cand.dateStr },
          });
          continue;
        }

        let line = cand.leadLine.replace(/^[0-9\/\-\.]+\s*/, "").trim();
        // Remove optional time token (e.g. 10:15:00)
        line = line.replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*/, "").trim();

        // Check for 3 trailing amounts: DEBET, KREDIT, SALDO
        const threeAmounts = line.match(/([0-9.,]+)\s+([0-9.,]+)\s+([0-9.,]+)$/);
        // Fallback: 2 trailing amounts (MUTASI, SALDO)
        const twoAmounts = line.match(/([0-9.,]+)\s*(CR|DB|DR)?\s+([0-9.,]+)$/i);

        if (threeAmounts) {
          const rawDebet = threeAmounts[1];
          const rawKredit = threeAmounts[2];
          const rawSaldo = threeAmounts[3];

          const debetParsed = parseFinancialAmount(rawDebet);
          const kreditParsed = parseFinancialAmount(rawKredit);
          const saldoParsed = parseFinancialAmount(rawSaldo);

          if (!saldoParsed || (!debetParsed && !kreditParsed)) {
            reviewRows.push({
              pageNumber: page.pageNumber,
              rawSourceText: cand.allText,
              reason: "AMBIGUOUS_AMOUNT",
              extractedFields: { rawDebet, rawKredit, rawSaldo },
            });
            continue;
          }

          const matchIndex = line.lastIndexOf(threeAmounts[0]);
          const leadDesc = line.slice(0, matchIndex).trim();

          const fullRawDesc = [leadDesc, ...cand.continuationLines].join("\n");
          const description = cleanTransactionDescription(fullRawDesc);

          const debetVal = debetParsed?.value !== "0.00" ? debetParsed?.value : null;
          const kreditVal = kreditParsed?.value !== "0.00" ? kreditParsed?.value : null;
          const isCredit = Boolean(kreditVal && (!debetVal || debetVal === "0.00"));
          const isDebit = Boolean(debetVal && (!kreditVal || kreditVal === "0.00"));

          transactions.push({
            transactionDate: isoDate,
            rawDate: cand.dateStr,
            description,
            referenceNumber: extractReferenceNumber(fullRawDesc),
            debit: debetVal || null,
            credit: kreditVal || null,
            balance: saldoParsed.value,
            transactionType: deriveTransactionType(description, isCredit, isDebit),
            confidence: "HIGH",
            confidenceReasons: ["BNI 3-column match"],
            pageNumber: page.pageNumber,
            rawText: cand.allText,
          });
        } else if (twoAmounts) {
          const rawMutasi = twoAmounts[1];
          const rawFlag = (twoAmounts[2] || "").toUpperCase();
          const rawSaldo = twoAmounts[3];

          const parsedMutasi = parseFinancialAmount(rawMutasi);
          const parsedSaldo = parseFinancialAmount(rawSaldo);

          if (!parsedMutasi || !parsedSaldo) {
            reviewRows.push({
              pageNumber: page.pageNumber,
              rawSourceText: cand.allText,
              reason: "AMBIGUOUS_AMOUNT",
              extractedFields: { rawMutasi, rawSaldo },
            });
            continue;
          }

          const matchIndex = line.lastIndexOf(twoAmounts[0]);
          const leadDesc = line.slice(0, matchIndex).trim();

          const fullRawDesc = [leadDesc, ...cand.continuationLines].join("\n");
          const description = cleanTransactionDescription(fullRawDesc);

          const isCredit = rawFlag === "CR" || parsedMutasi.indicator === "CR";
          const isDebit = !isCredit;

          transactions.push({
            transactionDate: isoDate,
            rawDate: cand.dateStr,
            description,
            referenceNumber: extractReferenceNumber(fullRawDesc),
            debit: isDebit ? parsedMutasi.value : null,
            credit: isCredit ? parsedMutasi.value : null,
            balance: parsedSaldo.value,
            transactionType: deriveTransactionType(description, isCredit, isDebit),
            confidence: "HIGH",
            confidenceReasons: ["BNI 2-column match with indicator"],
            pageNumber: page.pageNumber,
            rawText: cand.allText,
          });
        } else {
          reviewRows.push({
            pageNumber: page.pageNumber,
            rawSourceText: cand.allText,
            reason: "UNRECOGNIZED_ROW",
            extractedFields: { date: isoDate },
          });
        }
      }
    }

    return {
      transactions,
      reviewRows,
      totalRowsDetected,
      sourceOpeningBalance: openingBalance,
      sourceClosingBalance: closingBalance,
    };
  }
}
