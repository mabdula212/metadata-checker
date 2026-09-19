import type {
  BankTransactionParser,
  TransactionParserInput,
  TransactionExtractionResult,
} from "./types";
import { normalizeTransactions } from "./normalizer";
import { validateExtractionResult } from "./validator";

import { BcaTransactionParser } from "./parsers/bca";
import { BriTransactionParser } from "./parsers/bri";
import { MandiriTransactionParser } from "./parsers/mandiri";
import { BniTransactionParser } from "./parsers/bni";
import { CimbNiagaTransactionParser } from "./parsers/cimb-niaga";
import { DanamonTransactionParser } from "./parsers/danamon";
import { PermataTransactionParser } from "./parsers/permata";
import { BankMegaTransactionParser } from "./parsers/bank-mega";
import { BtnTransactionParser } from "./parsers/btn";
import { OcbcTransactionParser } from "./parsers/ocbc";
import { MaybankTransactionParser } from "./parsers/maybank";
import { BsiTransactionParser } from "./parsers/bsi";
import { GenericTransactionParser } from "./parsers/generic";

export class TransactionExtractionEngine {
  private parsers: BankTransactionParser[];
  private fallbackParser: BankTransactionParser;

  constructor() {
    this.parsers = [
      new BcaTransactionParser(),
      new BriTransactionParser(),
      new MandiriTransactionParser(),
      new BniTransactionParser(),
      new CimbNiagaTransactionParser(),
      new DanamonTransactionParser(),
      new PermataTransactionParser(),
      new BankMegaTransactionParser(),
      new BtnTransactionParser(),
      new OcbcTransactionParser(),
      new MaybankTransactionParser(),
      new BsiTransactionParser(),
    ];
    this.fallbackParser = new GenericTransactionParser();
  }

  /**
   * Selects the most appropriate parser for the given bank and document text.
   */
  public selectParser(input: TransactionParserInput): BankTransactionParser {
    if (input.bankCode) {
      const match = this.parsers.find(
        (p) => p.bankCode.toUpperCase() === input.bankCode?.toUpperCase()
      );
      if (match) return match;
    }

    for (const parser of this.parsers) {
      if (parser.canParse(input)) {
        return parser;
      }
    }

    return this.fallbackParser;
  }

  /**
   * Main entry point to extract transactions from document text and pages.
   */
  public extract(input: TransactionParserInput): TransactionExtractionResult {
    // 1. Check for scanned / image-only PDFs
    if (input.isScannedOrImageOnly) {
      const { status, validation, warning } = validateExtractionResult({
        transactions: [],
        reviewRows: [],
        totalRowsDetected: 0,
        sourceOpeningBalance: null,
        sourceClosingBalance: null,
        isScannedOrImageOnly: true,
      });

      return {
        status,
        bankCode: input.bankCode || null,
        bankName: input.bankName || null,
        transactions: [],
        reviewRows: [],
        validation,
        warning,
      };
    }

    // 2. Select Bank Parser
    const parser = this.selectParser(input);

    // 3. Execute parsing
    let parseResult = parser.parse(input);

    // If bank parser yielded 0 transactions and we weren't already using generic fallback,
    // attempt generic fallback parser
    if (parseResult.transactions.length === 0 && parser !== this.fallbackParser) {
      const fallbackResult = this.fallbackParser.parse(input);
      if (fallbackResult.transactions.length > 0) {
        parseResult = fallbackResult;
      }
    }

    // 4. Normalize transactions
    const normalizedTransactions = normalizeTransactions(parseResult.transactions);

    // 5. Validate extraction
    const { status, validation, warning } = validateExtractionResult({
      transactions: normalizedTransactions,
      reviewRows: parseResult.reviewRows,
      totalRowsDetected: parseResult.totalRowsDetected,
      sourceOpeningBalance: parseResult.sourceOpeningBalance || input.sourceOpeningBalance || null,
      sourceClosingBalance: parseResult.sourceClosingBalance || input.sourceClosingBalance || null,
      isScannedOrImageOnly: false,
    });

    return {
      status,
      bankCode: parser.bankCode,
      bankName: parser.bankName,
      transactions: normalizedTransactions,
      reviewRows: parseResult.reviewRows,
      validation,
      warning,
    };
  }
}

export const defaultTransactionExtractionEngine = new TransactionExtractionEngine();
