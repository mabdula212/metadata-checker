import React, { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import {
  Lock,
  Mail,
  User,
  Shield,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  Loader2,
  UserPlus,
  LogIn,
  FileText,
  Eye,
  EyeOff,
  Landmark,
  Layers,
  FileSpreadsheet,
  ShieldCheck,
} from "lucide-react";
import { Logo } from "../ui/Logo";

export const LoginPage: React.FC = () => {
  const { login, register } = useAuth();

  // Mode: "login" | "register"
  const [mode, setMode] = useState<"login" | "register">("login");

  // Login fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // Register fields
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showRegConfirmPassword, setShowRegConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const switchMode = (newMode: "login" | "register") => {
    setMode(newMode);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMessage("Please enter both email and password.");
      return;
    }

    setErrorMessage(null);
    setLoading(true);

    try {
      const result = await login(email, password, rememberMe);
      if (!result.success) {
        setErrorMessage(result.error || "Invalid credentials or deactivated account.");
      }
    } catch {
      setErrorMessage("An unexpected authentication error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regEmail || !regPassword) {
      setErrorMessage("Please enter email and password.");
      return;
    }

    if (regPassword.length < 8) {
      setErrorMessage("Password must be at least 8 characters long.");
      return;
    }

    if (!/[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(regPassword)) {
      setErrorMessage("Password must include at least one number or special character.");
      return;
    }

    if (regPassword !== regConfirmPassword) {
      setErrorMessage("Passwords do not match. Please verify.");
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);
    setLoading(true);

    try {
      const result = await register(regName, regEmail, regPassword);
      if (!result.success) {
        setErrorMessage(result.error || "Failed to create account. Please try again.");
      } else if (result.pendingApproval) {
        setSuccessMessage(
          result.message ||
            "Registrasi berhasil! Akun Anda sedang menunggu otorisasi dari Administrator sebelum dapat digunakan untuk login."
        );
        setRegName("");
        setRegEmail("");
        setRegPassword("");
        setRegConfirmPassword("");
      } else {
        setSuccessMessage("Account created successfully! Redirecting...");
      }
    } catch {
      setErrorMessage("An unexpected error occurred during account creation.");
    } finally {
      setLoading(false);
    }
  };

  const isPasswordLongEnough = regPassword.length >= 8;
  const hasNumberOrSpecial = /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(regPassword);
  const passwordsMatch = regPassword.length > 0 && regPassword === regConfirmPassword;

  return (
    <div className="min-h-[82vh] flex items-center justify-center px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
      <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
        {/* Left Column (Desktop): Brand Identity & Value Proposition */}
        <div className="hidden lg:flex lg:col-span-7 flex-col justify-center space-y-8 pr-4">
          <div className="space-y-4">
            <Logo variant="full" size="lg" showTagline={true} />

            <h1 className="text-3xl xl:text-4xl font-extrabold tracking-tight text-[#0F172A] leading-tight pt-2">
              Analyze Financial Documents{" "}
              <span className="text-[#2563EB]">Smarter.</span>
            </h1>

            <p className="text-sm sm:text-base text-[#64748B] leading-relaxed max-w-xl">
              Extract metadata, detect banks, analyze transactions, validate balances, and export
              structured financial data from PDF documents with confidence.
            </p>
          </div>

          {/* Core Capabilities Grid */}
          <div className="grid grid-cols-2 gap-4 max-w-xl">
            <div className="p-4 rounded-xl bg-white border border-[#E2E8F0] shadow-2xs space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-[#0F172A]">
                <FileText className="w-4 h-4 text-[#2563EB] shrink-0" />
                <span>PDF Metadata Analysis</span>
              </div>
              <p className="text-xs text-[#64748B] leading-relaxed">
                Inspect structural metadata, producer properties, and SHA-256 document hashes.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white border border-[#E2E8F0] shadow-2xs space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-[#0F172A]">
                <Landmark className="w-4 h-4 text-[#2563EB] shrink-0" />
                <span>Bank Detection</span>
              </div>
              <p className="text-xs text-[#64748B] leading-relaxed">
                Recognize Indonesian banking statement layouts, periods, and account identifiers.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white border border-[#E2E8F0] shadow-2xs space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-[#0F172A]">
                <Layers className="w-4 h-4 text-[#2563EB] shrink-0" />
                <span>Transaction &amp; Balance Check</span>
              </div>
              <p className="text-xs text-[#64748B] leading-relaxed">
                Parse debit/credit mutations and reconcile mathematical running balances.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white border border-[#E2E8F0] shadow-2xs space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-[#0F172A]">
                <FileSpreadsheet className="w-4 h-4 text-[#2563EB] shrink-0" />
                <span>Structured Excel Export</span>
              </div>
              <p className="text-xs text-[#64748B] leading-relaxed">
                Export multi-sheet .xlsx workbooks ready for accounting and audit review.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-[#64748B] pt-1">
            <span className="inline-flex items-center gap-1.5 font-medium text-[#0F172A]">
              <ShieldCheck className="w-4 h-4 text-[#2563EB]" />
              Secure Processing
            </span>
            <span aria-hidden="true">·</span>
            <span>In-Memory PDF Decryption</span>
            <span aria-hidden="true">·</span>
            <span>Protected Account Access</span>
          </div>
        </div>

        {/* Right Column: Login / Register Card */}
        <div className="lg:col-span-5 w-full max-w-md mx-auto">
          {/* Mobile Brand Header (Shown above card on mobile/tablet) */}
          <div className="flex lg:hidden flex-col items-center text-center mb-6">
            <Logo variant="full" size="md" showTagline={true} />
          </div>

          <div className="w-full bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6 sm:p-8 space-y-6">
            {/* Card Header */}
            <div className="flex flex-col items-center text-center">
              <div className="hidden lg:flex mb-3">
                <Logo variant="icon" size="sm" />
              </div>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0F172A]">
                {mode === "login" ? "Sign in to Metadata Checker" : "Create an Account"}
              </h2>
              <p className="text-xs sm:text-sm text-[#64748B] mt-1 max-w-xs">
                {mode === "login"
                  ? "Enter your workspace credentials to access financial document analysis."
                  : "Register to inspect PDF metadata and extract statement records."}
              </p>
            </div>

        {/* Tab Switcher */}
        <div className="flex bg-slate-100 p-1 rounded-xl">
          <button
            id="auth-tab-login"
            type="button"
            onClick={() => switchMode("login")}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              mode === "login"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            Sign In
          </button>
          <button
            id="auth-tab-register"
            type="button"
            onClick={() => switchMode("register")}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              mode === "register"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            Create Account
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-600" />
            <span className="font-medium leading-relaxed">{errorMessage}</span>
          </div>
        )}

        {/* Success Alert */}
        {successMessage && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-600" />
            <span className="font-medium leading-relaxed">{successMessage}</span>
          </div>
        )}

        {/* Login Form */}
        {mode === "login" && (
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-email-input"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-600 focus:bg-white transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-password-input"
                  type={showLoginPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-9 pr-10 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-600 focus:bg-white transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword((prev) => !prev)}
                  aria-label={showLoginPassword ? "Hide password" : "Show password"}
                  title={showLoginPassword ? "Sembunyikan password" : "Tampilkan password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                >
                  {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-600"
                />
                <span className="text-xs text-slate-600">Remember me</span>
              </label>
            </div>

            <button
              id="login-submit-button"
              type="submit"
              disabled={loading}
              className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 px-4 bg-[#2563EB] hover:bg-[#1D4ED8] active:bg-blue-800 text-white text-xs sm:text-sm font-semibold rounded-xl shadow-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Authenticating...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}

        {/* Register Form */}
        {mode === "register" && (
          <form onSubmit={handleRegisterSubmit} className="space-y-4">
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
              <Shield className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <div className="leading-relaxed">
                <span className="font-semibold block">Butuh Otorisasi Administrator</span>
                Setiap pendaftaran akun baru berstatus <span className="font-semibold">PENDING</span> dan memerlukan persetujuan/otorisasi dari Admin sebelum dapat masuk ke sistem.
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
                Full Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="register-name-input"
                  type="text"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-600 focus:bg-white transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="register-email-input"
                  type="email"
                  required
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-600 focus:bg-white transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="register-password-input"
                  type={showRegPassword ? "text" : "password"}
                  required
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="w-full pl-9 pr-10 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-600 focus:bg-white transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowRegPassword((prev) => !prev)}
                  aria-label={showRegPassword ? "Hide password" : "Show password"}
                  title={showRegPassword ? "Sembunyikan password" : "Tampilkan password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                >
                  {showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="register-confirm-password-input"
                  type={showRegConfirmPassword ? "text" : "password"}
                  required
                  value={regConfirmPassword}
                  onChange={(e) => setRegConfirmPassword(e.target.value)}
                  placeholder="Repeat password"
                  className="w-full pl-9 pr-10 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-600 focus:bg-white transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowRegConfirmPassword((prev) => !prev)}
                  aria-label={showRegConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                  title={showRegConfirmPassword ? "Sembunyikan konfirmasi password" : "Tampilkan konfirmasi password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                >
                  {showRegConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Password Validation Rules checklist */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 text-[11px] space-y-1">
              <span className="font-semibold text-slate-700 block mb-1">Password Requirements:</span>
              <div className={`flex items-center gap-1.5 ${isPasswordLongEnough ? "text-emerald-700" : "text-slate-400"}`}>
                <span className="w-3.5">{isPasswordLongEnough ? "✓" : "○"}</span>
                <span>At least 8 characters</span>
              </div>
              <div className={`flex items-center gap-1.5 ${hasNumberOrSpecial ? "text-emerald-700" : "text-slate-400"}`}>
                <span className="w-3.5">{hasNumberOrSpecial ? "✓" : "○"}</span>
                <span>Includes number or special character</span>
              </div>
              <div className={`flex items-center gap-1.5 ${passwordsMatch ? "text-emerald-700" : "text-slate-400"}`}>
                <span className="w-3.5">{passwordsMatch ? "✓" : "○"}</span>
                <span>Passwords match</span>
              </div>
            </div>

            <button
              id="register-submit-button"
              type="submit"
              disabled={loading || !isPasswordLongEnough || !hasNumberOrSpecial || !passwordsMatch}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs sm:text-sm font-semibold rounded-xl shadow-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Creating Account...</span>
                </>
              ) : (
                <>
                  <span>Create Account</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}
          </div>
        </div>
      </div>
    </div>
  );
};
