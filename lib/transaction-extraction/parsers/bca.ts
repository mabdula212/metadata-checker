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

export class BcaTransactionParser implements BankTransactionParser {
  readonly bankCode = "BCA";
  readonly bankName = "Bank Central Asia";

  canParse(input: TransactionParserInput): boolean {
    if (input.bankCode === "BCA") return true;
    const upper = input.fullText.toUpperCase();
    return (
      upper.includes("BANK CENTRAL ASIA") ||
      upper.includes("BCA") ||
      upper.includes("REKENING KORAN")
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
        // Date parsing: BCA typically uses DD/MM format
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

        // BCA Line structure:
        // [DATE] [DESCRIPTION + CB...] [MUTASI] [CR]? [SALDO]
        // Example: "01/08 SETORAN AWAL 0010 10,000,000.00 CR 10,000,000.00"
        // Example: "02/08 TRSF E-BANKING DB 0010 500,000.00 9,500,000.00"
        // In multi-line layouts, the amounts may appear at the end of lead line OR at the end of a continuation line.
        const amountTailRegex = /([0-9.,]+)\s*(CR|DB)?\s+([0-9.,]+)$/i;
        let match = cand.leadLine.match(amountTailRegex);
        let amountLineIndex = -1;

        if (!match && cand.continuationLines.length > 0) {
          for (let i = cand.continuationLines.length - 1; i >= 0; i--) {
            const contMatch = cand.continuationLines[i].match(amountTailRegex);
            if (contMatch) {
              match = contMatch;
              amountLineIndex = i;
              break;
            }
          }
        }

        if (!match) {
          reviewRows.push({
            pageNumber: page.pageNumber,
            rawSourceText: cand.allText,
            reason: "UNRECOGNIZED_ROW",
            extractedFields: { date: isoDate },
          });
          continue;
        }

        const rawMutasi = match[1];
        const rawFlag = (match[2] || "").toUpperCase();
        const rawSaldo = match[3];

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

        // Determine description by stripping the date and the trailing amounts
        let leadDesc = "";
        let otherLines: string[] = [];

        if (amountLineIndex === -1) {
          const matchIndex = cand.leadLine.lastIndexOf(match[0]);
          leadDesc = cand.leadLine.slice(0, matchIndex).trim();
          leadDesc = leadDesc.replace(/^[0-9\/\-\.]+\s*/, "").trim();
          leadDesc = leadDesc.replace(/\s+\d{4}$/, "").trim();
          otherLines = cand.continuationLines;
        } else {
          leadDesc = cand.leadLine.replace(/^[0-9\/\-\.]+\s*/, "").trim();
          const targetLine = cand.continuationLines[amountLineIndex];
          const matchIndex = targetLine.lastIndexOf(match[0]);
          const contPrefix = targetLine.slice(0, matchIndex).replace(/\s*\d{4}$/, "").trim();

          otherLines = [
            ...cand.continuationLines.slice(0, amountLineIndex),
            contPrefix,
            ...cand.continuationLines.slice(amountLineIndex + 1),
          ].filter(Boolean);
        }

        const fullRawDesc = [leadDesc, ...otherLines].join("\n");
        const description = cleanTransactionDescription(fullRawDesc);

        // Direction: In BCA, "CR" indicates Credit. Absence of "CR" (or "DB") indicates Debit.
        const isCredit = rawFlag === "CR" || parsedMutasi.indicator === "CR";
        const isDebit = !isCredit;

        const debit = isDebit ? parsedMutasi.value : null;
        const credit = isCredit ? parsedMutasi.value : null;
        const balance = parsedSaldo.value;

        const referenceNumber = extractReferenceNumber(fullRawDesc);
        const transactionType = deriveTransactionType(description, isCredit, isDebit);

        // Confidence calculation
        const confidenceReasons: string[] = ["Valid BCA date", "Valid amounts"];
        if (referenceNumber) confidenceReasons.push("Reference number extracted");
        if (cand.continuationLines.length > 0) confidenceReasons.push("Multi-line description joined");

        transactions.push({
          transactionDate: isoDate,
          rawDate: cand.dateStr,
          description,
          referenceNumber,
          debit,
          credit,
          balance,
          transactionType,
          confidence: "HIGH",
          confidenceReasons,
          pageNumber: page.pageNumber,
          rawText: cand.allText,
        });
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
