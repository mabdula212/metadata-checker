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

    const bniSignalsDetected =
      input.bankCode === "BNI" ||
      input.fullText.toUpperCase().includes("BNI") ||
      input.fullText.toUpperCase().includes("BANK NEGARA INDONESIA");

    console.log("[BNI_PIPELINE] decrypted PDF available");
    console.log(`[BNI_PIPELINE] page count = ${input.pages.length}`);
    console.log("[BNI_PIPELINE] text extraction completed");
    console.log(`[BNI_PIPELINE] BNI signals detected = ${bniSignalsDetected}`);

    const {
      openingBalance,
      closingBalance,
      summaryTotalDebit,
      summaryTotalCredit,
    } = extractStatementBalances(input.fullText);

    const threeAmountsEndRegex =
      /(?:^|\s)([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})|[0-9]+[.,][0-9]{2})\s+([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})|[0-9]+[.,][0-9]{2})\s+([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})|[0-9]+[.,][0-9]{2})$/;

    const signedPairEndRegex =
      /(?:^|\s)([+\-]?[0-9]{1,3}(?:[.,][0-9]{3})+(?:[.,][0-9]{2})?|[+\-][0-9]+(?:[.,][0-9]{2})?|[+\-]?[0-9]{1,3}(?:[.,][0-9]{2})?)\s+([0-9]{1,3}(?:[.,][0-9]{3})+(?:[.,][0-9]{2})?|[0-9]{1,3}(?:[.,][0-9]{2})?|[0-9]+[.,][0-9]{2})$/;

    const standaloneSignedNomRegex =
      /^([+\-]?[0-9]{1,3}(?:[.,][0-9]{3})+(?:[.,][0-9]{2})?|[+\-][0-9]+(?:[.,][0-9]{2})?|[+\-]?[0-9]{1,3}(?:[.,][0-9]{2})?)$/;

    const standaloneSaldoRegex =
      /^([0-9]{1,3}(?:[.,][0-9]{3})+(?:[.,][0-9]{2})?|[0-9]{1,3}(?:[.,][0-9]{2})?|[0-9]+[.,][0-9]{2})$/;

    for (const page of input.pages) {
      const candidates = detectCandidateRows(page.text, page.pageNumber);
      totalRowsDetected += candidates.length;

      for (const cand of candidates) {
        // Exclude system summaries, disclaimers, or notes
        if (
          /^(?:informasi\s*lainnya|saldo\s*awal|saldo\s*akhir|total\s*pemasukan|total\s*pengeluaran|ojk|lps|halaman|page)/i.test(
            cand.leadLine
          )
        ) {
          continue;
        }

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

        // Clean candidate lines: strip date from first line, strip time tokens (e.g. "23:59:59 WIB"),
        // and filter out footer/header noise
        const rawLines = [cand.leadLine, ...cand.continuationLines]
          .map((l) => l.trim())
          .filter(
            (l) =>
              l.length > 0 &&
              !/^(?:informasi\s*lainnya|\d+\.\s|\f|halaman|page\s*\d+|ojk|lps|tanggal\s*&\s*waktu|rincian\s*transaksi|nominal\s*\(idr\)|saldo\s*\(idr\))/i.test(
                l
              )
          );

        const cleanLines: string[] = [];
        for (let i = 0; i < rawLines.length; i++) {
          let line = rawLines[i];
          if (i === 0) {
            if (line.toLowerCase().startsWith(cand.dateStr.toLowerCase())) {
              line = line.slice(cand.dateStr.length).trim();
            } else {
              line = line
                .replace(
                  /^(\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?|\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{2,4})?|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\s*/i,
                  ""
                )
                .trim();
            }
          }
          // Strip leading or standalone time token (e.g. "23:59:59 WIB" or "10:15:00")
          line = line
            .replace(/^\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:WIB|WITA|WIT))?\b\s*/i, "")
            .trim();
          if (line.length > 0) {
            cleanLines.push(line);
          }
        }

        const lineContent = cleanLines.join(" ");

        // ---------------------------------------------------------------------
        // Check Pattern 1: Classic 3 trailing amounts: DEBET, KREDIT, SALDO
        // ---------------------------------------------------------------------
        let match3: RegExpMatchArray | null = null;
        let match3LineIdx = -1;
        for (let i = cleanLines.length - 1; i >= 0; i--) {
          const m = cleanLines[i].match(threeAmountsEndRegex);
          if (m) {
            match3 = m;
            match3LineIdx = i;
            break;
          }
        }

        if (match3 && match3LineIdx !== -1) {
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

          const descLines = [...cleanLines];
          const targetLine = descLines[match3LineIdx];
          const cutIdx = targetLine.lastIndexOf(match3[0]);
          descLines[match3LineIdx] = targetLine.slice(0, cutIdx).trim();
          const fullRawDesc = descLines.filter(Boolean).join("\n");
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
          continue;
        }

        // ---------------------------------------------------------------------
        // Check Pattern 2: Signed Nominal format (Laporan Mutasi Rekening)
        // Columns: Nominal (IDR), Saldo (IDR)
        // e.g. "-2,500 23,911" or "+10,000 33,911" or "0 23,911"
        // Supports amounts on leadLine, continuationLine, or two consecutive lines.
        // ---------------------------------------------------------------------
        let signedNominal: string | null = null;
        let signedSaldo: string | null = null;
        let signedDesc = "";

        // 2a. Check if any line in cleanLines ends with <signedNominal> <saldo>
        let matchedPairLineIdx = -1;
        let matchedPair: RegExpMatchArray | null = null;
        for (let i = cleanLines.length - 1; i >= 0; i--) {
          const m = cleanLines[i].match(signedPairEndRegex);
          if (m) {
            const pNom = parseFinancialAmount(m[1]);
            const pSal = parseFinancialAmount(m[2]);
            if (pNom && pSal) {
              matchedPair = m;
              matchedPairLineIdx = i;
              break;
            }
          }
        }

        if (matchedPair && matchedPairLineIdx !== -1) {
          signedNominal = matchedPair[1].trim();
          signedSaldo = matchedPair[2].trim();

          const descLines = [...cleanLines];
          const targetLine = descLines[matchedPairLineIdx];
          const cutIdx = targetLine.lastIndexOf(matchedPair[0]);
          descLines[matchedPairLineIdx] = targetLine.slice(0, cutIdx).trim();
          signedDesc = descLines.filter(Boolean).join("\n");
        } else if (cleanLines.length >= 2) {
          // 2b. Check if two consecutive lines in cleanLines are standalone Nominal and Saldo
          for (let i = cleanLines.length - 2; i >= 0; i--) {
            const lNom = cleanLines[i];
            const lSal = cleanLines[i + 1];
            if (standaloneSignedNomRegex.test(lNom) && standaloneSaldoRegex.test(lSal)) {
              const pNom = parseFinancialAmount(lNom);
              const pSal = parseFinancialAmount(lSal);
              if (pNom && pSal) {
                signedNominal = lNom;
                signedSaldo = lSal;
                const descLines = cleanLines.filter((_, idx) => idx !== i && idx !== i + 1);
                signedDesc = descLines.filter(Boolean).join("\n");
                break;
              }
            }
          }
        }

        if (signedNominal && signedSaldo) {
          const isNegative = signedNominal.startsWith("-");
          const pNom = parseFinancialAmount(signedNominal);
          const pSal = parseFinancialAmount(signedSaldo);
          const isZero = pNom?.value === "0.00";

          const debit = isNegative && !isZero ? pNom!.value : null;
          const credit = !isNegative && !isZero ? pNom!.value : null;
          const transactionType = isZero ? "UNKNOWN" : isNegative ? "DEBIT" : "CREDIT";

          transactions.push({
            transactionDate: isoDate,
            rawDate: cand.dateStr,
            description: cleanTransactionDescription(signedDesc),
            referenceNumber: extractReferenceNumber(signedDesc || cand.allText),
            debit,
            credit,
            balance: pSal!.value,
            transactionType,
            confidence: "HIGH",
            confidenceReasons: ["BNI signed nominal match"],
            pageNumber: page.pageNumber,
            rawText: cand.allText,
          });
          continue;
        }

        // ---------------------------------------------------------------------
        // Check Pattern 3: Fallback 2 amounts with suffix indicator (MUTASI, SALDO, [CR|DB])
        // ---------------------------------------------------------------------
        const twoAmountsSuffix = lineContent.match(/([0-9.,]+)\s+([0-9.,]+)\s*(CR|DB|DR)$/i);
        if (twoAmountsSuffix) {
          const rawMutasi = twoAmountsSuffix[1];
          const rawSaldo = twoAmountsSuffix[2];
          const rawFlag = (twoAmountsSuffix[3] || "").toUpperCase();

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

          const matchIndex = lineContent.lastIndexOf(twoAmountsSuffix[0]);
          const leadDesc = lineContent.slice(0, matchIndex).trim();

          const fullRawDesc = [
            leadDesc,
            ...cand.continuationLines.filter((l) => !l.includes(twoAmountsSuffix[0])),
          ].join("\n");
          const description = cleanTransactionDescription(fullRawDesc || leadDesc);

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
            confidenceReasons: ["BNI 2-column match with suffix indicator"],
            pageNumber: page.pageNumber,
            rawText: cand.allText,
          });
          continue;
        }

        // ---------------------------------------------------------------------
        // Check Pattern 4: Fallback 2 amounts with indicator in middle (MUTASI, [CR|DB], SALDO)
        // ---------------------------------------------------------------------
        const twoAmounts = lineContent.match(/([0-9.,]+)\s*(CR|DB|DR)?\s+([0-9.,]+)$/i);
        if (twoAmounts) {
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

          const matchIndex = lineContent.lastIndexOf(twoAmounts[0]);
          const leadDesc = lineContent.slice(0, matchIndex).trim();

          const fullRawDesc = [
            leadDesc,
            ...cand.continuationLines.filter((l) => !l.includes(twoAmounts[0])),
          ].join("\n");
          const description = cleanTransactionDescription(fullRawDesc || leadDesc);

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

    console.log(`[BNI_PIPELINE] candidate transaction rows = ${totalRowsDetected}`);
    console.log(`[BNI_PIPELINE] parsed transactions = ${transactions.length}`);
    console.log(`[BNI_PIPELINE] needs review = ${reviewRows.length}`);

    return {
      transactions,
      reviewRows,
      totalRowsDetected,
      sourceOpeningBalance: openingBalance,
      sourceClosingBalance: closingBalance,
      sourceTotalCredit: summaryTotalCredit || null,
      sourceTotalDebit: summaryTotalDebit || null,
    };
  }
}
