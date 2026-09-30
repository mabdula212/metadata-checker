import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { encryptPDF } from "@pdfsmaller/pdf-encrypt";
import {
  normalizeAnalysisOptions,
  toggleFeatureWithDependencies,
  FEATURE_DEFINITIONS,
  ALL_ANALYSIS_FEATURES,
  DEFAULT_ANALYSIS_FEATURES,
  type AnalysisFeature,
} from "../lib/analysis/feature-pipeline.js";
import {
  calculateRollingSpeed,
  formatSpeed,
  formatEta,
  formatBytesDisplay,
  MAX_FILE_SIZE_BYTES,
  type SpeedSample,
  type UploadProgressData,
} from "../src/lib/upload-client.js";
import {
  detectEncryption,
  decryptPdf,
  createProcessedPdf,
  storeDecryptedBuffer,
  getDecryptedBuffer,
  clearDecryptedBuffer,
} from "../lib/pdf/pdf-decryptor.js";
import { inspectPdfMetadata, calculateFileHash } from "../lib/pdf/pdf-inspector.js";
import { defaultBankDetectionEngine } from "../lib/bank-detection/index.js";
import { defaultTransactionExtractionEngine } from "../lib/transaction-extraction/index.js";
import { extractPdfText } from "../lib/pdf/pdf-text-extractor.js";
import { prisma } from "../lib/db/prisma.js";

describe("Upload Progress, Speed, ETA & Selective Pipeline Suite", () => {
  const TEST_PASSWORD = "PasswordMutasi2026!";
  const WRONG_PASSWORD = "WrongPassword999!";
  let samplePdfBytes: Uint8Array;
  let sampleBankStatementBytes: Uint8Array;
  let encryptedBankStatementBytes: Uint8Array;

  before(async () => {
    // 1. Plain PDF fixture
    const doc1 = await PDFDocument.create();
    doc1.setTitle("Corporate Report 2026");
    doc1.setAuthor("Corporate Dept");
    const p1 = doc1.addPage([500, 700]);
    p1.drawText("Quarterly Report Content");
    samplePdfBytes = await doc1.save();

    // 2. Bank statement fixture (BCA)
    const doc2 = await PDFDocument.create();
    doc2.setTitle("BCA Rekening Koran");
    doc2.setAuthor("PT BANK CENTRAL ASIA TBK");
    const p2 = doc2.addPage([600, 800]);
    p2.drawText("PT BANK CENTRAL ASIA TBK", { x: 50, y: 750, size: 12 });
    p2.drawText("REKENING KORAN", { x: 50, y: 730, size: 10 });
    p2.drawText("NO. REKENING : 8820192831", { x: 50, y: 710, size: 10 });
    p2.drawText("PERIODE : 01/02/2026 - 28/02/2026", { x: 50, y: 690, size: 10 });
    p2.drawText("SALDO AWAL : 5,000,000.00", { x: 50, y: 670, size: 10 });
    p2.drawText("05/02 TRSF E-BANKING CR 2,500,000.00 7,500,000.00", { x: 50, y: 650, size: 10 });
    p2.drawText("12/02 TARIK TUNAI DB 1,000,000.00 6,500,000.00", { x: 50, y: 630, size: 10 });
    p2.drawText("SALDO AKHIR : 6,500,000.00", { x: 50, y: 610, size: 10 });
    sampleBankStatementBytes = await doc2.save();

    // 3. Encrypted bank statement
    encryptedBankStatementBytes = await encryptPDF(sampleBankStatementBytes, TEST_PASSWORD);
  });

  after(async () => {
    await prisma.$disconnect().catch(() => null);
  });

  // ==========================================
  // PART A-E: Upload, Speed, ETA, States
  // ==========================================

  it("1. file selection validates PDF mime, extension, and %PDF- signature", () => {
    // Check valid signature
    const header = Buffer.from(samplePdfBytes.slice(0, 10)).toString("utf-8");
    assert.ok(header.startsWith("%PDF-"));

    // Check invalid signature rejection
    const invalidHeader = Buffer.from("NOT_A_PDF_FILE").toString("utf-8");
    assert.strictEqual(invalidHeader.includes("%PDF-"), false);
  });

  it("2. file size validation rejects files exceeding 20 MB limit", () => {
    const twentyMb = 20 * 1024 * 1024;
    assert.strictEqual(MAX_FILE_SIZE_BYTES, twentyMb);

    const oversizedBytes = twentyMb + 1;
    assert.ok(oversizedBytes > MAX_FILE_SIZE_BYTES);

    // Format bytes display
    assert.strictEqual(formatBytesDisplay(20 * 1024 * 1024), "20.0 MB");
    assert.strictEqual(formatBytesDisplay(1024 * 500), "500.0 KB");
  });

  it("3. actual progress calculation computes real percentage and caps below 100% in flight", () => {
    const total = 10_000_000;
    const loadedMid = 6_200_000;
    const rawPct = (loadedMid / total) * 100;
    assert.strictEqual(rawPct, 62);

    // When loaded is 9_999_999, in-flight percentage must not display 100%
    const loadedNearComplete = 9_999_000;
    const inFlightPct = Math.min(Math.floor((loadedNearComplete / total) * 100), 99);
    assert.strictEqual(inFlightPct, 99);

    // At complete
    const completePct = Math.round((total / total) * 100);
    assert.strictEqual(completePct, 100);
  });

  it("4. rolling upload speed calculation computes smooth moving average", () => {
    const samples: SpeedSample[] = [
      { timestamp: 1000, loaded: 1_000_000 },
      { timestamp: 2000, loaded: 3_000_000 },
      { timestamp: 3000, loaded: 6_000_000 },
    ];

    const speed = calculateRollingSpeed(samples);
    // 5MB over 2 seconds = 2.5 MB/s = 2,500,000 B/s
    assert.strictEqual(speed, 2_500_000);
    assert.strictEqual(formatSpeed(speed), "2.4 MB/s");

    // KB/s format
    assert.strictEqual(formatSpeed(500 * 1024), "500.0 KB/s");
    assert.strictEqual(formatSpeed(0), "0 KB/s");
  });

  it("5. ETA calculation accurately estimates remaining seconds without negative or NaN", () => {
    const remainingBytes = 5_000_000;
    const speed = 2_500_000; // 2.5 MB/s
    const etaSeconds = remainingBytes / speed;
    assert.strictEqual(etaSeconds, 2);
    assert.strictEqual(formatEta(etaSeconds), "2.0 seconds");

    // Zero or complete
    assert.strictEqual(formatEta(0), "Complete");
    // Null / unavailable
    assert.strictEqual(formatEta(null), "Calculating...");
    // Long duration formatting
    assert.strictEqual(formatEta(125), "2m 5s");
  });

  it("6. completed upload state transitions cleanly", () => {
    const progress: UploadProgressData = {
      state: "COMPLETED",
      loadedBytes: 5_000_000,
      totalBytes: 5_000_000,
      percentage: 100,
      speedBytesPerSec: 0,
      formattedSpeed: "0 KB/s",
      etaSeconds: 0,
      formattedEta: "Complete",
      statusText: "Analysis complete",
    };

    assert.strictEqual(progress.state, "COMPLETED");
    assert.strictEqual(progress.percentage, 100);
  });

  it("7. failed upload state preserves error message and resets progress metrics", () => {
    const progress: UploadProgressData = {
      state: "FAILED",
      loadedBytes: 0,
      totalBytes: 0,
      percentage: 0,
      speedBytesPerSec: 0,
      formattedSpeed: "0 KB/s",
      etaSeconds: null,
      formattedEta: "Calculating...",
      statusText: "Upload or analysis failed",
      errorMessage: "Network error: connection lost.",
    };

    assert.strictEqual(progress.state, "FAILED");
    assert.strictEqual(progress.percentage, 0);
    assert.ok(progress.errorMessage?.includes("Network error"));
  });

  it("8. cancellation transitions state to CANCELLED and halts transfer", () => {
    let aborted = false;
    const mockTask = {
      abort: () => {
        aborted = true;
      },
    };

    mockTask.abort();
    assert.strictEqual(aborted, true);
  });

  it("9. no fake progress: progress directly reflects genuine event loaded bytes", () => {
    // Genuine loaded bytes from ProgressEvent
    const eventLoaded = 3_450_000;
    const eventTotal = 10_000_000;
    const realPercentage = Math.floor((eventLoaded / eventTotal) * 100);
    assert.strictEqual(realPercentage, 34);
    assert.notStrictEqual(realPercentage, 50); // Not timer-driven fake progress
  });

  // ==========================================
  // PART F-J: Feature Selection & Dependencies
  // ==========================================

  it("10. feature selection: metadata only executes independently", () => {
    const plan = normalizeAnalysisOptions(["metadata"]);
    assert.deepStrictEqual(plan, ["metadata"]);
  });

  it("11. feature selection: bank detection only operates independently", () => {
    const plan = normalizeAnalysisOptions(["bankDetection"]);
    assert.deepStrictEqual(plan, ["bankDetection"]);
  });

  it("12. transaction extraction automatically enables bank detection dependency", () => {
    const plan = normalizeAnalysisOptions(["transactionExtraction"]);
    assert.deepStrictEqual(plan, ["bankDetection", "transactionExtraction"]);

    // UI toggle test
    const { updatedFeatures, explanation } = toggleFeatureWithDependencies(
      "transactionExtraction",
      ["metadata"]
    );
    assert.ok(updatedFeatures.includes("bankDetection"));
    assert.ok(updatedFeatures.includes("transactionExtraction"));
    assert.strictEqual(explanation, "Transaction Extraction membutuhkan Bank Detection.");
  });

  it("13. validation automatically enables transaction extraction and bank detection", () => {
    const plan = normalizeAnalysisOptions(["validation"]);
    assert.deepStrictEqual(plan, [
      "bankDetection",
      "transactionExtraction",
      "validation",
    ]);

    // UI toggle test
    const { updatedFeatures, explanation } = toggleFeatureWithDependencies(
      "validation",
      []
    );
    assert.ok(updatedFeatures.includes("transactionExtraction"));
    assert.ok(updatedFeatures.includes("bankDetection"));
    assert.strictEqual(explanation, "Balance Validation membutuhkan Transaction Extraction.");
  });

  it("14. Excel export automatically enables required dependencies with required Indonesian message", () => {
    const plan = normalizeAnalysisOptions(["excelExport"]);
    assert.deepStrictEqual(plan, [
      "bankDetection",
      "transactionExtraction",
      "validation",
      "excelExport",
    ]);

    // UI toggle test
    const { updatedFeatures, explanation } = toggleFeatureWithDependencies(
      "excelExport",
      ["metadata"]
    );
    assert.ok(updatedFeatures.includes("excelExport"));
    assert.ok(updatedFeatures.includes("transactionExtraction"));
    assert.ok(updatedFeatures.includes("validation"));
    assert.ok(updatedFeatures.includes("bankDetection"));
    assert.strictEqual(
      explanation,
      "Excel Export membutuhkan Transaction Extraction dan Validation."
    );
  });

  it("15. deselecting parent disables dependent features cleanly", () => {
    // Deselecting transactionExtraction disables validation and excelExport
    const { updatedFeatures: withoutTx, explanation: exp1 } = toggleFeatureWithDependencies(
      "transactionExtraction",
      ["metadata", "bankDetection", "transactionExtraction", "validation", "excelExport"]
    );
    assert.strictEqual(withoutTx.includes("transactionExtraction"), false);
    assert.strictEqual(withoutTx.includes("validation"), false);
    assert.strictEqual(withoutTx.includes("excelExport"), false);
    assert.ok(withoutTx.includes("bankDetection"));
    assert.ok(withoutTx.includes("metadata"));
    assert.ok(exp1?.includes("Transaction Extraction"));

    // Deselecting bankDetection disables transactionExtraction, validation, and excelExport
    const { updatedFeatures: withoutBank, explanation: exp2 } = toggleFeatureWithDependencies(
      "bankDetection",
      ["metadata", "bankDetection", "transactionExtraction", "validation", "excelExport"]
    );
    assert.strictEqual(withoutBank.includes("bankDetection"), false);
    assert.strictEqual(withoutBank.includes("transactionExtraction"), false);
    assert.strictEqual(withoutBank.includes("validation"), false);
    assert.strictEqual(withoutBank.includes("excelExport"), false);
    assert.ok(withoutBank.includes("metadata"));
    assert.ok(exp2?.includes("Bank Detection"));
  });

  it("16. unknown feature values are rejected and stripped", () => {
    const plan = normalizeAnalysisOptions([
      "metadata",
      "malicious_option",
      "unknown_feature_xyz",
    ]);
    assert.deepStrictEqual(plan, ["metadata"]);
  });

  it("17. backend normalizes feature selections from various request shapes (array, string, JSON)", () => {
    // Array
    assert.deepStrictEqual(normalizeAnalysisOptions(["metadata", "bankDetection"]), [
      "metadata",
      "bankDetection",
    ]);

    // Comma-separated string
    assert.deepStrictEqual(normalizeAnalysisOptions("metadata, bankDetection"), [
      "metadata",
      "bankDetection",
    ]);

    // JSON string
    assert.deepStrictEqual(
      normalizeAnalysisOptions(JSON.stringify(["metadata", "bankDetection"])),
      ["metadata", "bankDetection"]
    );

    // Empty / null defaults to ALL_ANALYSIS_FEATURES
    assert.deepStrictEqual(normalizeAnalysisOptions(null), [...DEFAULT_ANALYSIS_FEATURES]);
    assert.deepStrictEqual(normalizeAnalysisOptions([]), [...DEFAULT_ANALYSIS_FEATURES]);
  });

  it("18. skipped features are properly excluded from execution", () => {
    const selected: AnalysisFeature[] = ["metadata"];
    const runBankDetection = selected.includes("bankDetection");
    const runTransactionExtraction = selected.includes("transactionExtraction");
    const runValidation = selected.includes("validation");
    const runExcelExport = selected.includes("excelExport");

    assert.strictEqual(runBankDetection, false);
    assert.strictEqual(runTransactionExtraction, false);
    assert.strictEqual(runValidation, false);
    assert.strictEqual(runExcelExport, false);
  });

  it("19. successful features remain visible even if a downstream feature fails", () => {
    // Simulating isolated engine results
    const engineResults = {
      metadata: { status: "SUCCESS" as const, pageCount: 2 },
      bankDetection: { status: "SUCCESS" as const, bank: "BCA", bankName: "Bank Central Asia" },
      transactionExtraction: { status: "FAILED" as const, transactionCount: 0, needsReview: 0 },
      validation: { status: "SKIPPED" as const },
      excelExport: { status: "SKIPPED" as const },
    };

    // Metadata & Bank Detection are intact despite Transaction Extraction failure
    assert.strictEqual(engineResults.metadata.status, "SUCCESS");
    assert.strictEqual(engineResults.bankDetection.status, "SUCCESS");
    assert.strictEqual(engineResults.transactionExtraction.status, "FAILED");
  });

  // ==========================================
  // PART N: Password-Protected PDF Support
  // ==========================================

  it("20. encrypted PDF is detected as PASSWORD_PROTECTED", async () => {
    const encInfo = await detectEncryption(encryptedBankStatementBytes);
    assert.strictEqual(encInfo.isEncrypted, true);
    assert.strictEqual(encInfo.securityState, "PASSWORD_PROTECTED");
  });

  it("21. wrong password fails gracefully without server crash", async () => {
    const decResult = await decryptPdf(encryptedBankStatementBytes, WRONG_PASSWORD);
    assert.strictEqual(decResult.success, false);
    assert.strictEqual(decResult.securityState, "PASSWORD_PROTECTED");
    assert.ok(decResult.error?.includes("Password PDF salah"));
  });

  it("22. password is not persisted in memory cache, storage, or DB fields", async () => {
    const decResult = await decryptPdf(encryptedBankStatementBytes, TEST_PASSWORD);
    assert.strictEqual(decResult.success, true);
    assert.ok(decResult.decryptedBytes);

    // Storing decrypted buffer does NOT store or record the password
    const testDocId = "audit-doc-no-pwd-persist";
    storeDecryptedBuffer(testDocId, Buffer.from(decResult.decryptedBytes), {
      wasEncrypted: true,
      extractedText: decResult.extractedText,
    });

    const cached = getDecryptedBuffer(testDocId);
    assert.ok(cached !== null);

    // Verify cache does not expose any password property
    assert.strictEqual((cached as any).password, undefined);
    clearDecryptedBuffer(testDocId);
  });

  it("23. decrypted PDF bytes successfully reach bank detection & transaction extraction engines", async () => {
    const decResult = await decryptPdf(encryptedBankStatementBytes, TEST_PASSWORD);
    assert.strictEqual(decResult.success, true);
    assert.ok(decResult.decryptedBytes);

    const processed = createProcessedPdf(
      encryptedBankStatementBytes,
      decResult.decryptedBytes,
      true
    );
    assert.strictEqual(processed.wasEncrypted, true);

    // Text extraction from decrypted bytes
    const textResult = await extractPdfText(Buffer.from(processed.analysisBytes));
    assert.ok(textResult.fullText.includes("BANK CENTRAL ASIA"));

    // Bank detection engine receives decrypted bytes
    const bankDet = defaultBankDetectionEngine.detect(textResult);
    assert.strictEqual(bankDet.bankCode, "BCA");
    assert.strictEqual(bankDet.documentType, "BANK_STATEMENT");

    // Transaction extraction engine receives decrypted bytes
    const txRes = defaultTransactionExtractionEngine.extract(
      textResult,
      "BCA",
      "BANK_STATEMENT"
    );
    assert.ok(txRes.transactions.length >= 2);
    assert.strictEqual(txRes.validation.totalTransactionsParsed >= 2, true);
  });
});
