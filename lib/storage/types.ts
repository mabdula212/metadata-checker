/**
 * Storage Abstraction Interfaces
 *
 * Decouples business logic from vendor-specific storage (Local FS, Vercel Blob, S3, etc.).
 * Guarantees Vercel serverless compatibility by isolating any local filesystem access
 * strictly to development and test runners.
 */

export interface UploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface UploadResult {
  storageKey: string;
  storedFileName: string;
  size: number;
}

export interface StorageProvider {
  readonly name: string;

  /**
   * Uploads a binary buffer to storage at the given canonical key.
   * Example key: `documents/{documentId}/{storedFileName}`
   */
  upload(key: string, buffer: Buffer, options?: UploadOptions): Promise<UploadResult>;

  /**
   * Downloads binary buffer from storage for a given key.
   * Throws an error if the object is missing or corrupted.
   */
  download(key: string): Promise<Buffer>;

  /**
   * Deletes the stored object at the given key.
   * Returns true if deleted, false if not found.
   */
  delete(key: string): Promise<boolean>;

  /**
   * Checks whether an object exists at the given key.
   */
  exists(key: string): Promise<boolean>;
}

export interface StorageKeyInfo {
  storageKey: string;
  storedFileName: string;
}

/**
 * Detects whether the current execution environment is a production or Vercel serverless environment.
 */
export function isProductionEnvironment(): boolean {
  if (process.env.VERCEL === "1" || process.env.VERCEL === "true") return true;
  if (process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview") return true;
  if (process.env.NODE_ENV === "production") return true;
  return false;
}
