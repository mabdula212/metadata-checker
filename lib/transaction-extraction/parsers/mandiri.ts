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

export class MandiriTransactionParser implements BankTransactionParser {
  readonly bankCode = "MANDIRI";
  readonly bankName = "Bank Mandiri";

  canParse(input: TransactionParserInput): boolean {
    if (input.bankCode === "MANDIRI") return true;
    const upper = input.fullText.toUpperCase();
    return upper.includes("BANK MANDIRI") || upper.includes("MANDIRI");
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
        // Date parsing
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

        // Clean leadLine if Mandiri has two consecutive dates (Posting date + Trans date)
        let line = cand.leadLine;
        const doubleDateMatch = line.match(/^(\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?)\s+(\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?)\s+/);
        if (doubleDateMatch) {
          line = line.replace(doubleDateMatch[0], "").trim();
        } else {
          line = line.replace(/^[0-9\/\-\.]+\s*/, "").trim();
        }

        // Pattern A: 3 trailing amounts (DEBET, KREDIT, SALDO)
        const threeAmounts = line.match(/([0-9.,]+)\s+([0-9.,]+)\s+([0-9.,]+)$/);
        // Pattern B: 2 trailing amounts (MUTASI [CR/DB], SALDO)
        const twoAmounts = line.match(/([0-9.,]+)\s*(CR|DB|DR|D|K)?\s+([0-9.,]+)$/i);

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
            confidenceReasons: ["Mandiri 3-column match"],
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

          const isCredit = rawFlag === "CR" || rawFlag === "K" || parsedMutasi.indicator === "CR";
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
            confidenceReasons: ["Mandiri 2-column match with indicator"],
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
