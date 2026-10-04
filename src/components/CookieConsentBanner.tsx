import React, { useState, useEffect } from "react";
import { ShieldCheck, Check, SlidersHorizontal, X } from "lucide-react";

const COOKIE_CONSENT_STORAGE_KEY = "mc_cookie_consent_v1";

export interface CookiePreferences {
  essential: boolean;
  functional: boolean;
  analytics: boolean;
  consentType: "all" | "essential" | "custom";
  updatedAt: string;
}

function setBrowserConsentCookie(value: string) {
  try {
    const maxAge = 365 * 24 * 60 * 60; // 1 year
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `mc_cookie_consent=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
  } catch {
    // ignore cookie errors in restricted contexts
  }
}

export const CookieConsentBanner: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [showCustomize, setShowCustomize] = useState(false);
  const [functionalEnabled, setFunctionalEnabled] = useState(true);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
      if (!saved) {
        setVisible(true);
      } else {
        const parsed = JSON.parse(saved) as CookiePreferences;
        setFunctionalEnabled(Boolean(parsed.functional));
        setAnalyticsEnabled(Boolean(parsed.analytics));
      }
    } catch {
      setVisible(true);
    }

    const handleOpenSettings = () => {
      setVisible(true);
      setShowCustomize(true);
    };

    window.addEventListener("mc:open-cookie-settings", handleOpenSettings);
    return () => {
      window.removeEventListener("mc:open-cookie-settings", handleOpenSettings);
    };
  }, []);

  const savePreferences = (prefs: CookiePreferences) => {
    try {
      localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(prefs));
      setBrowserConsentCookie(prefs.consentType);
    } catch {
      // ignore storage errors
    }
    setVisible(false);
    setShowCustomize(false);
  };

  const handleAcceptAll = () => {
    savePreferences({
      essential: true,
      functional: true,
      analytics: true,
      consentType: "all",
      updatedAt: new Date().toISOString(),
    });
  };

  const handleAcceptEssentialOnly = () => {
    savePreferences({
      essential: true,
      functional: false,
      analytics: false,
      consentType: "essential",
      updatedAt: new Date().toISOString(),
    });
  };

  const handleSaveCustom = () => {
    savePreferences({
      essential: true,
      functional: functionalEnabled,
      analytics: analyticsEnabled,
      consentType: "custom",
      updatedAt: new Date().toISOString(),
    });
  };

  if (!visible) {
    return null;
  }

  return (
    <div
      id="cookie-consent-banner"
      className="fixed bottom-4 inset-x-4 z-50 mx-auto max-w-3xl bg-white border border-slate-200 rounded-2xl shadow-lg p-5 sm:p-6 transition-all"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0 mt-0.5">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Pengaturan Privasi &amp; Cookie (Cookie Consent)
              </h3>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Website ini menggunakan cookie esensial untuk autentikasi sesi yang aman (`HttpOnly`), serta cookie fungsional dan analitik untuk meningkatkan pengalaman analisis dokumen PDF Anda.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleAcceptEssentialOnly}
            aria-label="Tutup banner cookie"
            className="text-slate-400 hover:text-slate-600 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {showCustomize && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-slate-100 text-xs">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-slate-900">Cookie Esensial</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Wajib untuk login, keamanan CSRF, dan sesi pengguna.
                </div>
              </div>
              <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-800 rounded">
                Aktif
              </span>
            </div>

            <label className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-start justify-between gap-2 cursor-pointer">
              <div>
                <div className="font-semibold text-slate-900">Fungsional</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Menyimpan preferensi tampilan dan fitur analisis PDF.
                </div>
              </div>
              <input
                type="checkbox"
                checked={functionalEnabled}
                onChange={(e) => setFunctionalEnabled(e.target.checked)}
                className="mt-0.5 w-4 h-4 text-blue-600 rounded border-slate-300"
              />
            </label>

            <label className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-start justify-between gap-2 cursor-pointer">
              <div>
                <div className="font-semibold text-slate-900">Analitik &amp; Performa</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Membantu mengoptimalkan kecepatan ekstraksi dokumen.
                </div>
              </div>
              <input
                type="checkbox"
                checked={analyticsEnabled}
                onChange={(e) => setAnalyticsEnabled(e.target.checked)}
                className="mt-0.5 w-4 h-4 text-blue-600 rounded border-slate-300"
              />
            </label>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => setShowCustomize((prev) => !prev)}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>{showCustomize ? "Sembunyikan Opsi" : "Pengaturan Cookie"}</span>
          </button>

          {showCustomize && (
            <button
              type="button"
              onClick={handleSaveCustom}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              <span>Simpan Pilihan</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleAcceptEssentialOnly}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors cursor-pointer"
          >
            <span>Hanya Cookie Esensial</span>
          </button>

          <button
            id="accept-all-cookies-btn"
            type="button"
            onClick={handleAcceptAll}
            className="inline-flex items-center justify-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Accept All Cookies</span>
          </button>
        </div>
      </div>
    </div>
  );
};
