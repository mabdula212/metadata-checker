import type {
  BankTransactionParser,
  TransactionParserInput,
  ParsedTransaction,
  ReviewRow,
} from "../types";
import { parseTransactionDate } from "../utils/date-parser";
import { parseFinancialAmount } from "../utils/amount-parser";
import { extractStatementBalances } from "../utils/balance-parser";
import {
  cleanTransactionDescription,
  extractReferenceNumber,
  deriveTransactionType,
} from "../utils/text-cleaner";
import { detectCandidateRows } from "../utils/row-detector";

export class BsiTransactionParser implements BankTransactionParser {
  readonly bankCode = "BSI";
  readonly bankName = "Bank Syariah Indonesia";

  canParse(input: TransactionParserInput): boolean {
    if (input.bankCode === "BSI") return true;
    const upper = input.fullText.toUpperCase();
    return (
      upper.includes("BANK SYARIAH INDONESIA") ||
      upper.includes("BSI") ||
      upper.includes("SYARIAH")
    );
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

        const line = cand.leadLine.replace(/^[0-9\/\-\.]+\s*/, "").trim();
        const threeAmounts = line.match(/([0-9.,]+)\s+([0-9.,]+)\s+([0-9.,]+)$/);
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

          // Custom check for Islamic banking concepts
          let txType = deriveTransactionType(description, isCredit, isDebit);
          const upperDesc = description.toUpperCase();
          if (upperDesc.includes("BAGI HASIL") || upperDesc.includes("BONUS WADIAH")) {
            txType = "INTEREST";
          } else if (upperDesc.includes("ZAKAT") || upperDesc.includes("INFAQ")) {
            txType = "BILL_PAYMENT";
          }

          transactions.push({
            transactionDate: isoDate,
            rawDate: cand.dateStr,
            description,
            referenceNumber: extractReferenceNumber(fullRawDesc),
            debit: debetVal || null,
            credit: kreditVal || null,
            balance: saldoParsed.value,
            transactionType: txType,
            confidence: "HIGH",
            confidenceReasons: ["BSI 3-column match"],
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

          let txType = deriveTransactionType(description, isCredit, isDebit);
          const upperDesc = description.toUpperCase();
          if (upperDesc.includes("BAGI HASIL") || upperDesc.includes("BONUS WADIAH")) {
            txType = "INTEREST";
          }

          transactions.push({
            transactionDate: isoDate,
            rawDate: cand.dateStr,
            description,
            referenceNumber: extractReferenceNumber(fullRawDesc),
            debit: isDebit ? parsedMutasi.value : null,
            credit: isCredit ? parsedMutasi.value : null,
            balance: parsedSaldo.value,
            transactionType: txType,
            confidence: "HIGH",
            confidenceReasons: ["BSI 2-column match with indicator"],
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
