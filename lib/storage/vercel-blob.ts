import {
  put,
  get,
  head,
  del,
  BlobNotFoundError,
  type PutBlobResult,
  type GetBlobResult,
  type HeadBlobResult,
} from "@vercel/blob";
import type { StorageProvider, UploadOptions, UploadResult } from "./types.js";

export type StorageErrorCategory =
  | "configuration_error"
  | "authentication_error"
  | "authorization_error"
  | "deployment_not_found"
  | "blob_api_error"
  | "network_error";

/**
 * Classifies a storage error into distinct categories for diagnostics and monitoring.
 * Strictly guarantees that no tokens, secrets, or confidential values are included.
 */
export function categorizeBlobError(err: unknown): StorageErrorCategory {
  if (!err) return "blob_api_error";
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  // 1. Configuration error
  if (
    lower.includes("not configured") ||
    lower.includes("blob_read_write_token") ||
    lower.includes("token is required") ||
    lower.includes("no blob credentials") ||
    lower.includes("missing token")
  ) {
    return "configuration_error";
  }

  // 2. Deployment not found (e.g. edge routing / incorrect deployment domain)
  if (
    message.includes("DEPLOYMENT_NOT_FOUND") ||
    lower.includes("deployment could not be found") ||
    lower.includes("deployment_not_found")
  ) {
    return "deployment_not_found";
  }

  // 3. Authentication error (401, token expired, invalid token)
  if (
    lower.includes("unauthorized") ||
    lower.includes("401") ||
    lower.includes("invalid token") ||
    lower.includes("token expired") ||
    (err as any)?.name === "BlobAccessError" ||
    (err as any)?.name === "BlobClientTokenExpiredError"
  ) {
    return "authentication_error";
  }

  // 4. Authorization error (403, forbidden, access denied)
  if (
    lower.includes("forbidden") ||
    lower.includes("403") ||
    lower.includes("access denied") ||
    lower.includes("permission denied")
  ) {
    return "authorization_error";
  }

  // 5. Network error
  if (
    lower.includes("fetch failed") ||
    lower.includes("econnreset") ||
    lower.includes("enotfound") ||
    lower.includes("econnrefused") ||
    lower.includes("network error") ||
    lower.includes("timeout") ||
    (err as any)?.name === "TypeError"
  ) {
    return "network_error";
  }

  // 6. Generic Blob API error
  return "blob_api_error";
}

/**
 * Logs storage failure events with structured category information without exposing secrets.
 */
export function logBlobError(operation: string, err: unknown): void {
  const category = categorizeBlobError(err);
  console.error(`[STORAGE] Vercel Blob ${operation} failed`);
  console.error(`[STORAGE] provider=vercel-blob`);
  console.error(`[STORAGE] error_category=${category}`);
}

/**
 * Interface representing the official @vercel/blob operations.
 * Allows injecting mocks during automated unit tests without requiring a real deployment.
 */
export interface VercelBlobClient {
  put(pathname: string, body: any, options: any): Promise<PutBlobResult>;
  get(urlOrPathname: string, options: any): Promise<GetBlobResult | null>;
  head(urlOrPathname: string, options: any): Promise<HeadBlobResult>;
  del(urlOrPathname: string[] | string, options?: any): Promise<void>;
}

let globalMockBlobClient: VercelBlobClient | null = null;

export function setGlobalMockBlobClient(mock: VercelBlobClient | null): void {
  globalMockBlobClient = mock;
}

export function getGlobalMockBlobClient(): VercelBlobClient | null {
  return globalMockBlobClient;
}

/**
 * VercelBlobStorageProvider
 *
 * Production-ready persistent storage provider for Vercel deployments.
 * Stores binary files in Vercel Blob Object Storage using the official `@vercel/blob` SDK.
 *
 * - Authenticates using `BLOB_READ_WRITE_TOKEN`.
 * - Preserves PRIVATE Blob storage access by default.
 * - Does not depend on ephemeral deployment IDs or manually constructed URLs.
 * - Categorizes and logs errors without leaking secrets.
 */
export class VercelBlobStorageProvider implements StorageProvider {
  public readonly name = "vercel-blob";
  private readonly token: string;
  private readonly access: "private" | "public";
  private readonly customClient?: VercelBlobClient;

  public static get mockClient(): VercelBlobClient | null {
    return globalMockBlobClient;
  }

  public static set mockClient(mock: VercelBlobClient | null) {
    globalMockBlobClient = mock;
  }

  constructor(
    token?: string,
    options?:
      | {
          access?: "private" | "public";
          client?: VercelBlobClient;
        }
      | VercelBlobClient
  ) {
    this.token = token !== undefined ? token : (process.env.BLOB_READ_WRITE_TOKEN || "");
    if (options && typeof (options as any).put === "function") {
      this.access = "private";
      this.customClient = options as VercelBlobClient;
    } else {
      const opts = options as { access?: "private" | "public"; client?: VercelBlobClient } | undefined;
      this.access = opts?.access || (process.env.BLOB_ACCESS === "public" ? "public" : "private");
      this.customClient = opts?.client;
    }
  }

  private ensureConfigured(): void {
    if (!this.token) {
      throw new Error(
        "Production storage is not configured. BLOB_READ_WRITE_TOKEN environment variable is not configured."
      );
    }
  }

  private getClient(): VercelBlobClient {
    if (this.customClient) return this.customClient;
    if (globalMockBlobClient) return globalMockBlobClient;
    return {
      put,
      get: get as any,
      head: head as any,
      del,
    };
  }

  public async upload(
    key: string,
    buffer: Buffer,
    options?: UploadOptions
  ): Promise<UploadResult> {
    this.ensureConfigured();

    const cleanKey = key.replace(/\\/g, "/").replace(/^\/+/, "");
    const contentType =
      options?.contentType ||
      (cleanKey.endsWith(".pdf")
        ? "application/pdf"
        : cleanKey.endsWith(".xlsx")
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "application/octet-stream");

    // Independent byte slice to avoid detach issues across asynchronous invocations
    const uploadBuffer = Buffer.from(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    );

    try {
      const client = this.getClient();
      await client.put(cleanKey, uploadBuffer, {
        access: this.access,
        token: this.token,
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
      });

      const storedFileName = cleanKey.split("/").pop() || cleanKey;
      return {
        storageKey: cleanKey,
        storedFileName,
        size: buffer.length,
      };
    } catch (err: unknown) {
      logBlobError("upload", err);
      const rawMsg = err instanceof Error ? err.message : String(err);
      const sanitized = rawMsg
        .replace(/vercel_blob_rw_[a-zA-Z0-9_-]+/gi, "[REDACTED_BLOB_TOKEN]")
        .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, "Bearer [REDACTED]");
      throw new Error(`Vercel Blob upload failed: ${sanitized}`);
    }
  }

  public async download(key: string): Promise<Buffer> {
    this.ensureConfigured();

    const cleanKey = key.replace(/\\/g, "/").replace(/^\/+/, "");

    try {
      const client = this.getClient();
      const result = await client.get(cleanKey, {
        access: this.access,
        token: this.token,
        useCache: false,
      });

      if (!result || result.statusCode === 304 || !result.stream) {
        throw new Error(`Storage object not found in Vercel Blob: ${cleanKey}`);
      }

      const chunks: Uint8Array[] = [];
      for await (const chunk of result.stream) {
        chunks.push(chunk as Uint8Array);
      }
      return Buffer.concat(chunks);
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      if (
        rawMsg.includes("not found") ||
        rawMsg.includes("404") ||
        rawMsg.includes("Storage object not found") ||
        (err as any)?.name === "BlobNotFoundError"
      ) {
        throw new Error(`Storage object not found in Vercel Blob: ${cleanKey}`);
      }

      logBlobError("download", err);
      const sanitized = rawMsg
        .replace(/vercel_blob_rw_[a-zA-Z0-9_-]+/gi, "[REDACTED_BLOB_TOKEN]")
        .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, "Bearer [REDACTED]");
      throw new Error(`Vercel Blob download failed: ${sanitized}`);
    }
  }

  public async delete(key: string): Promise<boolean> {
    this.ensureConfigured();

    const cleanKey = key.replace(/\\/g, "/").replace(/^\/+/, "");

    try {
      const client = this.getClient();
      await client.del(cleanKey, {
        token: this.token,
      });
      return true;
    } catch {
      return false;
    }
  }

  public async exists(key: string): Promise<boolean> {
    this.ensureConfigured();

    const cleanKey = key.replace(/\\/g, "/").replace(/^\/+/, "");

    try {
      const client = this.getClient();
      const meta = await client.head(cleanKey, {
        token: this.token,
      });
      return Boolean(meta && typeof meta.size === "number");
    } catch (err: unknown) {
      if (err instanceof BlobNotFoundError || (err as any)?.name === "BlobNotFoundError") {
        return false;
      }
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
        return false;
      }
      return false;
    }
  }
}
