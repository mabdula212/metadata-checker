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
    let runningBalance: number | null = openingBalance ? parseFloat(openingBalance) : null;

    // Currency pattern to match monetary amounts with decimals, avoiding account numbers or references
    const currencyPattern = "(?:[0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})|[0-9]+[.,][0-9]{2})";
    const threeAmountsRegex = new RegExp(`(?:^|\\s)(${currencyPattern})\\s+(${currencyPattern})\\s+(${currencyPattern})$`, "i");
    const twoAmountsRegex = new RegExp(`(?:^|\\s)(${currencyPattern})\\s*(\\([CD]R?\\)|CR|DB|DR|[CD]|\\+|\\-)?\\s+(${currencyPattern})$`, "i");
    const singleAmountRegex = new RegExp(`(?:^|\\s)(${currencyPattern})\\s*(\\([CD]R?\\)|CR|DB|DR|[CD]|\\+|\\-)?$`, "i");

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

        // Check continuation lines from bottom up first, then leadLine
        let match3: RegExpMatchArray | null = null;
        let match2: RegExpMatchArray | null = null;
        let match1: RegExpMatchArray | null = null;
        let amountLineIndex = -1; // -1 means on cand.leadLine

        if (cand.continuationLines.length > 0) {
          for (let i = cand.continuationLines.length - 1; i >= 0; i--) {
            const line = cand.continuationLines[i];
            const m3 = line.match(threeAmountsRegex);
            if (m3) {
              match3 = m3;
              amountLineIndex = i;
              break;
            }
            const m2 = line.match(twoAmountsRegex);
            if (m2) {
              match2 = m2;
              amountLineIndex = i;
              break;
            }
            const m1 = line.match(singleAmountRegex);
            if (m1) {
              match1 = m1;
              amountLineIndex = i;
              break;
            }
          }
        }

        // If not found in continuation lines, check leadLine
        if (!match3 && !match2 && !match1) {
          match3 = cand.leadLine.match(threeAmountsRegex);
          if (!match3) {
            match2 = cand.leadLine.match(twoAmountsRegex);
            if (!match2) {
              match1 = cand.leadLine.match(singleAmountRegex);
            }
          }
          amountLineIndex = -1;
        }

        // 1. Process 3-column format: DEBET, KREDIT, SALDO
        if (match3) {
          const rawDebet = match3[1];
          const rawKredit = match3[2];
          const rawSaldo = match3[3];

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

          let leadDesc = "";
          let otherLines: string[] = [];

          if (amountLineIndex === -1) {
            const matchIndex = cand.leadLine.lastIndexOf(match3[0]);
            leadDesc = cand.leadLine.slice(0, matchIndex).trim();
            leadDesc = leadDesc.replace(/^[0-9\/\-\.]+\s*(?:\d{1,2}:\d{2}(?::\d{2})?\s*)?/, "").trim();
            otherLines = cand.continuationLines;
          } else {
            leadDesc = cand.leadLine.replace(/^[0-9\/\-\.]+\s*(?:\d{1,2}:\d{2}(?::\d{2})?\s*)?/, "").trim();
            const targetLine = cand.continuationLines[amountLineIndex];
            const matchIndex = targetLine.lastIndexOf(match3[0]);
            const contPrefix = targetLine.slice(0, matchIndex).trim();
            otherLines = [
              ...cand.continuationLines.slice(0, amountLineIndex),
              contPrefix,
              ...cand.continuationLines.slice(amountLineIndex + 1),
            ].filter(Boolean);
          }

          const fullRawDesc = [leadDesc, ...otherLines].join("\n");
          const description = cleanTransactionDescription(fullRawDesc);

          const debetVal = debetParsed?.value !== "0.00" ? debetParsed?.value : null;
          const kreditVal = kreditParsed?.value !== "0.00" ? kreditParsed?.value : null;
          const isCredit = Boolean(kreditVal && (!debetVal || debetVal === "0.00"));
          const isDebit = Boolean(debetVal && (!kreditVal || kreditVal === "0.00"));

          runningBalance = parseFloat(saldoParsed.value);

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
          continue;
        }

        // 2. Process 2-column format: MUTASI, SALDO (with optional flags)
        if (match2) {
          const rawMutasi = match2[1];
          const rawFlag = (match2[2] || "").toUpperCase().replace(/[()]/g, "");
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

          let leadDesc = "";
          let otherLines: string[] = [];

          if (amountLineIndex === -1) {
            const matchIndex = cand.leadLine.lastIndexOf(match2[0]);
            leadDesc = cand.leadLine.slice(0, matchIndex).trim();
            leadDesc = leadDesc.replace(/^[0-9\/\-\.]+\s*(?:\d{1,2}:\d{2}(?::\d{2})?\s*)?/, "").trim();
            otherLines = cand.continuationLines;
          } else {
            leadDesc = cand.leadLine.replace(/^[0-9\/\-\.]+\s*(?:\d{1,2}:\d{2}(?::\d{2})?\s*)?/, "").trim();
            const targetLine = cand.continuationLines[amountLineIndex];
            const matchIndex = targetLine.lastIndexOf(match2[0]);
            const contPrefix = targetLine.slice(0, matchIndex).trim();
            otherLines = [
              ...cand.continuationLines.slice(0, amountLineIndex),
              contPrefix,
              ...cand.continuationLines.slice(amountLineIndex + 1),
            ].filter(Boolean);
          }

          const fullRawDesc = [leadDesc, ...otherLines].join("\n");
          const description = cleanTransactionDescription(fullRawDesc);
          const upperDesc = fullRawDesc.toUpperCase();

          // Determine Debit vs Credit
          let isCredit = false;
          if (rawFlag.includes("CR") || rawFlag === "C" || parsedMutasi.indicator === "CR") {
            isCredit = true;
          } else if (rawFlag.includes("DB") || rawFlag.includes("DR") || rawFlag === "D" || parsedMutasi.indicator === "DB" || parsedMutasi.isNegative) {
            isCredit = false;
          } else if (runningBalance !== null) {
            // Evaluate balance change
            const currentSaldo = parseFloat(parsedSaldo.value);
            const delta = Math.round((currentSaldo - runningBalance) * 100) / 100;
            if (delta > 0.01) {
              isCredit = true;
            } else if (delta < -0.01) {
              isCredit = false;
            } else {
              isCredit = /TRANSFER MASUK|TRANSFER DARI|SETORAN|BUNGA|BAGI HASIL|KREDIT|REVERSAL/i.test(upperDesc);
            }
          } else {
            // Evaluate description keywords
            if (/TRANSFER MASUK|TRANSFER DARI|SETORAN|BUNGA|BAGI HASIL|KREDIT|REVERSAL/i.test(upperDesc)) {
              isCredit = true;
            } else {
              // Default outflow / debit for transfers out, purchases, fees, admin, etc.
              isCredit = false;
            }
          }

          const isDebit = !isCredit;
          runningBalance = parseFloat(parsedSaldo.value);

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
            confidenceReasons: ["BRI 2-column statement match (Mutasi, Saldo)"],
            pageNumber: page.pageNumber,
            rawText: cand.allText,
          });
          continue;
        }

        // 3. Process 1-column fallback format: MUTASI (with running balance tracking)
        if (match1) {
          const rawMutasi = match1[1];
          const rawFlag = (match1[2] || "").toUpperCase().replace(/[()]/g, "");
          const parsedMutasi = parseFinancialAmount(rawMutasi);

          if (!parsedMutasi) {
            reviewRows.push({
              pageNumber: page.pageNumber,
              rawSourceText: cand.allText,
              reason: "AMBIGUOUS_AMOUNT",
              extractedFields: { rawMutasi },
            });
            continue;
          }

          let leadDesc = "";
          let otherLines: string[] = [];

          if (amountLineIndex === -1) {
            const matchIndex = cand.leadLine.lastIndexOf(match1[0]);
            leadDesc = cand.leadLine.slice(0, matchIndex).trim();
            leadDesc = leadDesc.replace(/^[0-9\/\-\.]+\s*(?:\d{1,2}:\d{2}(?::\d{2})?\s*)?/, "").trim();
            otherLines = cand.continuationLines;
          } else {
            leadDesc = cand.leadLine.replace(/^[0-9\/\-\.]+\s*(?:\d{1,2}:\d{2}(?::\d{2})?\s*)?/, "").trim();
            const targetLine = cand.continuationLines[amountLineIndex];
            const matchIndex = targetLine.lastIndexOf(match1[0]);
            const contPrefix = targetLine.slice(0, matchIndex).trim();
            otherLines = [
              ...cand.continuationLines.slice(0, amountLineIndex),
              contPrefix,
              ...cand.continuationLines.slice(amountLineIndex + 1),
            ].filter(Boolean);
          }

          const fullRawDesc = [leadDesc, ...otherLines].join("\n");
          const description = cleanTransactionDescription(fullRawDesc);
          const upperDesc = fullRawDesc.toUpperCase();

          let isCredit = false;
          if (rawFlag.includes("CR") || rawFlag === "C" || parsedMutasi.indicator === "CR") {
            isCredit = true;
          } else if (rawFlag.includes("DB") || rawFlag.includes("DR") || rawFlag === "D" || parsedMutasi.indicator === "DB" || parsedMutasi.isNegative) {
            isCredit = false;
          } else {
            isCredit = /TRANSFER MASUK|TRANSFER DARI|SETORAN|BUNGA|BAGI HASIL|KREDIT|REVERSAL/i.test(upperDesc);
          }

          const isDebit = !isCredit;
          const mutasiNum = parseFloat(parsedMutasi.value);

          let balanceStr = "0.00";
          if (runningBalance !== null) {
            runningBalance = isCredit ? runningBalance + mutasiNum : runningBalance - mutasiNum;
            balanceStr = runningBalance.toFixed(2);
          }

          transactions.push({
            transactionDate: isoDate,
            rawDate: cand.dateStr,
            description,
            referenceNumber: extractReferenceNumber(fullRawDesc),
            debit: isDebit ? parsedMutasi.value : null,
            credit: isCredit ? parsedMutasi.value : null,
            balance: balanceStr,
            transactionType: deriveTransactionType(description, isCredit, isDebit),
            confidence: "MEDIUM",
            confidenceReasons: ["BRI single-amount progression match"],
            pageNumber: page.pageNumber,
            rawText: cand.allText,
          });
          continue;
        }

        // Unrecognized row
        reviewRows.push({
          pageNumber: page.pageNumber,
          rawSourceText: cand.allText,
          reason: "UNRECOGNIZED_ROW",
          extractedFields: { date: isoDate },
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
