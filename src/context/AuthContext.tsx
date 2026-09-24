import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "DEACTIVATED";
}

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  token: string | null;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<{ success: boolean; error?: string }>;
  register: (name: string, email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem("mc_token");
    } catch {
      return null;
    }
  });

  const refreshSession = useCallback(async () => {
    try {
      const storedToken = localStorage.getItem("mc_token");
      const headers: Record<string, string> = {};
      if (storedToken) {
        headers["Authorization"] = `Bearer ${storedToken}`;
      }

      const res = await fetch("/api/auth/session", {
        headers,
        credentials: "include",
      });

      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.user) {
          setUser(data.user);
        } else {
          setUser(null);
          localStorage.removeItem("mc_token");
          setToken(null);
        }
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const login = async (email: string, password: string, rememberMe: boolean = false) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, rememberMe }),
      });
      const contentType = res.headers.get("content-type") || "";
      let data: any = {};
      if (contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text();
        return { success: false, error: `Server error (${res.status}): ${text.slice(0, 100) || "Invalid response format"}` };
      }

      if (res.ok && data.success && data.user) {
        if (data.token) {
          try {
            localStorage.setItem("mc_token", data.token);
          } catch {}
          setToken(data.token);
        }
        setUser(data.user);
        return { success: true };
      }
      return { success: false, error: data.error || "Login failed" };
    } catch (err: any) {
      console.error("[LOGIN_FETCH_ERROR]", err);
      return { success: false, error: err?.message ? `Network error: ${err.message}` : "Network error connecting to authentication service." };
    }
  };

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

      if (res.ok && data.success && data.user) {
        if (data.token) {
          try {
            localStorage.setItem("mc_token", data.token);
          } catch {}
          setToken(data.token);
        }
        setUser(data.user);
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
      setToken(null);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, token, login, register, logout, refreshSession }}>
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
