import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  role: "USER" | "ADMIN";
  status: "PENDING" | "ACTIVE" | "DEACTIVATED";
}

export interface PendingDeviceInfo {
  id: string;
  deviceName: string;
  browser: string;
  operatingSystem: string;
  status: "PENDING" | "ACTIVE" | "REVOKED";
}

export interface LoginResponse {
  success: boolean;
  error?: string;
  code?: string;
  requiresDeviceApproval?: boolean;
  loginRequestId?: string;
  device?: PendingDeviceInfo;
  expiresAt?: string;
}

export interface LoginRequestPollResult {
  success: boolean;
  status?: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED";
  authenticated?: boolean;
  rejectionReason?: string | null;
  expiresAt?: string;
  error?: string;
}

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  token: string | null;
  sessionRevokedMessage: string | null;
  clearSessionRevokedMessage: () => void;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<LoginResponse>;
  checkLoginRequestStatus: (requestId: string) => Promise<LoginRequestPollResult>;
  cancelLoginRequest: (requestId: string) => Promise<void>;
  register: (
    name: string,
    email: string,
    password: string
  ) => Promise<{ success: boolean; pendingApproval?: boolean; message?: string; error?: string }>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [sessionRevokedMessage, setSessionRevokedMessage] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem("mc_token");
    } catch {
      return null;
    }
  });

  const clearSessionRevokedMessage = useCallback(() => {
    setSessionRevokedMessage(null);
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const storedToken = localStorage.getItem("mc_token");
      const storedDeviceToken = localStorage.getItem("mc_device_token");
      const headers: Record<string, string> = {};
      if (storedToken) {
        headers["Authorization"] = `Bearer ${storedToken}`;
      }
      if (storedDeviceToken) {
        headers["X-Device-Token"] = storedDeviceToken;
      }

      const res = await fetch("/api/auth/session", {
        headers,
        credentials: "include",
      });

      if (res.ok) {
        const data = await res.json();
        if (data.deviceToken) {
          try {
            localStorage.setItem("mc_device_token", data.deviceToken);
          } catch {}
        }
        if (data.authenticated && data.user) {
          setUser(data.user);
        } else {
          setUser((prevUser) => {
            if (prevUser || data.sessionRevoked) {
              setSessionRevokedMessage(
                "Sesi pada perangkat ini telah dihentikan karena akun Anda telah diotorisasi pada perangkat baru atau dicabut oleh Administrator."
              );
            }
            return null;
          });
          localStorage.removeItem("mc_token");
          setToken(null);
        }
      } else {
        setUser(null);
      }
    } catch {
      // Do not clear user on transient network hiccup
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  // Real-time session heartbeat & revocation listener for active sessions
  useEffect(() => {
    const handleSessionRevokedEvent = () => {
      localStorage.removeItem("mc_token");
      setToken(null);
      setUser(null);
      setSessionRevokedMessage(
        "Sesi pada perangkat ini telah dihentikan karena akun Anda telah diotorisasi pada perangkat baru atau dicabut oleh Administrator."
      );
    };

    window.addEventListener("mc:session-revoked", handleSessionRevokedEvent);

    if (!user) {
      return () => {
        window.removeEventListener("mc:session-revoked", handleSessionRevokedEvent);
      };
    }

    const interval = setInterval(() => {
      refreshSession();
    }, 5000);

    const handleFocus = () => {
      refreshSession();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("mc:session-revoked", handleSessionRevokedEvent);
    };
  }, [user, refreshSession]);

  const login = async (email: string, password: string, rememberMe: boolean = false): Promise<LoginResponse> => {
    try {
      const storedDeviceToken = (() => {
        try {
          return localStorage.getItem("mc_device_token");
        } catch {
          return null;
        }
      })();

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (storedDeviceToken) {
        headers["X-Device-Token"] = storedDeviceToken;
      }

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          email,
          password,
          rememberMe,
          deviceToken: storedDeviceToken || undefined,
        }),
      });
      const contentType = res.headers.get("content-type") || "";
      let data: any = {};
      if (contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text();
        return { success: false, error: `Server error (${res.status}): ${text.slice(0, 100) || "Invalid response format"}` };
      }

      if (data.deviceToken) {
        try {
          localStorage.setItem("mc_device_token", data.deviceToken);
        } catch {}
      }

      if (res.ok && data.success && data.user) {
        if (data.token) {
          try {
            localStorage.setItem("mc_token", data.token);
          } catch {}
          setToken(data.token);
        }
        setSessionRevokedMessage(null);
        setUser(data.user);
        return { success: true };
      }

      if (data.requiresDeviceApproval || data.code === "DEVICE_APPROVAL_REQUIRED") {
        return {
          success: false,
          code: "DEVICE_APPROVAL_REQUIRED",
          requiresDeviceApproval: true,
          loginRequestId: data.loginRequestId,
          device: data.device,
          expiresAt: data.expiresAt,
          error:
            data.error ||
            "Perangkat baru terdeteksi. Login dari perangkat ini membutuhkan persetujuan Administrator.",
        };
      }

      return {
        success: false,
        code: data.code,
        error: data.error || "Login failed",
      };
    } catch (err: any) {
      console.error("[LOGIN_FETCH_ERROR]", err);
      return { success: false, error: err?.message ? `Network error: ${err.message}` : "Network error connecting to authentication service." };
    }
  };

  const checkLoginRequestStatus = useCallback(async (requestId: string): Promise<LoginRequestPollResult> => {
    try {
      const storedDeviceToken = (() => {
        try {
          return localStorage.getItem("mc_device_token");
        } catch {
          return null;
        }
      })();

      const headers: Record<string, string> = {};
      if (storedDeviceToken) {
        headers["X-Device-Token"] = storedDeviceToken;
      }

      const res = await fetch(
        `/api/auth/login-request?requestId=${encodeURIComponent(requestId)}`,
        {
          method: "GET",
          headers,
          credentials: "include",
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        return {
          success: false,
          error: errData.error || "Gagal memeriksa status persetujuan perangkat.",
        };
      }

      const data = await res.json();
      if (data.deviceToken) {
        try {
          localStorage.setItem("mc_device_token", data.deviceToken);
        } catch {}
      }

      if (data.status === "APPROVED" && data.authenticated && data.user) {
        if (data.token) {
          try {
            localStorage.setItem("mc_token", data.token);
          } catch {}
          setToken(data.token);
        }
        setUser(data.user);
        return {
          success: true,
          status: "APPROVED",
          authenticated: true,
        };
      }

      return {
        success: true,
        status: data.status,
        authenticated: false,
        rejectionReason: data.rejectionReason,
        expiresAt: data.expiresAt,
      };
    } catch {
      return {
        success: false,
        error: "Kesalahan jaringan saat memeriksa status otorisasi perangkat.",
      };
    }
  }, []);

  const cancelLoginRequest = useCallback(async (requestId: string): Promise<void> => {
    try {
      const storedDeviceToken = (() => {
        try {
          return localStorage.getItem("mc_device_token");
        } catch {
          return null;
        }
      })();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (storedDeviceToken) {
        headers["X-Device-Token"] = storedDeviceToken;
      }
      await fetch("/api/auth/login-request", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          requestId,
          action: "CANCEL",
          deviceToken: storedDeviceToken || undefined,
        }),
      });
    } catch {
      // Ignore cancellation errors
    }
  }, []);

  const register = async (name: string, email: string, password: string) => {
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, email, password }),
      });
      const contentType = res.headers.get("content-type") || "";
      let data: any = {};
      if (contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text();
        return { success: false, error: `Server error (${res.status}): ${text.slice(0, 100) || "Invalid response format"}` };
      }

      if (res.ok && data.success) {
        if (data.pendingApproval || data.user?.status === "PENDING") {
          return {
            success: true,
            pendingApproval: true,
            message:
              data.message ||
              "Registrasi berhasil! Akun Anda sedang menunggu otorisasi Administrator sebelum dapat digunakan untuk login.",
          };
        }
        if (data.user) {
          if (data.token) {
            try {
              localStorage.setItem("mc_token", data.token);
            } catch {}
            setToken(data.token);
          }
          setUser(data.user);
        }
        return { success: true };
      }
      return { success: false, error: data.error || "Failed to create account." };
    } catch (err: any) {
      console.error("[REGISTER_FETCH_ERROR]", err);
      return { success: false, error: err?.message ? `Network error: ${err.message}` : "Network error connecting to registration service." };
    }
  };

  const logout = async () => {
    try {
      const storedToken = localStorage.getItem("mc_token");
      const headers: Record<string, string> = {};
      if (storedToken) {
        headers["Authorization"] = `Bearer ${storedToken}`;
      }
      await fetch("/api/auth/logout", {
        method: "POST",
        headers,
        credentials: "include",
      });
    } finally {
      try {
        localStorage.removeItem("mc_token");
      } catch {}
      setSessionRevokedMessage(null);
      setToken(null);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        token,
        sessionRevokedMessage,
        clearSessionRevokedMessage,
        login,
        checkLoginRequestStatus,
        cancelLoginRequest,
        register,
        logout,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
