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

    let { openingBalance, closingBalance } = extractStatementBalances(input.fullText);
    let runningBalance: number | null = openingBalance ? parseFloat(openingBalance) : null;

    for (const page of input.pages) {
      const candidates = detectCandidateRows(page.text, page.pageNumber);
      totalRowsDetected += candidates.length;

      for (const cand of candidates) {
        // Special case: Initial "SALDO AWAL" line in BCA statements
        // Example: "01/08 SALDO AWAL 245,066.47"
        if (/SALDO\s+AWAL/i.test(cand.leadLine)) {
          const saldoMatch = cand.leadLine.match(/([0-9.,]+)$/);
          if (saldoMatch) {
            const parsed = parseFinancialAmount(saldoMatch[1]);
            if (parsed) {
              runningBalance = parseFloat(parsed.value);
              if (!openingBalance) {
                openingBalance = parsed.value;
              }
            }
          }
          // Do not treat opening balance record as an operational transaction
          continue;
        }

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
        // Case 1 (Full): [DATE] [DESCRIPTION + CB...] [MUTASI] [CR|DB]? [SALDO]
        // Case 2 (Omitted Saldo): [DATE] [DESCRIPTION + CB...] [MUTASI] [CR|DB]?
        // Currency amounts must be preceded by whitespace or start-of-line and not a date slash
        const dualAmountRegex = /(?:^|\s)([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?|[0-9]+[.,][0-9]{2})\s*(CR|DB)?\s+([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?|[0-9]+[.,][0-9]{2})$/i;
        const singleAmountRegex = /(?:^|\s)([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?|[0-9]+[.,][0-9]{2})\s*(CR|DB)?$/i;

        let match: RegExpMatchArray | null = null;
        let isDual = true;
        let amountLineIndex = -1;

        // In multi-line layouts, the amounts are placed at the bottom (continuation lines).
        // Check continuation lines from the bottom up first.
        if (cand.continuationLines.length > 0) {
          for (let i = cand.continuationLines.length - 1; i >= 0; i--) {
            const dualMatch = cand.continuationLines[i].match(dualAmountRegex);
            if (dualMatch) {
              match = dualMatch;
              amountLineIndex = i;
              isDual = true;
              break;
            }
            const singleMatch = cand.continuationLines[i].match(singleAmountRegex);
            if (singleMatch) {
              match = singleMatch;
              amountLineIndex = i;
              isDual = false;
              break;
            }
          }
        }

        // If no amount found on continuation lines, inspect leadLine
        if (!match) {
          const dualMatch = cand.leadLine.match(dualAmountRegex);
          if (dualMatch) {
            match = dualMatch;
            isDual = true;
            amountLineIndex = -1;
          } else {
            const singleMatch = cand.leadLine.match(singleAmountRegex);
            if (singleMatch) {
              match = singleMatch;
              isDual = false;
              amountLineIndex = -1;
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
        const rawSaldo = isDual ? match[3] : null;

        const parsedMutasi = parseFinancialAmount(rawMutasi);
        const parsedSaldo = rawSaldo ? parseFinancialAmount(rawSaldo) : null;

        if (!parsedMutasi || (isDual && !parsedSaldo)) {
          reviewRows.push({
            pageNumber: page.pageNumber,
            rawSourceText: cand.allText,
            reason: "AMBIGUOUS_AMOUNT",
            extractedFields: { rawMutasi, rawSaldo: rawSaldo || undefined },
          });
          continue;
        }

        // Determine description by stripping the date and the trailing matched amounts
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
        const upperDesc = fullRawDesc.toUpperCase();

        // Direction: In BCA, explicit CR flag or CR markers indicate credit
        let isCredit = false;
        if (rawFlag === "CR" || parsedMutasi.indicator === "CR") {
          isCredit = true;
        } else if (rawFlag === "DB" || parsedMutasi.indicator === "DB") {
          isCredit = false;
        } else if (
          upperDesc.includes("TRSF E-BANKING CR") ||
          upperDesc.includes("BI-FAST CR") ||
          upperDesc.includes("BIF TRANSFER DR") ||
          upperDesc.includes("SETORAN") ||
          upperDesc.includes("BUNGA")
        ) {
          isCredit = true;
        } else {
          // In BCA, absence of CR or presence of DB indicators defaults to Debit
          isCredit = false;
        }
        const isDebit = !isCredit;

        const debit = isDebit ? parsedMutasi.value : null;
        const credit = isCredit ? parsedMutasi.value : null;

        // Balance calculation & progression
        let balance: string | null = null;
        if (parsedSaldo) {
          balance = parsedSaldo.value;
          runningBalance = parseFloat(parsedSaldo.value);
        } else if (runningBalance !== null) {
          const mutasiNum = parseFloat(parsedMutasi.value);
          if (isCredit) {
            runningBalance += mutasiNum;
          } else {
            runningBalance -= mutasiNum;
          }
          balance = runningBalance.toFixed(2);
        }

        const safeBalance: string = balance || "0.00";

        const referenceNumber = extractReferenceNumber(fullRawDesc);
        const transactionType = deriveTransactionType(description, isCredit, isDebit);

        // Confidence calculation
        const confidenceReasons: string[] = ["Valid BCA date", "Valid amounts"];
        if (referenceNumber) confidenceReasons.push("Reference number extracted");
        if (cand.continuationLines.length > 0) confidenceReasons.push("Multi-line description joined");
        if (!isDual && balance) confidenceReasons.push("Calculated running balance");

        transactions.push({
          transactionDate: isoDate,
          rawDate: cand.dateStr,
          description,
          referenceNumber,
          debit,
          credit,
          balance: safeBalance,
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
