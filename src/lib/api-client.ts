/**
 * Client-side API fetch wrapper with Bearer session authentication,
 * credentials transmission, and safe error & JSON parsing.
 * Prevents "Unexpected token '<', <html>... is not valid JSON" errors.
 */

export interface ApiResponse<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export async function safeApiFetch<T = any>(
  url: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const token = typeof window !== "undefined" ? localStorage.getItem("mc_token") : null;
  const headers = new Headers(options.headers || {});

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  try {
    const res = await fetch(url, {
      ...options,
      headers,
      credentials: "include",
    });

    const contentType = res.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      try {
        const json = await res.json();
        return {
          ok: res.ok,
          status: res.status,
          data: json,
          error: !res.ok ? (json?.error || `Request failed with status ${res.status}`) : undefined,
        };
      } catch {
        return {
          ok: false,
          status: res.status,
          error: "Invalid JSON response received from server.",
        };
      }
    }

    // Response is not JSON (e.g. HTML error page or plain text)
    const text = await res.text();
    let errorMsg = `Server response error (${res.status})`;

    if (res.status === 401) {
      errorMsg = "Authentication required. Please sign in again.";
    } else if (res.status === 403) {
      errorMsg = "Access denied or session expired. Please refresh the page.";
    } else if (res.status === 413) {
      errorMsg = "Uploaded file exceeds maximum allowed size (20 MB).";
    } else if (res.status === 502 || res.status === 503) {
      errorMsg = "Server temporarily unavailable. Please try again in a moment.";
    } else if (text && text.length < 150 && !text.includes("<html") && !text.includes("<!doctype")) {
      errorMsg = `Server error (${res.status}): ${text.trim()}`;
    }

    return {
      ok: false,
      status: res.status,
      error: errorMsg,
    };
  } catch (networkErr: any) {
    return {
      ok: false,
      status: 0,
      error: networkErr?.message
        ? `Network connection error: ${networkErr.message}`
        : "Failed to connect to server.",
    };
  }
}
