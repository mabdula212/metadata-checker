import type { BankDetector, BankDetectionInput, BankDetectionCandidate } from "../types.js";
import { extractStatementPeriod, extractAccountHolderName } from "../utils.js";

export class BniDetector implements BankDetector {
  readonly bankCode = "BNI";
  readonly bankName = "Bank Negara Indonesia";

  detect(input: BankDetectionInput): BankDetectionCandidate {
    const { fullText, metadata } = input;
    const upperText = fullText.toUpperCase();
    const matchedSignals: string[] = [];
    let score = 0;

    // 1. Metadata
    const metaAuthor = (metadata?.author || "").toUpperCase();
    const metaTitle = (metadata?.title || "").toUpperCase();
    const metaCreator = (metadata?.creator || "").toUpperCase();
    const metaProducer = (metadata?.producer || "").toUpperCase();

    let hasBniBrandOrStructure = false;

    if (
      metaAuthor.includes("BANK NEGARA INDONESIA") ||
      metaAuthor.includes("BNI") ||
      metaCreator.includes("BNI") ||
      metaTitle.includes("BNI") ||
      metaProducer.includes("BNI")
    ) {
      matchedSignals.push("BNI brand identified in PDF metadata");
      score += 35;
      hasBniBrandOrStructure = true;
    }

    // 2. Brand Identifiers in Text
    if (
      upperText.includes("PT BANK NEGARA INDONESIA (PERSERO) TBK") ||
      upperText.includes("PT BANK NEGARA INDONESIA") ||
      upperText.includes("BANK NEGARA INDONESIA") ||
      upperText.includes("BNIDIRECT") ||
      upperText.includes("WONDR BY BNI") ||
      upperText.includes("BNI CALL 1500046") ||
      upperText.includes("BNI.CO.ID")
    ) {
      matchedSignals.push("BNI institutional brand/digital platform detected");
      score += 40;
      hasBniBrandOrStructure = true;
    } else if (/\bBNI\b/.test(upperText)) {
      matchedSignals.push("BNI brand keyword present");
      score += 20;
    }

    // 3. Statement Terminology (Laporan Mutasi Rekening, Rekening Koran, Periode)
    if (upperText.includes("LAPORAN MUTASI REKENING")) {
      matchedSignals.push("BNI 'Laporan Mutasi Rekening' header matched");
      score += 25;
      hasBniBrandOrStructure = true;
    } else if (
      hasBniBrandOrStructure &&
      (upperText.includes("REKENING KORAN") ||
        upperText.includes("ELECTRONIC STATEMENT") ||
        upperText.includes("MUTASI REKENING"))
    ) {
      matchedSignals.push("BNI statement header detected");
      score += 15;
    }

    // 4. BNI Table Structure (Tanggal & Waktu, Rincian Transaksi, Nominal (IDR), Saldo (IDR))
    if (
      upperText.includes("RINCIAN TRANSAKSI") ||
      upperText.includes("NOMINAL (IDR)") ||
      upperText.includes("SALDO (IDR)") ||
      upperText.includes("TANGGAL & WAKTU")
    ) {
      matchedSignals.push("BNI distinctive table headers (Tanggal & Waktu, Rincian Transaksi, Nominal (IDR), Saldo (IDR)) detected");
      score += 25;
      hasBniBrandOrStructure = true;
    } else if (
      upperText.includes("URAIAN TRANSAKSI") ||
      (upperText.includes("TANGGAL") && upperText.includes("CABANG") && upperText.includes("SALDO"))
    ) {
      matchedSignals.push("BNI classic statement table columns matched");
      score += 15;
      hasBniBrandOrStructure = true;
    }

    // 5. BNI Summary Section (Saldo Awal, Total Pemasukan, Total Pengeluaran, Saldo Akhir, Informasi Lainnya)
    if (
      upperText.includes("TOTAL PEMASUKAN") ||
      upperText.includes("TOTAL PENGELUARAN")
    ) {
      matchedSignals.push("BNI signed summary markers (Total Pemasukan, Total Pengeluaran) detected");
      score += 20;
      hasBniBrandOrStructure = true;
    }

    if (upperText.includes("INFORMASI LAINNYA")) {
      matchedSignals.push("BNI informational section marker 'Informasi Lainnya' detected");
      score += 10;
    }

    // 6. Product Name and Account Number
    let detectedAccountNumber: string | null = null;
    let detectedProductName: string | null = null;
    let productLineIndex = -1;

    const lines = fullText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    // Pattern A: Single-line Product / Account line (e.g. "TAPLUS PEGAWAI - 1821168419")
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Stop searching header product line once we hit the transaction table
      if (/^(?:tanggal\s*&\s*waktu|rincian\s*transaksi|uraian\s*transaksi)/i.test(line)) {
        break;
      }
      const lineMatch = line.match(
        /^(?:(?:product\s*(?:\/\s*account)?|produk\s*(?:\/\s*rekening)?|nama\s*produk)\s*[:=]?\s*)?([A-Za-z][A-Za-z0-9/()&.\x20\t]{1,40}?)\s*-\s*([0-9]{8,16})(?:\s+(?:kantor\s*cabang|cabang|mata\s*uang)\b.*)?$/i
      );
      if (lineMatch && lineMatch[1] && lineMatch[2]) {
        const prodCandidate = lineMatch[1].trim();
        const accCandidate = lineMatch[2].trim();
        if (
          prodCandidate.length >= 3 &&
          !/^(?:periode|tanggal|customer|address|alamat|kantor|mata\s*uang|transfer|pembayaran|tarik|setor)/i.test(
            prodCandidate
          )
        ) {
          detectedProductName = prodCandidate.toUpperCase();
          detectedAccountNumber = accCandidate;
          productLineIndex = i;
          matchedSignals.push(`BNI product (${detectedProductName}) and account line matched`);
          score += 25;
          hasBniBrandOrStructure = true;
          break;
        }
      }
    }

    // Pattern B: Separate product name label
    if (!detectedProductName) {
      const prodMatch = fullText.match(
        /(?:nama\s*produk|product\s*name|produk|product)\s*[:=]\s*([A-Za-z0-9\x20\t-]{3,40})/i
      );
      if (prodMatch && prodMatch[1]) {
        detectedProductName = prodMatch[1].split(/\n/)[0].trim().toUpperCase();
        matchedSignals.push(`BNI product name '${detectedProductName}' detected`);
        if (hasBniBrandOrStructure) score += 10;
      }
    }

    // Pattern C: Dedicated account number label (BNI accounts are typically 10 digits)
    if (!detectedAccountNumber) {
      const accMatch = fullText.match(
        /(?:no\.?\s*rekening|nomor\s*rekening|account\s*no\.?)\s*[:=]?\s*([0-9]{9,16})\b/i
      );
      if (accMatch && accMatch[1]) {
        detectedAccountNumber = accMatch[1];
        matchedSignals.push("BNI account number format matched");
        if (hasBniBrandOrStructure || /\bBNI\b/.test(upperText)) {
          score += 15;
        }
      }
    }

    // 7. Branch / Business Unit (e.g. "Kantor Cabang: BUMI SERPONG DAMAI")
    let detectedBusinessUnit: string | null = null;
    const branchMatch = fullText.match(
      /(?:kantor\s*cabang|cabang|branch|unit\s*kerja|business\s*unit)\s*[:=]\s*([A-Za-z0-9\x20\t.,'/-]{3,50})/i
    );
    if (branchMatch && branchMatch[1]) {
      detectedBusinessUnit = branchMatch[1]
        .split(/[\r\n]|mata\s*uang|currency|valuta/i)[0]
        .trim();
      matchedSignals.push(`BNI branch '${detectedBusinessUnit}' detected`);
      if (hasBniBrandOrStructure) score += 10;
    }

    // 8. Currency (e.g. "Mata Uang: IDR")
    let detectedCurrency: string | null = null;
    const currMatch = fullText.match(
      /(?:mata\s*uang|currency|valuta)\s*[:=]\s*([A-Z]{3})\b/i
    );
    if (currMatch && currMatch[1]) {
      detectedCurrency = currMatch[1].toUpperCase();
      matchedSignals.push(`Currency '${detectedCurrency}' detected`);
      if (hasBniBrandOrStructure) score += 10;
    } else if (
      upperText.includes("NOMINAL (IDR)") ||
      upperText.includes("SALDO (IDR)") ||
      upperText.includes("IDR")
    ) {
      detectedCurrency = "IDR";
    }

    // 9. Account Holder & Period
    let detectedAccountHolder = extractAccountHolderName(fullText);

    // Fallback for unlabeled BNI header layout where Customer Name appears above Address & Product line
    if (!detectedAccountHolder && hasBniBrandOrStructure) {
      const maxSearchIdx = productLineIndex > 0 ? productLineIndex : Math.min(lines.length, 15);
      let afterHeader = false;
      for (let i = 0; i < maxSearchIdx; i++) {
        const line = lines[i];
        if (/^(?:laporan\s*mutasi\s*rekening|periode\b)/i.test(line)) {
          afterHeader = true;
          continue;
        }
        if (!afterHeader) continue;
        if (
          /^(?:pt\s*bank|bank\s*negara|bni\b|customer\s*name|address|alamat|product|produk|kantor\s*cabang|cabang|mata\s*uang|saldo\s*awal|total\s*pemasukan|tanggal)/i.test(
            line
          )
        ) {
          continue;
        }
        // Skip street addresses
        if (
          /^(?:jl\.?\b|jalan\b|rt\b|rw\b|kel\.?\b|kec\.?\b|blok\b|komp\.?\b|perum\b|apartemen\b|gedung\b|no\.\s*\d)/i.test(
            line
          ) ||
          /\d{3,}/.test(line)
        ) {
          continue;
        }
        if (/^[A-Za-z][A-Za-z\x20\t.,'-]{2,50}$/.test(line)) {
          detectedAccountHolder = line.toUpperCase();
          break;
        }
      }
    }

    const period = extractStatementPeriod(fullText);
    if (period.signal) {
      matchedSignals.push(period.signal);
      if (hasBniBrandOrStructure) score += 10;
    }

    let confidence: "LOW" | "MEDIUM" | "HIGH" = "LOW";
    if (score >= 60) {
      confidence = "HIGH";
    } else if (score >= 35) {
      confidence = "MEDIUM";
    }

    return {
      bankCode: this.bankCode,
      bankName: this.bankName,
      matchedSignals,
      score,
      confidence,
      detectedAccountNumber,
      detectedAccountHolder,
      detectedPeriodStart: period.start,
      detectedPeriodEnd: period.end,
      productName: detectedProductName,
      businessUnit: detectedBusinessUnit,
      currency: detectedCurrency,
    };
  }
}
