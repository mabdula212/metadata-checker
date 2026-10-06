import React, { useState } from "react";
import {
  Lock,
  ShieldCheck,
  Database,
  X,
  CheckCircle2,
} from "lucide-react";
import { Logo } from "../ui/Logo";

export type FooterNavigationTab = "dashboard" | "analyze" | "recent" | "exports" | "about" | "admin";

export interface FooterProps {
  variant?: "marketing" | "app";
  isAuthenticated?: boolean;
  onNavigateTab?: (tab: FooterNavigationTab, sectionId?: string) => void;
  onNavigateAbout?: () => void;
}

type InfoModalTopic = "about" | "documentation" | "status" | "contact" | "privacy" | "security" | "data-protection" | null;

const INFO_MODAL_CONTENT: Record<
  Exclude<InfoModalTopic, null>,
  {
    category: string;
    title: string;
    summary: string;
    points: string[];
  }
> = {
  about: {
    category: "Company",
    title: "About Metadata Checker",
    summary:
      "Metadata Checker is a specialized financial document intelligence platform designed to inspect PDF metadata, detect Indonesian banking institutions, extract normalized statement transactions, and verify running balance continuity.",
    points: [
      "Deterministic PDF structural and trailer metadata inspection with SHA-256 file fingerprinting.",
      "Automated detection for major Indonesian bank statements including BCA, Mandiri, BNI, BRI, and BSI.",
      "Mathematical balance reconciliation comparing opening balances, transaction mutations, and closing balances.",
      "Multi-sheet Excel (.xlsx) report generation for accounting and audit workflows.",
    ],
  },
  documentation: {
    category: "Company",
    title: "Platform Documentation & Workflow",
    summary:
      "Metadata Checker processes PDF bank statements through a structured 5-stage analysis pipeline.",
    points: [
      "01. Upload PDF: Validates PDF magic bytes (%PDF-), MIME type, and enforces a 20 MB maximum file size.",
      "02. Select Analysis Engines: Choose metadata inspection, bank detection, transaction extraction, or full pipeline.",
      "03. In-Memory Decryption: Password-protected PDFs are unlocked in memory; document passwords are never persisted.",
      "04. Review & Reconcile: Inspect parsed debit/credit rows, category tags, and balance continuity indicators.",
      "05. Export Workbook: Download formatted Excel workbooks containing Summary, Transactions, and Metadata sheets.",
    ],
  },
  status: {
    category: "Company",
    title: "System Architecture & Operational Status",
    summary:
      "Core document processing engines and authentication services operate within the application runtime.",
    points: [
      "PDF Inspection & Decryption Engine: Active (in-memory processing up to 20 MB per document).",
      "Bank Detection & Statement Parser: Active (supporting Indonesian statement layouts).",
      "Database & Session Persistence: Active (PostgreSQL with Prisma ORM and SHA-256 session token hashing).",
      "Excel Workbook Exporter: Active (formula-injection sanitized .xlsx generation).",
    ],
  },
  contact: {
    category: "Company",
    title: "Workspace Support & Administration",
    summary:
      "Account authorization, role permissions, and password resets are managed directly by your workspace Administrator.",
    points: [
      "New account registrations require Administrator approval before workspace sign-in is enabled.",
      "Workspace Administrators can authorize pending accounts, manage user access, and reset credentials via the Admin Console.",
      "For document processing diagnostics, review the step-by-step status indicators inside the Analyze PDF workspace.",
    ],
  },
  privacy: {
    category: "Security & Privacy",
    title: "Privacy & Cookie Policy",
    summary:
      "Metadata Checker minimizes data collection and uses essential session cookies to maintain authenticated workspace state.",
    points: [
      "Essential Cookies: HttpOnly, SameSite=Lax session cookies used strictly for user authentication and CSRF protection.",
      "Document Privacy: Uploaded PDFs and generated Excel exports are scoped to the authenticated account owner.",
      "Zero Third-Party Advertising: Financial statement contents are never shared with external advertising networks.",
      "You can review or update your cookie consent preferences at any time.",
    ],
  },
  security: {
    category: "Security & Privacy",
    title: "Security Architecture",
    summary:
      "Security controls are enforced across authentication, session management, and document processing.",
    points: [
      "Password Hashing: User passwords are hashed with bcrypt (cost factor 12) and rate-limited against brute-force attempts.",
      "Session Token Hashing: Raw session tokens are hashed using SHA-256 before database persistence.",
      "In-Memory PDF Unlocking: Passwords provided for encrypted bank statements are used only in memory during extraction.",
      "Formula Injection Defense: Exported Excel cells are sanitized against spreadsheet formula injection (CWE-1236).",
    ],
  },
  "data-protection": {
    category: "Security & Privacy",
    title: "Data Protection & Access Control",
    summary:
      "Role-Based Access Control (RBAC) and strict ownership checks protect uploaded documents and exported reports.",
    points: [
      "Tenant Isolation: Standard users can only view, analyze, and export their own uploaded documents (IDOR protection).",
      "Admin Authorization Gate: Newly registered accounts remain in PENDING status until explicitly authorized by an Administrator.",
      "Immediate Session Revocation: Deactivating a user account immediately invalidates all active sessions for that user.",
      "Audit Logging: Authentication events and administrative actions are recorded with sensitive fields redacted.",
    ],
  },
};

export const Footer: React.FC<FooterProps> = ({
  variant = "marketing",
  isAuthenticated = false,
  onNavigateTab,
  onNavigateAbout,
}) => {
  const [activeInfoTopic, setActiveInfoTopic] = useState<InfoModalTopic>(null);

  const handleAboutClick = () => {
    if (onNavigateAbout) {
      onNavigateAbout();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (onNavigateTab) {
      onNavigateTab("about");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      setActiveInfoTopic("about");
    }
  };

  const handleProductNav = (tab: FooterNavigationTab, sectionId?: string) => {
    if (isAuthenticated && onNavigateTab) {
      onNavigateTab(tab, sectionId);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      setActiveInfoTopic("documentation");
    }
  };

  const handleOpenCookiePreferences = () => {
    window.dispatchEvent(new CustomEvent("mc:open-cookie-settings"));
  };

  const renderInfoModal = () => {
    if (!activeInfoTopic) return null;
    const info = INFO_MODAL_CONTENT[activeInfoTopic];

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs"
        role="dialog"
        aria-modal="true"
        aria-labelledby="footer-info-modal-title"
      >
        <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 sm:p-7 shadow-lg space-y-4">
          <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <span className="text-[11px] font-semibold text-blue-600 block">
                {info.category}
              </span>
              <h3
                id="footer-info-modal-title"
                className="text-base font-bold text-slate-900 tracking-tight mt-0.5"
              >
                {info.title}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setActiveInfoTopic(null)}
              aria-label="Close information dialog"
              className="p-1 text-slate-400 hover:text-slate-700 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">{info.summary}</p>

          <ul className="space-y-2 pt-1">
            {info.points.map((pt, idx) => (
              <li key={idx} className="flex items-start gap-2.5 text-xs text-slate-700 leading-relaxed">
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                <span>{pt}</span>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-4 border-t border-slate-100">
            {activeInfoTopic === "privacy" ? (
              <button
                type="button"
                onClick={() => {
                  setActiveInfoTopic(null);
                  handleOpenCookiePreferences();
                }}
                className="px-3.5 py-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100/80 rounded-xl transition-colors cursor-pointer"
              >
                Manage Cookie Preferences
              </button>
            ) : (
              <span className="text-[11px] text-slate-400">
                Metadata Checker · Designed &amp; Developed by Aziz
              </span>
            )}

            <button
              type="button"
              onClick={() => setActiveInfoTopic(null)}
              className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ============================================================================
  // COMPACT WORKSPACE FOOTER (variant === "app")
  // Used on Analyze, Recent Files, Exports, and Admin pages
  // ============================================================================
  if (variant === "app") {
    return (
      <>
        <footer
          role="contentinfo"
          aria-label="Workspace footer"
          className="border-t border-slate-200/90 bg-white mt-auto"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#64748B]">
              {/* Left: Icon Logo, Copyright & Creator */}
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-2.5 gap-y-1">
                <Logo variant="icon" size="xs" />
                <span className="font-semibold text-[#0F172A]">
                  © 2026 Metadata Checker
                </span>
                <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                  ·
                </span>
                <span className="text-[#64748B]">
                  Designed &amp; Developed by{" "}
                  <button
                    type="button"
                    onClick={handleAboutClick}
                    className="font-semibold text-[#0F172A] hover:text-[#2563EB] transition-colors cursor-pointer"
                  >
                    Aziz
                  </button>
                </span>
              </div>

              {/* Center / Right Links & Session Indicator */}
              <div className="flex flex-wrap items-center justify-center sm:justify-end gap-x-4 gap-y-1.5">
                <nav
                  aria-label="Workspace footer links"
                  className="flex items-center gap-2.5 text-xs text-slate-500"
                >
                  <button
                    type="button"
                    onClick={handleAboutClick}
                    className="hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded transition-colors cursor-pointer"
                  >
                    About
                  </button>
                  <span className="text-slate-300" aria-hidden="true">
                    ·
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveInfoTopic("privacy")}
                    className="hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded transition-colors cursor-pointer"
                  >
                    Privacy
                  </button>
                  <span className="text-slate-300" aria-hidden="true">
                    ·
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveInfoTopic("security")}
                    className="hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded transition-colors cursor-pointer"
                  >
                    Security
                  </button>
                  <span className="text-slate-300" aria-hidden="true">
                    ·
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveInfoTopic("contact")}
                    className="hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded transition-colors cursor-pointer"
                  >
                    Support
                  </button>
                </nav>

                <span className="text-slate-200 hidden sm:inline" aria-hidden="true">
                  |
                </span>

                <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
                  <Lock className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
                  <span>Secure Session</span>
                </div>
              </div>
            </div>
          </div>
        </footer>
        {renderInfoModal()}
      </>
    );
  }

  // ============================================================================
  // FULL ENTERPRISE SAAS FOOTER (variant === "marketing")
  // Used on Home / Landing Overview page, About page, and Authentication page
  // ============================================================================
  return (
    <>
      <footer
        role="contentinfo"
        aria-label="Site footer"
        className="border-t border-slate-200 bg-white mt-auto"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-8 sm:pt-14 sm:pb-10">
          {/* Primary 4-Column Grid (Mobile: 1 col, Tablet: 2 cols, Desktop: 4 cols) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-8 lg:gap-10 pb-10">
            {/* Column 1: Brand Section (5 cols on lg) */}
            <div className="lg:col-span-5 space-y-3.5">
              <Logo variant="full" size="md" showTagline={true} />

              <p className="text-xs text-[#64748B] leading-relaxed max-w-sm pt-1">
                Securely analyze, validate, and export financial documents with confidence.
              </p>
            </div>

            {/* Column 2: PRODUCT (3 cols on lg) */}
            <nav aria-label="Product navigation" className="lg:col-span-3 space-y-3">
              <h3 className="text-xs font-semibold text-slate-900 tracking-tight">
                Product
              </h3>
              <ul className="space-y-2 text-xs text-slate-600">
                <li>
                  <button
                    type="button"
                    onClick={() => handleProductNav("analyze")}
                    className="hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded transition-colors cursor-pointer text-left"
                  >
                    PDF Analysis
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => handleProductNav("analyze")}
                    className="hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded transition-colors cursor-pointer text-left"
                  >
                    Bank Detection
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => handleProductNav("analyze")}
                    className="hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded transition-colors cursor-pointer text-left"
                  >
                    Transaction Extraction
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => handleProductNav("analyze")}
                    className="hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded transition-colors cursor-pointer text-left"
                  >
                    Balance Validation
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => handleProductNav("exports")}
                    className="hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded transition-colors cursor-pointer text-left"
                  >
                    Excel Export
                  </button>
                </li>
              </ul>
            </nav>

            {/* Column 3: COMPANY (2 cols on lg) */}
            <nav aria-label="Company navigation" className="lg:col-span-2 space-y-3">
              <h3 className="text-xs font-semibold text-slate-900 tracking-tight">
                Company
              </h3>
              <ul className="space-y-2 text-xs text-slate-600">
                <li>
                  <button
                    type="button"
                    onClick={handleAboutClick}
                    className="hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded transition-colors cursor-pointer text-left"
                  >
                    About
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => setActiveInfoTopic("contact")}
                    className="hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded transition-colors cursor-pointer text-left"
                  >
                    Contact
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => setActiveInfoTopic("documentation")}
                    className="hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded transition-colors cursor-pointer text-left"
                  >
                    Documentation
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => setActiveInfoTopic("status")}
                    className="hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded transition-colors cursor-pointer text-left"
                  >
                    Status
                  </button>
                </li>
              </ul>
            </nav>

            {/* Column 4: SECURITY (2 cols on lg) */}
            <nav aria-label="Security navigation" className="lg:col-span-2 space-y-3">
              <h3 className="text-xs font-semibold text-slate-900 tracking-tight">
                Security
              </h3>
              <ul className="space-y-2 text-xs text-slate-600">
                <li>
                  <button
                    type="button"
                    onClick={() => setActiveInfoTopic("privacy")}
                    className="hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded transition-colors cursor-pointer text-left"
                  >
                    Privacy
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => setActiveInfoTopic("security")}
                    className="hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded transition-colors cursor-pointer text-left"
                  >
                    Security
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => setActiveInfoTopic("data-protection")}
                    className="hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded transition-colors cursor-pointer text-left"
                  >
                    Data Protection
                  </button>
                </li>
              </ul>
            </nav>
          </div>

          {/* Factual Security Trust Area */}
          <div
            aria-label="Security and privacy highlights"
            className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-5 border-t border-slate-100"
          >
            <div className="flex items-start gap-2.5">
              <Lock className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <span className="text-xs font-semibold text-slate-900 block">
                  Secure Processing
                </span>
                <span className="text-[11px] text-slate-500">
                  In-memory PDF decryption and deterministic structure validation
                </span>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <Database className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <span className="text-xs font-semibold text-slate-900 block">
                  Private Document Storage
                </span>
                <span className="text-[11px] text-slate-500">
                  Per-user document ownership and isolated statement records
                </span>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <span className="text-xs font-semibold text-slate-900 block">
                  Protected Account Data
                </span>
                <span className="text-[11px] text-slate-500">
                  Hashed session tokens and administrator-authorized access
                </span>
              </div>
            </div>
          </div>

          {/* Subtle Horizontal Divider & Bottom Bar with Author Branding */}
          <div className="pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
            <div className="flex flex-col sm:flex-row items-center gap-1.5 sm:gap-3 text-center sm:text-left">
              <span className="text-slate-500">
                Designed &amp; Developed by{" "}
                <button
                  type="button"
                  onClick={handleAboutClick}
                  className="font-semibold text-slate-800 hover:text-blue-600 transition-colors cursor-pointer"
                >
                  Aziz
                </button>
              </span>
              <span className="hidden sm:inline text-slate-300" aria-hidden="true">
                ·
              </span>
              <p className="text-slate-500">
                © 2026 Metadata Checker. All rights reserved.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-1.5 sm:gap-2.5 text-[11px] text-slate-500">
              <span>Secure Processing</span>
              <span className="hidden sm:inline text-slate-300" aria-hidden="true">
                •
              </span>
              <span>Private Storage</span>
              <span className="hidden sm:inline text-slate-300" aria-hidden="true">
                •
              </span>
              <span>Data Protection</span>
            </div>
          </div>
        </div>
      </footer>
      {renderInfoModal()}
    </>
  );
};
