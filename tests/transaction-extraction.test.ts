import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultTransactionExtractionEngine,
  parseFinancialAmount,
  parseTransactionDate,
  validateBalanceProgression,
  extractStatementBalances,
} from "../lib/transaction-extraction";

describe("Transaction Extraction Engine", () => {
  describe("Amount Parser", () => {
    it("parses standard Indonesian dot-thousand comma-decimal format", () => {
      const res = parseFinancialAmount("1.250.000,50");
      assert.ok(res);
      assert.equal(res.value, "1250000.50");
    });

    it("parses standard English comma-thousand dot-decimal format", () => {
      const res = parseFinancialAmount("1,250,000.50");
      assert.ok(res);
      assert.equal(res.value, "1250000.50");
    });

    it("identifies CR and DB flags in amounts", () => {
      const cr = parseFinancialAmount("500.000,00 CR");
      assert.ok(cr);
      assert.equal(cr.value, "500000.00");
      assert.equal(cr.indicator, "CR");

      const db = parseFinancialAmount("250.000,00 DB");
      assert.ok(db);
      assert.equal(db.value, "250000.00");
      assert.equal(db.indicator, "DB");
    });
  });

  describe("Date Parser", () => {
    it("resolves short DD/MM dates using statement period", () => {
      const iso = parseTransactionDate("15/08", {
        statementPeriodStart: "2026-08-01",
        statementPeriodEnd: "2026-08-31",
      });
      assert.equal(iso, "2026-08-15");
    });

    it("parses Indonesian text month dates (15 Agustus 2026)", () => {
      const iso = parseTransactionDate("15 Agustus 2026");
      assert.equal(iso, "2026-08-15");
    });

    it("parses standard DD-MM-YYYY dates", () => {
      const iso = parseTransactionDate("05-09-2026");
      assert.equal(iso, "2026-09-05");
    });
  });

  describe("Balance Extraction and Progression", () => {
    it("extracts opening and closing balance from statement summary block", () => {
      const text = `
        SALDO AWAL : 5,000,000.00
        TOTAL MUTASI DB : 1,000,000.00
        TOTAL MUTASI CR : 2,000,000.00
        SALDO AKHIR : 6,000,000.00
      `;
      const { openingBalance, closingBalance } = extractStatementBalances(text);
      assert.equal(openingBalance, "5000000.00");
      assert.equal(closingBalance, "6000000.00");
    });

    it("validates mathematical balance continuity", () => {
      const transactions = [
        {
          transactionDate: "2026-08-01",
          rawDate: "01/08",
          description: "SETORAN TUNAI",
          referenceNumber: null,
          debit: null,
          credit: "1000000.00",
          balance: "2000000.00",
          transactionType: "CASH_DEPOSIT" as const,
          confidence: "HIGH" as const,
          confidenceReasons: [],
          pageNumber: 1,
          rawText: "",
        },
        {
          transactionDate: "2026-08-02",
          rawDate: "02/08",
          description: "TARIK TUNAI",
          referenceNumber: null,
          debit: "500000.00",
          credit: null,
          balance: "1500000.00",
          transactionType: "CASH_WITHDRAWAL" as const,
          confidence: "HIGH" as const,
          confidenceReasons: [],
          pageNumber: 1,
          rawText: "",
        },
      ];

      const check = validateBalanceProgression(transactions, "1000000.00", "1500000.00");
      assert.equal(check.status, "VALID");
      assert.equal(check.calculatedTotalCredit, "1000000.00");
      assert.equal(check.calculatedTotalDebit, "500000.00");
    });
  });

  describe("BCA Statement Parsing", () => {
    it("extracts multi-line BCA transactions with proper flags and categories", () => {
      const bcaText = `
        BANK CENTRAL ASIA
        REKENING KORAN
        PERIODE : 01/08/2026 s/d 31/08/2026
        NO. REKENING : 1234567890
        SALDO AWAL : 10,000,000.00
        TGL  KETERANGAN  CB  MUTASI  SALDO
        01/08  TRSF E-BANKING CR
               0108/FTSCY/WS95011
               TRANSFER DARI BUDI
               0010  5,000,000.00 CR  15,000,000.00
        02/08  BIAYA ADM BULANAN
               0010  15,000.00 DB  14,985,000.00
        SALDO AKHIR : 14,985,000.00
      `;

      const result = defaultTransactionExtractionEngine.extract({
        fullText: bcaText,
        pages: [{ pageNumber: 1, text: bcaText, characterCount: bcaText.length }],
        bankCode: "BCA",
        statementPeriodStart: "2026-08-01",
        statementPeriodEnd: "2026-08-31",
      });

      assert.equal(result.status, "COMPLETED");
      assert.equal(result.transactions.length, 2);

      const [tx1, tx2] = result.transactions;
      assert.equal(tx1.transactionDate, "2026-08-01");
      assert.equal(tx1.credit, "5000000.00");
      assert.equal(tx1.balance, "15000000.00");
      assert.equal(tx1.transactionType, "TRANSFER_IN");

      assert.equal(tx2.transactionDate, "2026-08-02");
      assert.equal(tx2.debit, "15000.00"); // 15,000.00 formatted
      assert.equal(tx2.balance, "14985000.00");
      assert.equal(tx2.transactionType, "FEE");
    });
  });

  describe("Bank Mandiri Statement Parsing", () => {
    it("extracts 3-column Mandiri transactions", () => {
      const mandiriText = `
        BANK MANDIRI
        REKENING KORAN
        PERIODE : 01/09/2026 - 30/09/2026
        SALDO AWAL : 20.000.000,00
        TANGGAL  URAIAN  NO REF  DEBIT  KREDIT  SALDO
        01/09/2026  SETORAN TUNAI VIA TELLER  REF123456  0,00  10.000.000,00  30.000.000,00
        05/09/2026  PEMBAYARAN PLN TOK  PLN987654  500.000,00  0,00  29.500.000,00
        SALDO AKHIR : 29.500.000,00
      `;

      const result = defaultTransactionExtractionEngine.extract({
        fullText: mandiriText,
        pages: [{ pageNumber: 1, text: mandiriText, characterCount: mandiriText.length }],
        bankCode: "MANDIRI",
        statementPeriodStart: "2026-09-01",
        statementPeriodEnd: "2026-09-30",
      });

      assert.equal(result.transactions.length, 2);
      assert.equal(result.transactions[0].credit, "10000000.00");
      assert.equal(result.transactions[0].balance, "30000000.00");
      assert.equal(result.transactions[1].debit, "500000.00");
      assert.equal(result.transactions[1].balance, "29500000.00");
      assert.equal(result.transactions[1].category, "Bills & Utilities");
    });
  });

  describe("BSI (Bank Syariah Indonesia) Islamic Parsing", () => {
    it("classifies Bagi Hasil and Zakat correctly", () => {
      const bsiText = `
        BANK SYARIAH INDONESIA
        SALDO AWAL : 1.000.000,00
        TGL TRANSAKSI  DESKRIPSI  DEBET  KREDIT  SALDO
        10/08/2026  BAGI HASIL TABUNGAN WADIAH  0,00  25.000,00  1.025.000,00
        11/08/2026  PEMBAYARAN ZAKAT PROFESI  50.000,00  0,00  975.000,00
        SALDO AKHIR : 975.000,00
      `;

      const result = defaultTransactionExtractionEngine.extract({
        fullText: bsiText,
        pages: [{ pageNumber: 1, text: bsiText, characterCount: bsiText.length }],
        bankCode: "BSI",
      });

      assert.equal(result.transactions.length, 2);
      assert.equal(result.transactions[0].transactionType, "INTEREST");
      assert.equal(result.transactions[1].transactionType, "BILL_PAYMENT");
    });
  });

  describe("Review Row Detection", () => {
    it("marks ambiguous rows as review rows rather than silently dropping them", () => {
      const dirtyText = `
        BANK CENTRAL ASIA
        TGL  KETERANGAN  CB  MUTASI  SALDO
        01/08  TRANSAKSI RUSAK TANPA NOMINAL DAN SALDO
        02/08  SETORAN TUNAI  0010  1,000,000.00 CR  2,000,000.00
      `;

      const result = defaultTransactionExtractionEngine.extract({
        fullText: dirtyText,
        pages: [{ pageNumber: 1, text: dirtyText, characterCount: dirtyText.length }],
        bankCode: "BCA",
      });

      assert.equal(result.transactions.length, 1);
      assert.equal(result.reviewRows.length, 1);
      assert.equal(result.reviewRows[0].reason, "UNRECOGNIZED_ROW");
    });
  });

  describe("Scanned / Image-Only Guard", () => {
    it("safely halts extraction with clear OCR requirement for scanned documents", () => {
      const result = defaultTransactionExtractionEngine.extract({
        fullText: "Scanned image placeholder",
        pages: [{ pageNumber: 1, text: "Scanned", characterCount: 7 }],
        bankCode: "BCA",
        isScannedOrImageOnly: true,
      });

      assert.equal(result.status, "NEEDS_REVIEW");
      assert.equal(result.transactions.length, 0);
      assert.ok(result.warning?.includes("image-based and requires OCR"));
    });
  });
});
