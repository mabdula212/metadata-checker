# Metadata Checker

**PDF Metadata & Bank Statement Analyzer — Foundation Stage**

"Upload a PDF bank statement to inspect metadata and analyze transactions."

---

## 1. Project Diagnostic & Status

- **Application Name**: Metadata Checker
- **Current Framework**: React 19 + Vite 8 SPA with TypeScript and Tailwind CSS v4.
- **Stage**: Foundation Reset (Minimal, stable foundation).
- **Environment**: Zero environment variables required for this stage.
- **Database / Auth / Storage**: Explicitly unconfigured for this foundation stage.

---

## 2. Primary Processing Workflow

```
UPLOAD PDF
    ↓
 ANALYZE
    ↓
 REVIEW
    ↓
 EXPORT
```

- **Step 1: Upload PDF** (Active in UI): Drag-and-drop or file browser with client-side PDF verification and 20 MB size constraint.
- **Step 2: Analyze** (Upcoming): PDF metadata parsing & bank statement detection.
- **Step 3: Review** (Upcoming): Normalized transaction verification.
- **Step 4: Export** (Upcoming): Export to structured formats (Excel / CSV).

---

## 3. Supported Validation Rules

- **Allowed File**: PDF only (`.pdf`, `application/pdf`)
- **Maximum File Size**: 20 MB (`20,971,520 bytes`)
- **Error Handling**: Immediate, clear, user-friendly alert on non-PDF or oversized files.

---

## 4. Scripts

```bash
# Start development server
npm run dev

# Compile production bundle
npm run build

# Preview production build
npm run start
```
