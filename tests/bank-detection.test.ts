import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultBankDetectionEngine,
  maskAccountNumber,
  parseIndonesianOrEnglishDate,
  extractStatementPeriod,
} from "../lib/bank-detection";
import type { PdfTextExtractionResult } from "../lib/pdf/pdf-text-extractor";

function mockExtraction(text: string, pagesCount = 1): PdfTextExtractionResult {
  const chars = text.replace(/\s+/g, "").length;
  return {
    totalPages: pagesCount,
    pages: [{ pageNumber: 1, text, characterCount: text.length }],
    fullText: text,
    isScannedOrImageOnly: chars < 25,
    totalCharacterCount: chars,
  };
}

describe("Bank Detection Engine", () => {
  it("correctly identifies a BCA bank statement with high confidence", () => {
    const bcaText = `
      BANK CENTRAL ASIA
      REKENING KORAN
      PERIODE : 01/08/2026 s/d 31/08/2026
      NO. REKENING : 1234567890
      NAMA : PT MAJU JAYA ABADI
      HALOBCA 1500888
      TGL  KETERANGAN  CB  MUTASI  SALDO
      01/08  SETORAN AWAL  0010  10,000,000.00 CR  10,000,000.00
      SALDO AWAL : 0.00
      MUTASI CR : 10,000,000.00
      MUTASI DB : 0.00
      SALDO AKHIR : 10,000,000.00
    `;

    const result = defaultBankDetectionEngine.detect(mockExtraction(bcaText));

    assert.equal(result.documentType, "BANK_STATEMENT");
    assert.equal(result.bankCode, "BCA");
    assert.equal(result.bankName, "Bank Central Asia");
    assert.equal(result.confidence, "HIGH");
    assert.equal(result.accountNumberMasked, "******7890");
    assert.equal(result.statementPeriodStart, "2026-08-01");
    assert.equal(result.statementPeriodEnd, "2026-08-31");
    assert.equal(result.accountHolderName, "PT MAJU JAYA ABADI");
    assert.ok(result.matchedSignals.length >= 3);
  });

  it("correctly identifies a BRI bank statement and formats 15-digit account", () => {
    const briText = `
      PT BANK RAKYAT INDONESIA (PERSERO) TBK
      REKENING KORAN
      PERIODE TRANSAKSI : 01 Agustus 2026 s.d. 31 Agustus 2026
      NO. REKENING : 0018-01-000123-50-1
      NAMA NASABAH : BUDI SANTOSO
      CALL BRI 14017
      TANGGAL TRANSAKSI  URAIAN TRANSAKSI  CHQ/NO REF  DEBET  KREDIT  SALDO
      02/08/2026  TRSF E-BANKING  00998877  0.00  5,000,000.00  5,000,000.00
      TOTAL DEBET : 0.00
      TOTAL KREDIT : 5,000,000.00
    `;

    const result = defaultBankDetectionEngine.detect(mockExtraction(briText));

    assert.equal(result.documentType, "BANK_STATEMENT");
    assert.equal(result.bankCode, "BRI");
    assert.equal(result.bankName, "Bank Rakyat Indonesia");
    assert.equal(result.confidence, "HIGH");
    assert.equal(result.accountNumberMasked, "***********3501");
    assert.equal(result.statementPeriodStart, "2026-08-01");
    assert.equal(result.statementPeriodEnd, "2026-08-31");
    assert.equal(result.accountHolderName, "BUDI SANTOSO");
  });

  it("correctly identifies a Bank Mandiri statement", () => {
    const mandiriText = `
      PT BANK MANDIRI (PERSERO) TBK
      REKENING KORAN
      STATEMENT PERIOD : 01/07/2026 - 31/07/2026
      ACCOUNT NUMBER : 1370001234567
      NAMA NASABAH : CITRA LESTARI
      LIVIN' BY MANDIRI
      MANDIRI CALL 14000
      TANGGAL POSTING  TANGGAL TRANSAKSI  KETERANGAN  DEBET (DR)  KREDIT (CR)  SALDO (BAL)
      01/07/2026  01/07/2026  PEMINDAHBUKUAN  0.00  2,500,000.00  2,500,000.00
    `;

    const result = defaultBankDetectionEngine.detect(mockExtraction(mandiriText));

    assert.equal(result.documentType, "BANK_STATEMENT");
    assert.equal(result.bankCode, "MANDIRI");
    assert.equal(result.confidence, "HIGH");
    assert.equal(result.accountNumberMasked, "*********4567");
    assert.equal(result.statementPeriodStart, "2026-07-01");
    assert.equal(result.statementPeriodEnd, "2026-07-31");
    assert.equal(result.accountHolderName, "CITRA LESTARI");
  });

  it("correctly identifies a BNI statement", () => {
    const bniText = `
      PT BANK NEGARA INDONESIA (PERSERO) TBK
      ELECTRONIC STATEMENT BNI
      PERIODE : 01/05/2026 s/d 31/05/2026
      NO. REKENING : 0192837465
      NAMA : SITI RAHMAWATI
      BNI CALL 1500046
      TANGGAL  JAM  URAIAN TRANSAKSI  CABANG  DEBET  KREDIT  SALDO
      05/05/2026  10:15:00  SETOR TUNAI  0045  0.00  1,000,000.00  1,000,000.00
    `;

    const result = defaultBankDetectionEngine.detect(mockExtraction(bniText));

    assert.equal(result.documentType, "BANK_STATEMENT");
    assert.equal(result.bankCode, "BNI");
    assert.equal(result.confidence, "HIGH");
    assert.equal(result.accountNumberMasked, "******7465");
  });

  it("classifies non-financial documents as OTHER_PDF without false bank matches", () => {
    const resumeText = `
      CURRICULUM VITAE
      Jane Doe - Senior Full Stack Software Engineer
      Jakarta, Indonesia
      SUMMARY:
      Passionate developer with 7 years of experience in React, Node.js, and TypeScript.
      EXPERIENCE:
      Lead Engineer at Tech Corp (2021 - Present)
      - Architected distributed microservices and database clustering.
      - Mentored junior engineers and designed internal developer tooling.
      EDUCATION:
      Bachelor of Computer Science, Universitas Indonesia
    `;

    const result = defaultBankDetectionEngine.detect(mockExtraction(resumeText));

    assert.equal(result.documentType, "OTHER_PDF");
    assert.equal(result.bankCode, null);
    assert.equal(result.bankName, null);
    assert.equal(result.confidence, "LOW");
    assert.ok(result.notDetectedReason?.includes("does not contain bank statement"));
  });

  it("handles missing statement period gracefully without guessing", () => {
    const bcaNoPeriodText = `
      BANK CENTRAL ASIA
      MUTASI REKENING
      NO. REKENING : 0881234567
      NAMA : ANDI WIJAYA
      KLIKBCA
      TGL  KETERANGAN  CB  MUTASI  SALDO
      15/09  TRANSFER MASUK  0010  500,000.00 CR  500,000.00
      SALDO AWAL : 0.00
      SALDO AKHIR : 500,000.00
    `;

    const result = defaultBankDetectionEngine.detect(mockExtraction(bcaNoPeriodText));

    assert.equal(result.bankCode, "BCA");
    assert.equal(result.statementPeriodStart, null);
    assert.equal(result.statementPeriodEnd, null);
  });

  it("handles ambiguous bank text safely", () => {
    const ambiguousText = `
      REKENING KORAN
      SALDO AWAL: 1,000,000
      SALDO AKHIR: 2,000,000
      DEBET: 0
      KREDIT: 1,000,000
      Transfer antar bank dari BCA ke BRI via Mandiri
    `;

    const result = defaultBankDetectionEngine.detect(mockExtraction(ambiguousText));

    assert.equal(result.documentType, "BANK_STATEMENT");
    // With no decisive bank winner, bankCode is null or marked ambiguous
    assert.ok(result.confidence === "LOW" || result.bankCode === null);
  });

  it("flags scanned or image-only PDFs with OCR warning", () => {
    const scannedExtraction: PdfTextExtractionResult = {
      totalPages: 3,
      pages: [
        { pageNumber: 1, text: "", characterCount: 0 },
        { pageNumber: 2, text: "", characterCount: 0 },
        { pageNumber: 3, text: "Page 3", characterCount: 6 },
      ],
      fullText: "Page 3",
      isScannedOrImageOnly: true,
      totalCharacterCount: 5,
      warning:
        "This PDF appears to contain scanned images rather than selectable text. Transaction extraction may require OCR.",
    };

    const result = defaultBankDetectionEngine.detect(scannedExtraction);

    assert.equal(result.isScannedOrImageOnly, true);
    assert.equal(result.documentType, "UNKNOWN");
    assert.ok(result.warning?.includes("OCR"));
  });

  it("validates account number masking security", () => {
    assert.equal(maskAccountNumber("1234567890"), "******7890");
    assert.equal(maskAccountNumber("0018-01-000123-50-1"), "***********3501");
    assert.equal(maskAccountNumber("123"), null);
    assert.equal(maskAccountNumber(null), null);
    assert.equal(maskAccountNumber(undefined), null);
  });

  it("validates date extraction with Indonesian month names", () => {
    assert.equal(parseIndonesianOrEnglishDate("01 Agustus 2026"), "2026-08-01");
    assert.equal(parseIndonesianOrEnglishDate("31 Desember 2026"), "2026-12-31");
    assert.equal(parseIndonesianOrEnglishDate("15/03/2026"), "2026-03-15");
    assert.equal(parseIndonesianOrEnglishDate("invalid"), null);

    const period = extractStatementPeriod(
      "Periode Transaksi : 01 Agustus 2026 s.d. 31 Agustus 2026"
    );
    assert.equal(period.start, "2026-08-01");
    assert.equal(period.end, "2026-08-31");
  });
});
