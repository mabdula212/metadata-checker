import type { StorageProvider, UploadOptions, UploadResult } from "./types.js";

/**
 * VercelBlobStorageProvider
 *
 * Production-ready persistent storage provider for Vercel deployments.
 * Stores binary PDF files in Vercel Blob Object Storage, ensuring that
 * files persist across serverless invocations and cold starts.
 *
 * Requires environment variable: `BLOB_READ_WRITE_TOKEN`
 */
export class VercelBlobStorageProvider implements StorageProvider {
  public readonly name = "vercel-blob";
  private readonly token: string;

  constructor(token?: string) {
    this.token = token !== undefined ? token : (process.env.BLOB_READ_WRITE_TOKEN || "");
  }

  private ensureConfigured(): void {
    if (!this.token) {
      throw new Error(
        "Production storage is not configured. BLOB_READ_WRITE_TOKEN environment variable is not configured."
      );
    }
  }

  public async upload(
    key: string,
    buffer: Buffer,
    options?: UploadOptions
  ): Promise<UploadResult> {
    this.ensureConfigured();

    const cleanKey = key.replace(/\\/g, "/").replace(/^\/+/, "");
    const contentType = options?.contentType || "application/pdf";

    // Vercel Blob REST API upload
    const response = await fetch(`https://blob.vercel.com/${cleanKey}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${this.token}`,
        "x-content-type": contentType,
        "x-add-random-suffix": "false",
      },
      body: new Uint8Array(buffer),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Vercel Blob upload failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as { url: string; pathname?: string };
    const storedFileName = cleanKey.split("/").pop() || cleanKey;

    return {
      storageKey: cleanKey,
      storedFileName,
      size: buffer.length,
    };
  }

  public async download(key: string): Promise<Buffer> {
    this.ensureConfigured();

    const cleanKey = key.replace(/\\/g, "/").replace(/^\/+/, "");
    const response = await fetch(`https://blob.vercel.com/${cleanKey}`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${this.token}`,
      },
    });

    if (response.status === 404) {
      throw new Error(`Storage object not found in Vercel Blob: ${cleanKey}`);
    }

    if (!response.ok) {
      throw new Error(`Vercel Blob download failed (${response.status})`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  public async delete(key: string): Promise<boolean> {
    this.ensureConfigured();

    const cleanKey = key.replace(/\\/g, "/").replace(/^\/+/, "");
    const response = await fetch("https://blob.vercel.com/delete", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ urls: [`https://blob.vercel.com/${cleanKey}`] }),
    });

    return response.ok;
  }

  public async exists(key: string): Promise<boolean> {
    this.ensureConfigured();

    const cleanKey = key.replace(/\\/g, "/").replace(/^\/+/, "");
    const response = await fetch(`https://blob.vercel.com/${cleanKey}`, {
      method: "HEAD",
      headers: {
        authorization: `Bearer ${this.token}`,
      },
    });

    return response.ok;
  }
}
