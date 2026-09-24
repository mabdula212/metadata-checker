import fs from "fs";
import path from "path";
import type { StorageProvider, UploadOptions, UploadResult } from "./types.js";

/**
 * LocalStorageProvider
 *
 * NOTE: For local development and automated test suites ONLY.
 * Local filesystem storage is NOT persistent across Vercel / serverless deployments
 * because serverless execution lambdas are stateless and ephemeral.
 *
 * For Vercel production deployments, use VercelBlobStorageProvider or S3.
 */
export class LocalStorageProvider implements StorageProvider {
  public readonly name = "local";
  private readonly baseDir: string;
  private readonly memoryCache: Map<string, Buffer> = new Map();

  constructor(baseDir?: string) {
    const rawPath =
      baseDir ||
      process.env.LOCAL_STORAGE_PATH ||
      process.env.LOCAL_STORAGE_DIR ||
      "./storage/documents";

    this.baseDir = path.isAbsolute(rawPath)
      ? rawPath
      : path.resolve(process.cwd(), rawPath);
  }

  /**
   * Sanitizes a key to prevent directory traversal attacks (e.g. `../../etc/passwd`).
   */
  private sanitizeKey(key: string): string {
    const normalized = key.replace(/\\/g, "/").replace(/\.\./g, "");
    return normalized.replace(/^\/+/, "");
  }

  /**
   * Resolves the primary filesystem path for a given storage key.
   * If baseDir ends with 'documents' and the key starts with 'documents/',
   * avoids duplicate 'documents/documents/' nesting.
   */
  private resolvePath(cleanKey: string): string {
    if (
      path.basename(this.baseDir) === "documents" &&
      cleanKey.startsWith("documents/")
    ) {
      return path.join(this.baseDir, cleanKey.slice("documents/".length));
    }
    return path.join(this.baseDir, cleanKey);
  }

  public async upload(
    key: string,
    buffer: Buffer,
    _options?: UploadOptions
  ): Promise<UploadResult> {
    const cleanKey = this.sanitizeKey(key);
    const filePath = this.resolvePath(cleanKey);
    const dir = path.dirname(filePath);

    // Ensure target directory exists
    await fs.promises.mkdir(dir, { recursive: true });

    // Write binary buffer to disk
    await fs.promises.writeFile(filePath, buffer);

    // Keep in memory cache for instant same-process retrieval
    this.memoryCache.set(cleanKey, buffer);

    const storedFileName = path.basename(cleanKey);
    return {
      storageKey: cleanKey,
      storedFileName,
      size: buffer.length,
    };
  }

  public async download(key: string): Promise<Buffer> {
    const cleanKey = this.sanitizeKey(key);

    // 1. Check memory cache first
    if (this.memoryCache.has(cleanKey)) {
      return this.memoryCache.get(cleanKey)!;
    }

    // 2. Check primary storage directory
    const filePath = this.resolvePath(cleanKey);
    if (fs.existsSync(filePath)) {
      const buffer = await fs.promises.readFile(filePath);
      this.memoryCache.set(cleanKey, buffer);
      return buffer;
    }

    // Direct baseDir join fallback
    const directPath = path.join(this.baseDir, cleanKey);
    if (directPath !== filePath && fs.existsSync(directPath)) {
      const buffer = await fs.promises.readFile(directPath);
      this.memoryCache.set(cleanKey, buffer);
      return buffer;
    }

    // 3. Backward compatibility check for legacy ./uploads or root paths
    const legacyPath = path.join(process.cwd(), cleanKey);
    if (fs.existsSync(legacyPath)) {
      const buffer = await fs.promises.readFile(legacyPath);
      this.memoryCache.set(cleanKey, buffer);
      return buffer;
    }

    throw new Error(`Storage object not found: ${cleanKey}`);
  }

  public async delete(key: string): Promise<boolean> {
    const cleanKey = this.sanitizeKey(key);
    this.memoryCache.delete(cleanKey);

    const filePath = this.resolvePath(cleanKey);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      return true;
    }

    const legacyPath = path.join(process.cwd(), cleanKey);
    if (fs.existsSync(legacyPath)) {
      await fs.promises.unlink(legacyPath);
      return true;
    }

    return false;
  }

  public async exists(key: string): Promise<boolean> {
    const cleanKey = this.sanitizeKey(key);
    if (this.memoryCache.has(cleanKey)) return true;
    if (fs.existsSync(this.resolvePath(cleanKey))) return true;
    if (fs.existsSync(path.join(process.cwd(), cleanKey))) return true;
    return false;
  }
}
