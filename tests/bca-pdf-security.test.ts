import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { encryptPDF } from "@pdfsmaller/pdf-encrypt";
import {
  detectEncryption,
  decryptPdf,
  createProcessedPdf,
  type ProcessedPdf,
} from "../lib/pdf/pdf-decryptor.js";
import { inspectPdfMetadata, calculateFileHash } from "../lib/pdf/pdf-inspector.js";
import { extractPdfText } from "../lib/pdf/pdf-text-extractor.js";
import { defaultBankDetectionEngine } from "../lib/bank-detection/index.js";
import { defaultTransactionExtractionEngine } from "../lib/transaction-extraction/index.js";

describe("BCA False Password Detection Bug Fix & Security Tests", () => {
  const BNI_PASSWORD = "BniSecurePassword2026!";
  const WRONG_PASSWORD = "WrongPassword999!";

  let unencryptedPdfBytes: Uint8Array;
  let bcaReadableEncryptedPdfBytes: Uint8Array;
  let bniProtectedPdfBytes: Uint8Array;

  const bcaStatementText = [
    "PT BANK CENTRAL ASIA TBK",
    "REKENING KORAN",
    "NO. REKENING : 1234567890",
    "PERIODE : 01/01/2026 - 31/01/2026",
    "MATA UANG : IDR",
    "SALDO AWAL : 10,000,000.00",
    "TGL KETERANGAN CB MUTASI SALDO",
    "02/01 TRSF E-BANKING DB 500,000.00 9,500,000.00",
    "15/01 GAJI CR 5,000,000.00 14,500,000.00",
    "SALDO AKHIR : 14,500,000.00",
  ];

  const bniStatementText = [
    "PT BANK NEGARA INDONESIA (PERSERO) TBK",
    "REKENING KORAN",
    "NO. REKENING : 0123456789",
    "PERIODE : 01/12/2025 - 31/12/2025",
    "MATA UANG : IDR",
    "SALDO AWAL : 10,000,000.00",
    "TANGGAL URAIAN TRANSAKSI CABANG DEBET KREDIT SALDO",
    "02/12/2025 TRANSFER MASUK DARI REKENING 001 0.00 5,000,000.00 15,000,000.00",
    "10/12/2025 TARIK TUNAI ATM BNI 001 1,000,000.00 0.00 14,000,000.00",
    "SALDO AKHIR : 14,000,000.00",
  ];

  before(async () => {
    // 1. Normal unencrypted PDF
    const normalDoc = await PDFDocument.create();
    normalDoc.setTitle("Normal Financial Statement");
    normalDoc.setAuthor("Test Author");
    const p1 = normalDoc.addPage([595, 842]);
    p1.drawText("Normal unencrypted document content", { x: 50, y: 750, size: 12 });
    unencryptedPdfBytes = await normalDoc.save();

    // 2. BCA bank statement PDF (encrypted with owner password, empty user password)
    // This reproduces the exact production bug: has /Encrypt dictionary, but readable without user password
    const bcaDoc = await PDFDocument.create();
    bcaDoc.setTitle("BCA Rekening Koran");
    bcaDoc.setAuthor("PT BANK CENTRAL ASIA TBK");
    const bcaPage = bcaDoc.addPage([595, 842]);
    let yBca = 800;
    for (const line of bcaStatementText) {
      bcaPage.drawText(line, { x: 40, y: yBca, size: 9 });
      yBca -= 18;
    }
    const bcaRawBytes = await bcaDoc.save();
    bcaReadableEncryptedPdfBytes = await encryptPDF(bcaRawBytes, "", {
      ownerPassword: "BcaAdminOwnerSecretKey999!",
      algorithm: "AES-256",
    });

    // 3. BNI bank statement PDF (genuinely password-protected with user password)
    const bniDoc = await PDFDocument.create();
    bniDoc.setTitle("BNI Rekening Koran E-Statement");
    bniDoc.setAuthor("PT BANK NEGARA INDONESIA (PERSERO) TBK");
    const bniPage = bniDoc.addPage([595, 842]);
    let yBni = 800;
    for (const line of bniStatementText) {
      bniPage.drawText(line, { x: 40, y: yBni, size: 9 });
      yBni -= 18;
    }
    const bniRawBytes = await bniDoc.save();
    bniProtectedPdfBytes = await encryptPDF(bniRawBytes, BNI_PASSWORD);
  });

  // TEST 1: BCA readable PDF without password -> no password prompt
  it("TEST 1: BCA readable PDF without password -> securityState READABLE_WITHOUT_PASSWORD, passwordRequired=false", async () => {
    const encInfo = await detectEncryption(bcaReadableEncryptedPdfBytes);
    assert.equal(encInfo.isEncrypted, true);
    assert.ok(
      encInfo.securityState === "READABLE_WITHOUT_PASSWORD" ||
        encInfo.securityState === "UNPROTECTED"
    );
    assert.equal(encInfo.requiresPassword, false);
    assert.equal(encInfo.canReadWithoutPassword, true);

    // decryptPdf does not require password and succeeds
    const decRes = await decryptPdf(bcaReadableEncryptedPdfBytes);
    assert.equal(decRes.success, true);
    assert.ok(decRes.decryptedBytes && decRes.decryptedBytes.length > 0);
  });

  // TEST 2: BNI password-protected PDF -> password prompt
  it("TEST 2: BNI password-protected PDF -> securityState PASSWORD_REQUIRED, passwordRequired=true", async () => {
    const encInfo = await detectEncryption(bniProtectedPdfBytes);
    assert.equal(encInfo.isEncrypted, true);
    assert.ok(
      encInfo.securityState === "PASSWORD_REQUIRED" ||
        encInfo.securityState === "PASSWORD_PROTECTED"
    );
    assert.equal(encInfo.requiresPassword, true);
    assert.equal(encInfo.canReadWithoutPassword, false);

    // Without password, decryptPdf indicates password is required
    const decRes = await decryptPdf(bniProtectedPdfBytes);
    assert.equal(decRes.success, false);
    assert.ok(
      decRes.securityState === "PASSWORD_REQUIRED" ||
        decRes.securityState === "PASSWORD_PROTECTED"
    );
    assert.match(decRes.error || "", /dilindungi password/i);
  });

  // TEST 3: Normal unencrypted PDF -> no password prompt
  it("TEST 3: Normal unencrypted PDF -> securityState UNPROTECTED, passwordRequired=false", async () => {
    const encInfo = await detectEncryption(unencryptedPdfBytes);
    assert.equal(encInfo.isEncrypted, false);
    assert.equal(encInfo.securityState, "UNPROTECTED");
    assert.equal(encInfo.requiresPassword, false);
    assert.equal(encInfo.canReadWithoutPassword, true);

    const decRes = await decryptPdf(unencryptedPdfBytes);
    assert.equal(decRes.success, true);
    assert.equal(decRes.securityState, "UNPROTECTED");
  });

  // TEST 4: Wrong password on protected PDF -> safe error, no leak
  it("TEST 4: Wrong password on protected PDF -> safe error without leaking password", async () => {
    const origLog = console.log;
    const capturedLogs: string[] = [];
    console.log = (...args: unknown[]) => capturedLogs.push(args.map(String).join(" "));

    try {
      const decRes = await decryptPdf(bniProtectedPdfBytes, WRONG_PASSWORD);
      assert.equal(decRes.success, false);
      assert.ok(
        decRes.securityState === "PASSWORD_REQUIRED" ||
          decRes.securityState === "PASSWORD_PROTECTED"
      );
      assert.equal(decRes.error, "Password PDF salah atau dokumen tidak dapat dibuka.");

      // Verify password was never logged
      for (const log of capturedLogs) {
        assert.ok(!log.includes(WRONG_PASSWORD), "Wrong password leaked in log!");
        assert.ok(!log.includes(BNI_PASSWORD), "Correct password leaked in log!");
      }
    } finally {
      console.log = origLog;
    }
  });

  // TEST 5: Correct BNI password -> full pipeline succeeds
  it("TEST 5: Correct BNI password -> full pipeline succeeds in memory", async () => {
    const decRes = await decryptPdf(bniProtectedPdfBytes, BNI_PASSWORD);
    assert.equal(decRes.success, true);
    assert.ok(decRes.decryptedBytes);

    const processedPdf = createProcessedPdf(bniProtectedPdfBytes, decRes.decryptedBytes, true);
    assert.equal(processedPdf.wasEncrypted, true);

    // Metadata extraction
    const origHash = calculateFileHash(bniProtectedPdfBytes);
    const meta = await inspectPdfMetadata(processedPdf.analysisBytes, { originalFileHash: origHash });
    assert.equal(meta.fileHash, origHash);
    assert.equal(meta.pageCount, 1);

    // Text extraction & Bank detection
    const textResult = await extractPdfText(processedPdf.analysisBytes);
    assert.ok(textResult.fullText.includes("BANK NEGARA INDONESIA"));
    const bankDetection = defaultBankDetectionEngine.detect(textResult);
    assert.equal(bankDetection.bankCode, "BNI");

    // Transaction extraction
    const txResult = defaultTransactionExtractionEngine.extract({
      fullText: textResult.fullText,
      pages: textResult.pages,
      bankCode: "BNI",
    });
    assert.equal(txResult.bankCode, "BNI");
    assert.ok(txResult.transactions.length >= 2);
  });

  // TEST 6: BCA PDF -> metadata works without entering password
  it("TEST 6: BCA PDF -> metadata extraction succeeds without password", async () => {
    const origHash = calculateFileHash(bcaReadableEncryptedPdfBytes);
    const meta = await inspectPdfMetadata(bcaReadableEncryptedPdfBytes, { originalFileHash: origHash });
    assert.equal(meta.fileHash, origHash);
    assert.equal(meta.pageCount, 1);
    assert.equal(meta.metadataStatus, "SUCCESS");
    assert.ok(meta.title?.includes("BCA") || meta.author?.includes("BCA"));
  });

  // TEST 7: BCA PDF -> bank detection works without password
  it("TEST 7: BCA PDF -> bank detection identifies BCA from readable bytes", async () => {
    const textResult = await extractPdfText(bcaReadableEncryptedPdfBytes);
    assert.ok(textResult.fullText.includes("BANK CENTRAL ASIA"));
    const detection = defaultBankDetectionEngine.detect(textResult);
    assert.equal(detection.bankCode, "BCA");
    assert.equal(detection.documentType, "BANK_STATEMENT");
    assert.equal(detection.accountNumberMasked, "******7890");
  });

  // TEST 8: BCA PDF -> transaction extraction works without password
  it("TEST 8: BCA PDF -> transaction extraction parses mutasi and balances correctly", async () => {
    const textResult = await extractPdfText(bcaReadableEncryptedPdfBytes);
    const extraction = defaultTransactionExtractionEngine.extract({
      fullText: textResult.fullText,
      pages: textResult.pages,
      bankCode: "BCA",
    });
    assert.equal(extraction.bankCode, "BCA");
    assert.ok(extraction.transactions.length >= 2);
    assert.equal(extraction.validation.balanceReconciliationStatus, "VALID");
  });
});
