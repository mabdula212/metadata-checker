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

export class BriTransactionParser implements BankTransactionParser {
  readonly bankCode = "BRI";
  readonly bankName = "Bank Rakyat Indonesia";

  canParse(input: TransactionParserInput): boolean {
    if (input.bankCode === "BRI") return true;
    const upper = input.fullText.toUpperCase();
    return upper.includes("BANK RAKYAT INDONESIA") || upper.includes("BRI");
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

        // BRI typically has 3 trailing amounts: DEBET, KREDIT, SALDO
        // Example: "02/08/2026 TRSF E-BANKING 00998877 0.00 5,000,000.00 5,000,000.00"
        // Regex to capture 3 amounts at the end of the line:
        const threeAmountsRegex = /([0-9.,]+)\s+([0-9.,]+)\s+([0-9.,]+)$/;
        const match = cand.leadLine.match(threeAmountsRegex);

        if (match) {
          const rawDebet = match[1];
          const rawKredit = match[2];
          const rawSaldo = match[3];

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

          const matchIndex = cand.leadLine.lastIndexOf(match[0]);
          let leadDesc = cand.leadLine.slice(0, matchIndex).trim();
          leadDesc = leadDesc.replace(/^[0-9\/\-\.]+\s*/, "").trim();

          const fullRawDesc = [leadDesc, ...cand.continuationLines].join("\n");
          const description = cleanTransactionDescription(fullRawDesc);

          const debetVal = debetParsed?.value !== "0.00" ? debetParsed?.value : null;
          const kreditVal = kreditParsed?.value !== "0.00" ? kreditParsed?.value : null;
          const isCredit = Boolean(kreditVal && (!debetVal || debetVal === "0.00"));
          const isDebit = Boolean(debetVal && (!kreditVal || kreditVal === "0.00"));

          const referenceNumber = extractReferenceNumber(fullRawDesc);
          const transactionType = deriveTransactionType(description, isCredit, isDebit);

          transactions.push({
            transactionDate: isoDate,
            rawDate: cand.dateStr,
            description,
            referenceNumber,
            debit: debetVal || null,
            credit: kreditVal || null,
            balance: saldoParsed.value,
            transactionType,
            confidence: "HIGH",
            confidenceReasons: ["BRI 3-column match (Debet, Kredit, Saldo)"],
            pageNumber: page.pageNumber,
            rawText: cand.allText,
          });
        } else {
          // Fallback check: maybe 2 amounts (Mutasi + Saldo)
          const twoAmountsRegex = /([0-9.,]+)\s*(CR|DB)?\s+([0-9.,]+)$/i;
          const match2 = cand.leadLine.match(twoAmountsRegex);

          if (match2) {
            const rawMutasi = match2[1];
            const rawFlag = (match2[2] || "").toUpperCase();
            const rawSaldo = match2[3];

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

            const matchIndex = cand.leadLine.lastIndexOf(match2[0]);
            let leadDesc = cand.leadLine.slice(0, matchIndex).trim();
            leadDesc = leadDesc.replace(/^[0-9\/\-\.]+\s*/, "").trim();

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
              confidence: "MEDIUM",
              confidenceReasons: ["BRI 2-column fallback match"],
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
