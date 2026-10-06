# Metadata Checker

**PDF Metadata & Bank Statement Analyzer — Enterprise Stage**

"Upload a PDF bank statement to inspect metadata, detect bank models, extract normalized transactions, verify balance continuity, and export structured Excel reports."

---

## 1. Project Diagnostic & Status

- **Application Name**: Metadata Checker
- **Current Framework**: React 19 + Vite 8 SPA with TypeScript and Tailwind CSS v4.
- **Backend & Middleware**: Serverless API routes mounted via Vite middleware (`apiPlugin` in `vite.config.ts`).
- **Database / Auth / Storage**: Prisma ORM with PostgreSQL, cryptographic session management (SHA-256 token hashing), bcryptjs password hashing (cost factor 12), and pluggable storage providers (Local Disk & Vercel Blob).
- **Security & RBAC**: Dual-role authorization (USER / ADMIN), CSRF verification on state-changing methods, sliding-window rate limiting, timing-attack protection with dummy bcrypt operations, IDOR defenses, and audit logging with secret/PII masking.
- **Automated Tests**: 56 unit/integration tests across 21 test suites passing with 100% success rate.

---

## 2. Primary Processing Workflow

```
UPLOAD PDF
    ↓
 ANALYZE (Metadata & Bank Detection)
    ↓
 REVIEW (Transaction Extraction & Balance Continuity)
    ↓
 EXPORT (Multi-Sheet Styled Excel Workbook)
```

- **Step 1: Upload PDF**: Drag-and-drop or file browser with client-side & server-side PDF signature verification, SHA-256 deduplication, and 20 MB size constraint.
- **Step 2: Analyze**: PDF trailer/catalog metadata parsing (producer, creation/modification dates, page counts, encryption) and Indonesian bank detection (BCA, Mandiri, BNI, BRI, BSI) with account number masking and confidence scoring.
- **Step 3: Review**: Normalized transaction extraction (amounts in IDR/standard formats, transaction dates, CR/DB flags, automatic categorization) with mathematical balance progression and reconciliation.
- **Step 4: Export**: Generates professional multi-sheet Excel workbooks (`.xlsx`) featuring styled summary cards, analysis metadata, and categorized transaction tables with zero exposed secrets.

---

## 3. Supported Validation Rules

- **Allowed File**: PDF only (`.pdf`, `application/pdf`, `%PDF-` header signature verification)
- **Maximum File Size**: 20 MB (`20,971,520 bytes`)
- **Error Handling**: Immediate, clean user-facing error reporting with technical details sanitized to prevent system information leakage.

---

## 4. Scripts

```bash
# Start development server
npm run dev

# Run automated tests
npm run test

# Type check codebase
npm run lint

# Compile production bundle
npm run build

# Preview production build
npm run start
```

