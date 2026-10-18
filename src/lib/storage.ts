import path from "path";
import { promises as fs } from "fs";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export class StorageError extends Error {
  constructor(
    message: string = "Storage operation failed.",
    public statusCode: number = 500
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export class StorageConfigurationError extends StorageError {
  constructor(
    message: string = "Object storage is not properly configured for this environment."
  ) {
    super(message, 503);
    this.name = "StorageConfigurationError";
  }
}

export interface StoredObjectMetadata {
  exists: boolean;
  byteLength: number;
  contentType?: string;
}

export interface PresignedUploadTarget {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export interface StorageProvider {
  readonly providerName: "s3" | "local" | "memory";

  putObject(params: {
    storageKey: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<{ byteLength: number }>;

  headObject(storageKey: string): Promise<StoredObjectMetadata>;

  getObjectBytes(
    storageKey: string,
    maxBytes?: number
  ): Promise<Uint8Array | null>;

  /**
   * Promotes an upload by writing the exact server-validated byte buffer to a distinct
   * final storage key ('workspaces/.../blobs/...') and removing the staging object.
   * Never copies from the mutable staging key, closing any TOCTOU window.
   */
  promoteObject(params: {
    sourceKey: string;
    destinationKey: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<{ byteLength: number }>;

  createPresignedUploadUrl?(params: {
    storageKey: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds?: number;
  }): Promise<PresignedUploadTarget>;

  createPresignedDownloadUrl?(params: {
    storageKey: string;
    contentDisposition: string;
    contentType: string;
    expiresInSeconds?: number;
  }): Promise<{ url: string; expiresInSeconds: number }>;

  deleteObject(storageKey: string): Promise<void>;

  checkConnectivity?(
    timeoutMs?: number
  ): Promise<{ reachable: boolean; latencyMs?: number }>;
}

const STAGING_STORAGE_KEY_PATTERN =
  /^workspaces\/([a-zA-Z0-9_-]+)\/artifacts\/([a-zA-Z0-9_-]+)\/staging\/([a-zA-Z0-9_-]+)$/;

const FINAL_STORAGE_KEY_PATTERN =
  /^workspaces\/([a-zA-Z0-9_-]+)\/artifacts\/([a-zA-Z0-9_-]+)\/blobs\/([a-zA-Z0-9_-]+)$/;

const SAFE_STORAGE_KEY_PATTERN =
  /^workspaces\/[a-zA-Z0-9_-]+\/artifacts\/[a-zA-Z0-9_-]+\/(?:staging|blobs)\/[a-zA-Z0-9_-]+$/;

export const HEALTH_CHECK_PROBE_KEY =
  "workspaces/health/artifacts/probe/blobs/marker";

/**
 * Validates that a storageKey adheres strictly to the generated internal key format
 * (either staging or final blobs) and contains no path traversal, backslashes, or arbitrary user-controlled segments.
 */
export function assertSafeStorageKey(storageKey: string): void {
  if (
    !storageKey ||
    typeof storageKey !== "string" ||
    storageKey.includes("..") ||
    storageKey.includes("\\") ||
    storageKey.startsWith("/") ||
    !SAFE_STORAGE_KEY_PATTERN.test(storageKey)
  ) {
    throw new StorageError("Invalid or unsafe storage key rejected.", 400);
  }
}

export function isStagingStorageKey(storageKey: string): boolean {
  return (
    typeof storageKey === "string" &&
    !storageKey.includes("..") &&
    STAGING_STORAGE_KEY_PATTERN.test(storageKey)
  );
}

export function isFinalStorageKey(storageKey: string): boolean {
  return (
    typeof storageKey === "string" &&
    !storageKey.includes("..") &&
    FINAL_STORAGE_KEY_PATTERN.test(storageKey)
  );
}

export function assertStagingStorageKey(storageKey: string): void {
  assertSafeStorageKey(storageKey);
  if (!isStagingStorageKey(storageKey)) {
    throw new StorageError(
      "Expected a staging storage key ('workspaces/.../staging/...').",
      400
    );
  }
}

export function assertFinalStorageKey(storageKey: string): void {
  assertSafeStorageKey(storageKey);
  if (!isFinalStorageKey(storageKey)) {
    throw new StorageError(
      "Expected a finalized storage key ('workspaces/.../blobs/...').",
      400
    );
  }
}

/**
 * Validates that a promotion operation moves strictly from a staging key to a distinct final key
 * within the exact same workspace and artifact scope.
 */
export function assertValidPromotionKeys(
  sourceKey: string,
  destinationKey: string
): void {
  assertStagingStorageKey(sourceKey);
  assertFinalStorageKey(destinationKey);

  if (sourceKey === destinationKey) {
    throw new StorageError(
      "Promotion destination key must be distinct from the staging source key.",
      400
    );
  }

  const srcMatch = STAGING_STORAGE_KEY_PATTERN.exec(sourceKey);
  const destMatch = FINAL_STORAGE_KEY_PATTERN.exec(destinationKey);

  if (
    !srcMatch ||
    !destMatch ||
    srcMatch[1] !== destMatch[1] ||
    srcMatch[2] !== destMatch[2]
  ) {
    throw new StorageError(
      "Cannot promote object across mismatched workspace or artifact scopes.",
      400
    );
  }
}

function assertValidPromotionBytes(bytes: Uint8Array | undefined): Uint8Array {
  if (!bytes || !ArrayBuffer.isView(bytes) || bytes.byteLength === 0) {
    throw new StorageError(
      "Promotion requires a non-empty validated byte buffer.",
      400
    );
  }
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy;
}

function isPlaceholderValue(value: string | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim().toLowerCase();
  return (
    trimmed.length === 0 ||
    trimmed.startsWith("placeholder_") ||
    trimmed === "changeme" ||
    trimmed === "your-bucket-name"
  );
}

export interface S3StorageConfig {
  bucketName: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  client?: S3Client;
}

/**
 * Private S3-compatible storage adapter using AWS SDK v3.
 * Never exposes long-lived credentials or makes objects public.
 */
export class S3StorageProvider implements StorageProvider {
  public readonly providerName = "s3" as const;
  private readonly client: S3Client;
  private readonly bucketName: string;

  constructor(config: S3StorageConfig) {
    if (!config.bucketName || isPlaceholderValue(config.bucketName)) {
      throw new StorageConfigurationError(
        "S3_BUCKET_NAME must be configured with a valid private bucket name."
      );
    }
    if (!config.region || isPlaceholderValue(config.region)) {
      throw new StorageConfigurationError(
        "S3_REGION must be configured for S3 storage."
      );
    }

    this.bucketName = config.bucketName;

    if (config.client) {
      this.client = config.client;
      return;
    }

    const hasExplicitCredentials =
      config.accessKeyId &&
      config.secretAccessKey &&
      !isPlaceholderValue(config.accessKeyId) &&
      !isPlaceholderValue(config.secretAccessKey);

    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint && !isPlaceholderValue(config.endpoint)
        ? { endpoint: config.endpoint }
        : {}),
      ...(typeof config.forcePathStyle === "boolean"
        ? { forcePathStyle: config.forcePathStyle }
        : {}),
      ...(hasExplicitCredentials
        ? {
            credentials: {
              accessKeyId: config.accessKeyId!,
              secretAccessKey: config.secretAccessKey!,
            },
          }
        : {}),
    });
  }

  async putObject(params: {
    storageKey: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<{ byteLength: number }> {
    assertSafeStorageKey(params.storageKey);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: params.storageKey,
          Body: params.bytes,
          ContentType: params.contentType,
          ContentLength: params.bytes.byteLength,
        })
      );
      return { byteLength: params.bytes.byteLength };
    } catch {
      throw new StorageError("Failed to store object in private storage.", 502);
    }
  }

  async headObject(storageKey: string): Promise<StoredObjectMetadata> {
    assertSafeStorageKey(storageKey);
    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: storageKey,
        })
      );
      return {
        exists: true,
        byteLength: response.ContentLength ?? 0,
        contentType: response.ContentType,
      };
    } catch (err: unknown) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      const name = (err as { name?: string })?.name;
      if (status === 404 || name === "NotFound" || name === "NoSuchKey") {
        return { exists: false, byteLength: 0 };
      }
      throw new StorageError("Failed to verify object metadata in storage.", 502);
    }
  }

  async getObjectBytes(
    storageKey: string,
    maxBytes?: number
  ): Promise<Uint8Array | null> {
    assertSafeStorageKey(storageKey);
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: storageKey,
          ...(typeof maxBytes === "number" && maxBytes > 0
            ? { Range: `bytes=0-${maxBytes - 1}` }
            : {}),
        })
      );
      if (!response.Body) {
        return null;
      }
      const byteArray = await response.Body.transformToByteArray();
      return new Uint8Array(byteArray);
    } catch (err: unknown) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      const name = (err as { name?: string })?.name;
      if (status === 404 || name === "NotFound" || name === "NoSuchKey") {
        return null;
      }
      throw new StorageError("Failed to read object from private storage.", 502);
    }
  }

  async promoteObject(params: {
    sourceKey: string;
    destinationKey: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<{ byteLength: number }> {
    assertValidPromotionKeys(params.sourceKey, params.destinationKey);
    const exactBytes = assertValidPromotionBytes(params.bytes);
    const effectiveContentType =
      params.contentType || "application/octet-stream";

    // Write the exact validated byte buffer directly to the final 'blobs/' key via server-side PutObjectCommand
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: params.destinationKey,
          Body: exactBytes,
          ContentType: effectiveContentType,
          ContentLength: exactBytes.byteLength,
        })
      );
    } catch {
      throw new StorageError(
        "Failed to promote validated object to final storage key.",
        502
      );
    }

    // Remove the staging object after writing the final object
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: params.sourceKey,
        })
      );
    } catch {
      // Roll back the final object if staging cleanup fails so promotion remains atomic
      await this.client
        .send(
          new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: params.destinationKey,
          })
        )
        .catch(() => {});
      throw new StorageError(
        "Failed to remove staging object after promotion.",
        502
      );
    }

    return { byteLength: exactBytes.byteLength };
  }

  async createPresignedUploadUrl(params: {
    storageKey: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds?: number;
  }): Promise<PresignedUploadTarget> {
    // Presigned upload URLs are strictly restricted to staging keys; never sign upload URLs for final keys
    assertStagingStorageKey(params.storageKey);
    const expiresInSeconds = Math.min(
      Math.max(params.expiresInSeconds ?? 300, 30),
      900
    );
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: params.storageKey,
        ContentType: params.contentType,
        ContentLength: params.contentLength,
      });
      const url = await getSignedUrl(this.client, command, {
        expiresIn: expiresInSeconds,
      });
      return {
        url,
        method: "PUT",
        headers: {
          "Content-Type": params.contentType,
          "Content-Length": String(params.contentLength),
        },
        expiresInSeconds,
      };
    } catch {
      throw new StorageError(
        "Failed to generate presigned upload authorization.",
        502
      );
    }
  }

  async createPresignedDownloadUrl(params: {
    storageKey: string;
    contentDisposition: string;
    contentType: string;
    expiresInSeconds?: number;
  }): Promise<{ url: string; expiresInSeconds: number }> {
    assertFinalStorageKey(params.storageKey);
    const expiresInSeconds = Math.min(
      Math.max(params.expiresInSeconds ?? 120, 30),
      600
    );
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: params.storageKey,
        ResponseContentDisposition: params.contentDisposition,
        ResponseContentType: params.contentType,
      });
      const url = await getSignedUrl(this.client, command, {
        expiresIn: expiresInSeconds,
      });
      return { url, expiresInSeconds };
    } catch {
      throw new StorageError(
        "Failed to generate short-lived download URL.",
        502
      );
    }
  }

  async deleteObject(storageKey: string): Promise<void> {
    assertSafeStorageKey(storageKey);
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: storageKey,
        })
      );
    } catch {
      throw new StorageError(
        "Failed to delete object from private storage.",
        502
      );
    }
  }

  async checkConnectivity(
    timeoutMs: number = 3000
  ): Promise<{ reachable: boolean; latencyMs?: number }> {
    const start = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const probePromise = this.headObject(HEALTH_CHECK_PROBE_KEY);
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new StorageError("S3 storage connectivity probe timed out.", 504)),
          timeoutMs
        );
      });
      const meta = await Promise.race([probePromise, timeoutPromise]);
      // The probe marker object MUST exist and be readable. If it does not exist (404),
      // or if access was denied (403), readiness probe cannot verify storage capability.
      if (!meta.exists) {
        return { reachable: false };
      }
      return { reachable: true, latencyMs: Date.now() - start };
    } catch {
      return { reachable: false };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/**
 * Local development storage provider that persists files on disk strictly outside the public web root.
 */
export class LocalFileStorageProvider implements StorageProvider {
  public readonly providerName = "local" as const;
  private readonly rootDir: string;

  constructor(customRootDir?: string) {
    const configuredPath =
      customRootDir || process.env.LOCAL_STORAGE_PATH || ".storage/attachments";
    const resolvedRoot = path.resolve(process.cwd(), configuredPath);
    const publicDir = path.resolve(process.cwd(), "public");

    if (
      resolvedRoot === publicDir ||
      resolvedRoot.startsWith(publicDir + path.sep)
    ) {
      throw new StorageConfigurationError(
        "Local attachment storage directory must not be located inside the public/ web root."
      );
    }

    this.rootDir = resolvedRoot;
  }

  private resolveObjectPaths(storageKey: string): {
    blobPath: string;
    metaPath: string;
  } {
    assertSafeStorageKey(storageKey);
    const relativeSegments = storageKey.split("/");
    const blobPath = path.resolve(this.rootDir, ...relativeSegments);
    const rootWithSep = this.rootDir.endsWith(path.sep)
      ? this.rootDir
      : this.rootDir + path.sep;

    if (!blobPath.startsWith(rootWithSep)) {
      throw new StorageError("Storage path traversal blocked.", 400);
    }

    return {
      blobPath,
      metaPath: `${blobPath}.meta.json`,
    };
  }

  async putObject(params: {
    storageKey: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<{ byteLength: number }> {
    const { blobPath, metaPath } = this.resolveObjectPaths(params.storageKey);
    const dir = path.dirname(blobPath);
    const tmpPath = `${blobPath}.${process.pid}.${Date.now()}.tmp`;

    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(tmpPath, params.bytes);
      await fs.rename(tmpPath, blobPath);
      await fs.writeFile(
        metaPath,
        JSON.stringify({
          contentType: params.contentType,
          byteLength: params.bytes.byteLength,
          storedAt: new Date().toISOString(),
        }),
        "utf-8"
      );
      return { byteLength: params.bytes.byteLength };
    } catch {
      await fs.unlink(tmpPath).catch(() => {});
      throw new StorageError("Failed to write object to local storage.", 500);
    }
  }

  async headObject(storageKey: string): Promise<StoredObjectMetadata> {
    const { blobPath, metaPath } = this.resolveObjectPaths(storageKey);
    try {
      const stat = await fs.stat(blobPath);
      if (!stat.isFile()) {
        return { exists: false, byteLength: 0 };
      }
      let contentType: string | undefined;
      try {
        const metaRaw = await fs.readFile(metaPath, "utf-8");
        const meta = JSON.parse(metaRaw) as { contentType?: string };
        contentType = meta.contentType;
      } catch {
        // Metadata file is optional if stat succeeds
      }
      return {
        exists: true,
        byteLength: stat.size,
        contentType,
      };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        return { exists: false, byteLength: 0 };
      }
      throw new StorageError("Failed to inspect local storage object.", 500);
    }
  }

  async getObjectBytes(
    storageKey: string,
    maxBytes?: number
  ): Promise<Uint8Array | null> {
    const { blobPath } = this.resolveObjectPaths(storageKey);
    try {
      const buffer = await fs.readFile(blobPath);
      if (typeof maxBytes === "number" && maxBytes > 0 && buffer.byteLength > maxBytes) {
        return new Uint8Array(buffer.buffer, buffer.byteOffset, maxBytes);
      }
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        return null;
      }
      throw new StorageError("Failed to read object from local storage.", 500);
    }
  }

  async promoteObject(params: {
    sourceKey: string;
    destinationKey: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<{ byteLength: number }> {
    assertValidPromotionKeys(params.sourceKey, params.destinationKey);
    const exactBytes = assertValidPromotionBytes(params.bytes);
    const effectiveContentType =
      params.contentType || "application/octet-stream";

    const destPaths = this.resolveObjectPaths(params.destinationKey);
    const destDir = path.dirname(destPaths.blobPath);
    const tmpDestPath = `${destPaths.blobPath}.${process.pid}.${Date.now()}.tmp`;

    try {
      await fs.mkdir(destDir, { recursive: true });
      await fs.writeFile(tmpDestPath, exactBytes);
      await fs.rename(tmpDestPath, destPaths.blobPath);
      await fs.writeFile(
        destPaths.metaPath,
        JSON.stringify({
          contentType: effectiveContentType,
          byteLength: exactBytes.byteLength,
          promotedAt: new Date().toISOString(),
        }),
        "utf-8"
      );
    } catch {
      await fs.unlink(tmpDestPath).catch(() => {});
      await fs.unlink(destPaths.blobPath).catch(() => {});
      await fs.unlink(destPaths.metaPath).catch(() => {});
      throw new StorageError(
        "Failed to promote validated bytes to final local storage location.",
        500
      );
    }

    try {
      await this.deleteObject(params.sourceKey);
    } catch (err) {
      await fs.unlink(destPaths.blobPath).catch(() => {});
      await fs.unlink(destPaths.metaPath).catch(() => {});
      throw err;
    }

    return { byteLength: exactBytes.byteLength };
  }

  async deleteObject(storageKey: string): Promise<void> {
    const { blobPath, metaPath } = this.resolveObjectPaths(storageKey);
    try {
      await fs.unlink(blobPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
        throw new StorageError("Failed to delete object from local storage.", 500);
      }
    }
    try {
      await fs.unlink(metaPath);
    } catch {
      // Ignore missing companion meta file
    }
  }

  async checkConnectivity(
    _timeoutMs: number = 3000
  ): Promise<{ reachable: boolean; latencyMs?: number }> {
    const start = Date.now();
    try {
      await fs.access(this.rootDir).catch(async () => {
        await fs.mkdir(this.rootDir, { recursive: true });
      });
      const { blobPath } = this.resolveObjectPaths(HEALTH_CHECK_PROBE_KEY);
      const dir = path.dirname(blobPath);
      await fs.mkdir(dir, { recursive: true });
      try {
        await fs.access(blobPath);
      } catch {
        await fs.writeFile(blobPath, "syncspace-health-marker\n", "utf-8");
      }
      return { reachable: true, latencyMs: Date.now() - start };
    } catch {
      return { reachable: false };
    }
  }
}

/**
 * Isolated in-memory storage adapter for unit and integration tests.
 * Supports fault-injection hooks to test error handling, rollback, TOCTOU races, and retry behavior.
 */
export class InMemoryStorageProvider implements StorageProvider {
  public readonly providerName = "memory" as const;
  private readonly store = new Map<
    string,
    { bytes: Uint8Array; contentType: string }
  >();

  private failNextPut = false;
  private failNextDelete = false;
  private failNextGet = false;
  private failNextHead = false;
  private failNextPromote = false;
  private beforePromoteHook:
    | ((params: {
        sourceKey: string;
        destinationKey: string;
      }) => Promise<void> | void)
    | null = null;

  public setFailNextPut(fail = true): void {
    this.failNextPut = fail;
  }

  public setFailNextDelete(fail = true): void {
    this.failNextDelete = fail;
  }

  public setFailNextGet(fail = true): void {
    this.failNextGet = fail;
  }

  public setFailNextHead(fail = true): void {
    this.failNextHead = fail;
  }

  public setFailNextPromote(fail = true): void {
    this.failNextPromote = fail;
  }

  /**
   * Test-only hook invoked inside promoteObject before the final key is written.
   * Used to deterministically simulate a concurrent client overwriting the staging key
   * after completeUpload() has already read and validated the original staged bytes.
   */
  public setBeforePromoteHookForTests(
    hook:
      | ((params: {
          sourceKey: string;
          destinationKey: string;
        }) => Promise<void> | void)
      | null
  ): void {
    this.beforePromoteHook = hook;
  }

  public clear(): void {
    this.store.clear();
    this.failNextPut = false;
    this.failNextDelete = false;
    this.failNextGet = false;
    this.failNextHead = false;
    this.failNextPromote = false;
    this.beforePromoteHook = null;
  }

  public hasKey(storageKey: string): boolean {
    return this.store.has(storageKey);
  }

  public getKeys(): string[] {
    return Array.from(this.store.keys());
  }

  public size(): number {
    return this.store.size;
  }

  /**
   * Test-only helper to simulate bitrot or unauthorized out-of-band storage corruption
   * for testing retrieval-time SHA-256 integrity verification.
   */
  public corruptObjectBytesForTests(
    storageKey: string,
    corruptedBytes: Uint8Array
  ): void {
    const existing = this.store.get(storageKey);
    const copy = new Uint8Array(corruptedBytes.byteLength);
    copy.set(corruptedBytes);
    this.store.set(storageKey, {
      bytes: copy,
      contentType: existing?.contentType ?? "application/octet-stream",
    });
  }

  async putObject(params: {
    storageKey: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<{ byteLength: number }> {
    assertSafeStorageKey(params.storageKey);
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new StorageError("Simulated storage put failure.", 502);
    }
    const copy = new Uint8Array(params.bytes.byteLength);
    copy.set(params.bytes);
    this.store.set(params.storageKey, {
      bytes: copy,
      contentType: params.contentType,
    });
    return { byteLength: copy.byteLength };
  }

  async headObject(storageKey: string): Promise<StoredObjectMetadata> {
    assertSafeStorageKey(storageKey);
    if (this.failNextHead) {
      this.failNextHead = false;
      throw new StorageError("Simulated storage head failure.", 502);
    }
    const entry = this.store.get(storageKey);
    if (!entry) {
      return { exists: false, byteLength: 0 };
    }
    return {
      exists: true,
      byteLength: entry.bytes.byteLength,
      contentType: entry.contentType,
    };
  }

  async getObjectBytes(
    storageKey: string,
    maxBytes?: number
  ): Promise<Uint8Array | null> {
    assertSafeStorageKey(storageKey);
    if (this.failNextGet) {
      this.failNextGet = false;
      throw new StorageError("Simulated storage read failure.", 502);
    }
    const entry = this.store.get(storageKey);
    if (!entry) {
      return null;
    }
    if (typeof maxBytes === "number" && maxBytes > 0 && entry.bytes.byteLength > maxBytes) {
      return entry.bytes.slice(0, maxBytes);
    }
    return entry.bytes.slice();
  }

  async promoteObject(params: {
    sourceKey: string;
    destinationKey: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<{ byteLength: number }> {
    assertValidPromotionKeys(params.sourceKey, params.destinationKey);
    const exactBytes = assertValidPromotionBytes(params.bytes);

    if (this.beforePromoteHook) {
      const hook = this.beforePromoteHook;
      this.beforePromoteHook = null;
      await hook({
        sourceKey: params.sourceKey,
        destinationKey: params.destinationKey,
      });
    }

    if (this.failNextPromote) {
      this.failNextPromote = false;
      throw new StorageError("Simulated storage promotion failure.", 502);
    }
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new StorageError(
        "Simulated staging removal failure during promotion.",
        502
      );
    }

    // Write the exact validated byte buffer to destinationKey, ignoring any concurrent mutation of sourceKey
    this.store.set(params.destinationKey, {
      bytes: exactBytes,
      contentType: params.contentType || "application/octet-stream",
    });
    this.store.delete(params.sourceKey);
    return { byteLength: exactBytes.byteLength };
  }

  async deleteObject(storageKey: string): Promise<void> {
    assertSafeStorageKey(storageKey);
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new StorageError("Simulated storage delete failure.", 502);
    }
    this.store.delete(storageKey);
  }

  async checkConnectivity(
    _timeoutMs: number = 3000
  ): Promise<{ reachable: boolean; latencyMs?: number }> {
    if (this.failNextHead || this.failNextGet) {
      return { reachable: false };
    }
    const entry = this.store.get(HEALTH_CHECK_PROBE_KEY);
    if (!entry) {
      return { reachable: false };
    }
    return { reachable: true, latencyMs: 0 };
  }
}

let testStorageOverride: StorageProvider | null = null;
let cachedDefaultProvider: StorageProvider | null = null;

/**
 * Sets or clears an isolated storage provider override for automated tests.
 */
export function setStorageProviderForTests(
  provider: StorageProvider | null
): void {
  testStorageOverride = provider;
}

/**
 * Resets cached default provider and test overrides for clean test isolation.
 */
export function resetStorageProviderForTests(): void {
  testStorageOverride = null;
  cachedDefaultProvider = null;
}

/**
 * Safe, bounded, non-destructive connectivity probe for the active storage provider.
 */
export async function checkStorageConnectivity(
  provider: StorageProvider,
  timeoutMs: number = 3000
): Promise<{ reachable: boolean; latencyMs?: number }> {
  if (typeof provider.checkConnectivity === "function") {
    return provider.checkConnectivity(timeoutMs);
  }
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const probePromise = provider.headObject(HEALTH_CHECK_PROBE_KEY);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new StorageError("Storage connectivity probe timed out.", 504)),
        timeoutMs
      );
    });
    const meta = await Promise.race([probePromise, timeoutPromise]);
    if (!meta.exists) {
      return { reachable: false };
    }
    return { reachable: true, latencyMs: Date.now() - start };
  } catch {
    return { reachable: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Resolves the active StorageProvider based on environment configuration.
 * Fails closed in production if S3 storage is not properly configured.
 */
export function resolveStorageProviderFromEnv(
  env: Record<string, string | undefined> = process.env
): StorageProvider {
  const isLocalhostServer =
    env.ALLOW_LOCAL_STORAGE_IN_TEST === "true" ||
    (Boolean(env.NEXT_PUBLIC_APP_URL?.startsWith("http://localhost:")) &&
      Boolean(env.BETTER_AUTH_URL?.startsWith("http://localhost:")) &&
      env.SYNCSPACE_STRICT_PRODUCTION !== "true");

  const isProduction = env.NODE_ENV === "production" && !isLocalhostServer;
  const requestedProvider = (env.STORAGE_PROVIDER || "").trim().toLowerCase();

  if (isProduction) {
    // Fail closed in production: never allow local or memory fallback
    if (
      requestedProvider &&
      requestedProvider !== "s3"
    ) {
      throw new StorageConfigurationError(
        `Storage provider '${requestedProvider}' is not permitted in production. Production requires private S3-compatible storage.`
      );
    }

    const bucketName = env.S3_BUCKET_NAME;
    const region = env.S3_REGION;
    const endpoint = env.S3_ENDPOINT;
    const accessKeyId = env.S3_ACCESS_KEY_ID;
    const secretAccessKey = env.S3_SECRET_ACCESS_KEY;

    if (!bucketName || isPlaceholderValue(bucketName)) {
      throw new StorageConfigurationError(
        "Production storage error: S3_BUCKET_NAME is missing or set to a placeholder."
      );
    }
    if (!region || isPlaceholderValue(region)) {
      throw new StorageConfigurationError(
        "Production storage error: S3_REGION is missing or set to a placeholder."
      );
    }
    // Reject localhost/placeholder endpoints or placeholder credentials in production
    if (
      endpoint &&
      (isPlaceholderValue(endpoint) || endpoint.includes("localhost")) &&
      (isPlaceholderValue(accessKeyId) || isPlaceholderValue(secretAccessKey))
    ) {
      throw new StorageConfigurationError(
        "Production storage error: S3 credentials or endpoint are still set to development placeholders."
      );
    }
    if (
      (accessKeyId && isPlaceholderValue(accessKeyId)) ||
      (secretAccessKey && isPlaceholderValue(secretAccessKey))
    ) {
      throw new StorageConfigurationError(
        "Production storage error: S3_ACCESS_KEY_ID or S3_SECRET_ACCESS_KEY is set to a placeholder."
      );
    }

    return new S3StorageProvider({
      bucketName,
      region,
      endpoint,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    });
  }

  // Non-production environment resolution
  if (requestedProvider === "memory") {
    return new InMemoryStorageProvider();
  }

  if (requestedProvider === "s3") {
    return new S3StorageProvider({
      bucketName: env.S3_BUCKET_NAME || "",
      region: env.S3_REGION || "",
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    });
  }

  return new LocalFileStorageProvider(env.LOCAL_STORAGE_PATH);
}

/**
 * Returns the active storage provider instance.
 */
export function getStorageProvider(): StorageProvider {
  if (testStorageOverride) {
    return testStorageOverride;
  }
  if (!cachedDefaultProvider) {
    cachedDefaultProvider = resolveStorageProviderFromEnv(process.env);
  }
  return cachedDefaultProvider;
}
