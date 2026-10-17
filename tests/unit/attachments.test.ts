import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import { promises as fs } from "fs";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  buildContentDispositionHeader,
  computeSha256Hex,
  generateAttachmentStorageKey,
  generateFinalStorageKey,
  generateStagingStorageKey,
  hasForbiddenExtension,
  initiateAttachmentUploadSchema,
  isAllowedMimeType,
  sanitizeAttachmentFileName,
  validateFileSignatureAndContent,
} from "@/lib/validations/attachment";
import {
  InMemoryStorageProvider,
  LocalFileStorageProvider,
  S3StorageProvider,
  StorageConfigurationError,
  StorageError,
  assertFinalStorageKey,
  assertSafeStorageKey,
  assertStagingStorageKey,
  assertValidPromotionKeys,
  isFinalStorageKey,
  isStagingStorageKey,
  resolveStorageProviderFromEnv,
} from "@/lib/storage";

const VALID_PDF_BYTES = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF"
);
const VALID_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52,
]);
const VALID_JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const VALID_WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x20,
]);
const VALID_TXT_BYTES = new TextEncoder().encode(
  "SyncSpace technical specification notes.\nLine 2: Approved."
);
const VALID_CSV_BYTES = new TextEncoder().encode(
  "metric,q1,q2\nlatency_ms,42,38\nuptime_pct,99.95,99.99\n"
);

describe("Phase 9B Unit Tests — File Attachment Validation & Security", () => {
  describe("MIME allowlist and size validation", () => {
    it("accepts all documented safe business formats with matching magic bytes", () => {
      expect(
        validateFileSignatureAndContent({
          bytes: VALID_PDF_BYTES,
          declaredMimeType: "application/pdf",
          fileName: "architecture-spec.pdf",
        }).valid
      ).toBe(true);

      expect(
        validateFileSignatureAndContent({
          bytes: VALID_PNG_BYTES,
          declaredMimeType: "image/png",
          fileName: "diagram.png",
        }).valid
      ).toBe(true);

      expect(
        validateFileSignatureAndContent({
          bytes: VALID_JPEG_BYTES,
          declaredMimeType: "image/jpeg",
          fileName: "whiteboard-photo.jpg",
        }).valid
      ).toBe(true);

      expect(
        validateFileSignatureAndContent({
          bytes: VALID_WEBP_BYTES,
          declaredMimeType: "image/webp",
          fileName: "preview.webp",
        }).valid
      ).toBe(true);

      expect(
        validateFileSignatureAndContent({
          bytes: VALID_TXT_BYTES,
          declaredMimeType: "text/plain; charset=utf-8",
          fileName: "notes.txt",
        }).valid
      ).toBe(true);

      expect(
        validateFileSignatureAndContent({
          bytes: VALID_CSV_BYTES,
          declaredMimeType: "text/csv",
          fileName: "metrics.csv",
        }).valid
      ).toBe(true);
    });

    it("rejects empty files and files exceeding 10 MiB", () => {
      const emptyCheck = validateFileSignatureAndContent({
        bytes: new Uint8Array(0),
        declaredMimeType: "text/plain",
        fileName: "empty.txt",
      });
      expect(emptyCheck.valid).toBe(false);
      expect(emptyCheck.error).toMatch(/empty/i);

      const oversizedBytes = new Uint8Array(MAX_ATTACHMENT_SIZE_BYTES + 1);
      oversizedBytes.set(VALID_PDF_BYTES, 0);
      const oversizedCheck = validateFileSignatureAndContent({
        bytes: oversizedBytes,
        declaredMimeType: "application/pdf",
        fileName: "huge.pdf",
      });
      expect(oversizedCheck.valid).toBe(false);
      expect(oversizedCheck.error).toMatch(/exceeds the maximum limit of 10 MiB/i);
    });

    it("enforces schema limits on initiateAttachmentUploadSchema", () => {
      expect(
        initiateAttachmentUploadSchema.safeParse({
          fileName: "report.pdf",
          fileType: "application/pdf",
          fileSize: 1024,
        }).success
      ).toBe(true);

      expect(
        initiateAttachmentUploadSchema.safeParse({
          fileName: "payload.html",
          fileType: "text/html",
          fileSize: 256,
        }).success
      ).toBe(false);

      expect(
        initiateAttachmentUploadSchema.safeParse({
          fileName: "big.pdf",
          fileType: "application/pdf",
          fileSize: MAX_ATTACHMENT_SIZE_BYTES + 100,
        }).success
      ).toBe(false);
    });
  });

  describe("Invalid MIME/signature combinations & active-content rejection", () => {
    it("rejects mismatched magic signatures (e.g. PNG bytes declared as PDF, or plain text declared as PNG)", () => {
      const pngAsPdf = validateFileSignatureAndContent({
        bytes: VALID_PNG_BYTES,
        declaredMimeType: "application/pdf",
        fileName: "disguised.pdf",
      });
      expect(pngAsPdf.valid).toBe(false);
      expect(pngAsPdf.error).toMatch(/PDF signature/i);

      const textAsPng = validateFileSignatureAndContent({
        bytes: VALID_TXT_BYTES,
        declaredMimeType: "image/png",
        fileName: "fake-image.png",
      });
      expect(textAsPng.valid).toBe(false);
      expect(textAsPng.error).toMatch(/PNG signature/i);
    });

    it("rejects Windows PE/MZ and Linux ELF executables even when disguised with an allowed MIME type", () => {
      const mzExeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
      const mzCheck = validateFileSignatureAndContent({
        bytes: mzExeBytes,
        declaredMimeType: "application/pdf",
        fileName: "invoice.pdf",
      });
      expect(mzCheck.valid).toBe(false);
      expect(mzCheck.error).toMatch(/Executable binary content/i);

      const elfBytes = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]);
      const elfCheck = validateFileSignatureAndContent({
        bytes: elfBytes,
        declaredMimeType: "text/plain",
        fileName: "binary.txt",
      });
      expect(elfCheck.valid).toBe(false);
      expect(elfCheck.error).toMatch(/Executable binary content/i);
    });

    it("rejects HTML, SVG, and JavaScript payloads disguised as text/plain or text/csv", () => {
      const htmlDisguised = validateFileSignatureAndContent({
        bytes: new TextEncoder().encode(
          "<!DOCTYPE html><html><body><script>alert(1)</script></body></html>"
        ),
        declaredMimeType: "text/plain",
        fileName: "harmless.txt",
      });
      expect(htmlDisguised.valid).toBe(false);
      expect(htmlDisguised.error).toMatch(/HTML, SVG, and active script content/i);

      const svgDisguised = validateFileSignatureAndContent({
        bytes: new TextEncoder().encode(
          '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'
        ),
        declaredMimeType: "text/plain",
        fileName: "vector.txt",
      });
      expect(svgDisguised.valid).toBe(false);
      expect(svgDisguised.error).toMatch(/HTML, SVG, and active script content/i);

      const nullBytesInText = validateFileSignatureAndContent({
        bytes: new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x77]),
        declaredMimeType: "text/plain",
        fileName: "null.txt",
      });
      expect(nullBytesInText.valid).toBe(false);
      expect(nullBytesInText.error).toMatch(/null bytes/i);
    });

    it("rejects forbidden extensions (.exe, .svg, .html, .js, .sh, .ps1)", () => {
      expect(hasForbiddenExtension("malware.exe")).toBe(true);
      expect(hasForbiddenExtension("xss.svg")).toBe(true);
      expect(hasForbiddenExtension("script.js")).toBe(true);
      expect(hasForbiddenExtension("page.html")).toBe(true);
      expect(hasForbiddenExtension("run.ps1")).toBe(true);
      expect(hasForbiddenExtension("clean-report.pdf")).toBe(false);
      expect(isAllowedMimeType("image/svg+xml")).toBe(false);
    });
  });

  describe("Filename sanitization, Content-Disposition, and storage-key generation", () => {
    it("sanitizes path traversal, control characters, and header injection characters", () => {
      expect(sanitizeAttachmentFileName("../../etc/passwd")).toBe("passwd");
      expect(sanitizeAttachmentFileName("C:\\Windows\\System32\\cmd.exe")).toBe(
        "cmd.exe"
      );
      expect(
        sanitizeAttachmentFileName('report"\r\nContent-Type: text/html.pdf')
      ).toBe("report___Content-Type_ text/html.pdf".split("/").pop());
      expect(sanitizeAttachmentFileName("...", ".pdf")).toBe("attachment.pdf");
    });

    it("builds safe Content-Disposition headers and forces attachment for CSV", () => {
      const pdfInline = buildContentDispositionHeader(
        "inline",
        "quarterly report.pdf",
        "application/pdf"
      );
      expect(pdfInline).toContain('inline; filename="quarterly report.pdf"');

      // CSV must never be served inline even if requested
      const csvRequestedInline = buildContentDispositionHeader(
        "inline",
        "export.csv",
        "text/csv"
      );
      expect(csvRequestedInline.startsWith("attachment;")).toBe(true);
    });

    it("generates distinct staging and final storage keys and validates promotion scopes", () => {
      const stagingKey = generateStagingStorageKey("ws_123", "art_456");
      const finalKey = generateFinalStorageKey("ws_123", "art_456");
      const otherWorkspaceFinalKey = generateFinalStorageKey("ws_999", "art_456");
      const otherArtifactFinalKey = generateFinalStorageKey("ws_123", "art_999");

      expect(stagingKey).not.toBe(finalKey);
      expect(stagingKey).toMatch(
        /^workspaces\/ws_123\/artifacts\/art_456\/staging\/[a-f0-9-]+$/
      );
      expect(finalKey).toMatch(
        /^workspaces\/ws_123\/artifacts\/art_456\/blobs\/[a-f0-9-]+$/
      );

      expect(isStagingStorageKey(stagingKey)).toBe(true);
      expect(isFinalStorageKey(stagingKey)).toBe(false);
      expect(isFinalStorageKey(finalKey)).toBe(true);
      expect(isStagingStorageKey(finalKey)).toBe(false);

      expect(() => assertStagingStorageKey(stagingKey)).not.toThrow();
      expect(() => assertStagingStorageKey(finalKey)).toThrow(StorageError);
      expect(() => assertFinalStorageKey(finalKey)).not.toThrow();
      expect(() => assertFinalStorageKey(stagingKey)).toThrow(StorageError);

      // Valid promotion pair within same workspace and artifact
      expect(() => assertValidPromotionKeys(stagingKey, finalKey)).not.toThrow();

      // Rejects promoting final -> staging, staging -> staging, or cross-workspace/artifact promotion
      expect(() => assertValidPromotionKeys(finalKey, stagingKey)).toThrow(
        StorageError
      );
      expect(() => assertValidPromotionKeys(stagingKey, stagingKey)).toThrow(
        StorageError
      );
      expect(() =>
        assertValidPromotionKeys(stagingKey, otherWorkspaceFinalKey)
      ).toThrow(StorageError);
      expect(() =>
        assertValidPromotionKeys(stagingKey, otherArtifactFinalKey)
      ).toThrow(StorageError);

      // Rejects traversal keys
      expect(() =>
        assertSafeStorageKey("workspaces/../artifacts/art_456/blobs/abc")
      ).toThrow(StorageError);
      expect(() =>
        generateAttachmentStorageKey("../bad", "art_456")
      ).toThrow();
    });

    it("computes deterministic SHA-256 hex digests", () => {
      const hash1 = computeSha256Hex(VALID_TXT_BYTES);
      const hash2 = computeSha256Hex(VALID_TXT_BYTES);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });
  });

  describe("Storage provider adapters, staging-to-final promotion & fail-closed behavior", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "syncspace-storage-"));
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    });

    it("stores, promotes from staging to final key, removes staging object, and resists staging overwrite in LocalFileStorageProvider", async () => {
      const localProvider = new LocalFileStorageProvider(tempDir);
      const stagingKey = generateStagingStorageKey("ws_local", "art_local");
      const finalKey = generateFinalStorageKey("ws_local", "art_local");

      await localProvider.putObject({
        storageKey: stagingKey,
        bytes: VALID_PDF_BYTES,
        contentType: "application/pdf",
      });

      const stagedHead = await localProvider.headObject(stagingKey);
      expect(stagedHead.exists).toBe(true);
      expect(stagedHead.byteLength).toBe(VALID_PDF_BYTES.byteLength);

      // Promote from stagingKey -> finalKey
      const promoted = await localProvider.promoteObject({
        sourceKey: stagingKey,
        destinationKey: finalKey,
        contentType: "application/pdf",
      });
      expect(promoted.byteLength).toBe(VALID_PDF_BYTES.byteLength);

      // Staging object must be removed and final object must exist
      expect((await localProvider.headObject(stagingKey)).exists).toBe(false);
      const finalHead = await localProvider.headObject(finalKey);
      expect(finalHead.exists).toBe(true);
      expect(finalHead.byteLength).toBe(VALID_PDF_BYTES.byteLength);

      // Reusing the original stagingKey after promotion does NOT alter the finalized object
      await localProvider.putObject({
        storageKey: stagingKey,
        bytes: VALID_TXT_BYTES,
        contentType: "text/plain",
      });

      const finalBytes = await localProvider.getObjectBytes(finalKey);
      expect(finalBytes).not.toBeNull();
      expect(Buffer.from(finalBytes!)).toEqual(Buffer.from(VALID_PDF_BYTES));

      await localProvider.deleteObject(finalKey);
      expect((await localProvider.headObject(finalKey)).exists).toBe(false);
    });

    it("rejects configuring LocalFileStorageProvider inside public/", () => {
      expect(
        () => new LocalFileStorageProvider(path.join(process.cwd(), "public/uploads"))
      ).toThrow(StorageConfigurationError);
    });

    it("supports staging promotion, fault injection, and retry recovery in InMemoryStorageProvider", async () => {
      const mem = new InMemoryStorageProvider();
      const stagingKey = generateStagingStorageKey("ws_mem", "art_mem");
      const finalKey = generateFinalStorageKey("ws_mem", "art_mem");

      mem.setFailNextPut(true);
      await expect(
        mem.putObject({
          storageKey: stagingKey,
          bytes: VALID_PNG_BYTES,
          contentType: "image/png",
        })
      ).rejects.toThrow(StorageError);

      // Subsequent retry succeeds
      await expect(
        mem.putObject({
          storageKey: stagingKey,
          bytes: VALID_PNG_BYTES,
          contentType: "image/png",
        })
      ).resolves.toEqual({ byteLength: VALID_PNG_BYTES.byteLength });

      // Simulated promotion failure leaves staging object intact and creates no final object
      mem.setFailNextPromote(true);
      await expect(
        mem.promoteObject({
          sourceKey: stagingKey,
          destinationKey: finalKey,
          contentType: "image/png",
        })
      ).rejects.toThrow(StorageError);
      expect(mem.hasKey(stagingKey)).toBe(true);
      expect(mem.hasKey(finalKey)).toBe(false);

      // Subsequent promotion retry succeeds and removes staging object
      await expect(
        mem.promoteObject({
          sourceKey: stagingKey,
          destinationKey: finalKey,
          contentType: "image/png",
        })
      ).resolves.toEqual({ byteLength: VALID_PNG_BYTES.byteLength });
      expect(mem.hasKey(stagingKey)).toBe(false);
      expect(mem.hasKey(finalKey)).toBe(true);

      mem.setFailNextDelete(true);
      await expect(mem.deleteObject(finalKey)).rejects.toThrow(StorageError);
      expect(mem.hasKey(finalKey)).toBe(true);

      // Retry delete succeeds
      await expect(mem.deleteObject(finalKey)).resolves.toBeUndefined();
      expect(mem.hasKey(finalKey)).toBe(false);
    });

    it("enforces staging-only presigned upload URLs and atomic server-side copy+delete promotion in S3StorageProvider (mocked S3Client)", async () => {
      const sentCommands: unknown[] = [];
      let failStagingDelete = false;

      const mockS3Client = {
        config: {},
        send: async (command: unknown) => {
          sentCommands.push(command);
          if (command instanceof HeadObjectCommand) {
            return {
              ContentLength: VALID_PDF_BYTES.byteLength,
              ContentType: "application/pdf",
            };
          }
          if (command instanceof CopyObjectCommand) {
            return {};
          }
          if (command instanceof DeleteObjectCommand) {
            const key = command.input.Key || "";
            if (failStagingDelete && key.includes("/staging/")) {
              throw new Error("Simulated S3 delete failure");
            }
            return {};
          }
          return {};
        },
      } as unknown as S3Client;

      const s3Provider = new S3StorageProvider({
        bucketName: "syncspace-test-private-bucket",
        region: "us-east-1",
        client: mockS3Client,
      });

      const stagingKey = generateStagingStorageKey("ws_s3", "art_s3");
      const finalKey = generateFinalStorageKey("ws_s3", "art_s3");

      // Presigned upload URL must reject final 'blobs/' keys so clients can never obtain upload credentials for final keys
      await expect(
        s3Provider.createPresignedUploadUrl({
          storageKey: finalKey,
          contentType: "application/pdf",
          contentLength: VALID_PDF_BYTES.byteLength,
        })
      ).rejects.toThrow(StorageError);

      // Promotion copies stagingKey -> finalKey and deletes stagingKey
      const promoResult = await s3Provider.promoteObject({
        sourceKey: stagingKey,
        destinationKey: finalKey,
        contentType: "application/pdf",
      });
      expect(promoResult.byteLength).toBe(VALID_PDF_BYTES.byteLength);

      const copyCmd = sentCommands.find(
        (c): c is CopyObjectCommand => c instanceof CopyObjectCommand
      );
      expect(copyCmd).toBeDefined();
      expect(copyCmd!.input.Bucket).toBe("syncspace-test-private-bucket");
      expect(copyCmd!.input.CopySource).toBe(
        `syncspace-test-private-bucket/${stagingKey}`
      );
      expect(copyCmd!.input.Key).toBe(finalKey);
      expect(copyCmd!.input.MetadataDirective).toBe("REPLACE");

      const deleteCmd = sentCommands.find(
        (c): c is DeleteObjectCommand => c instanceof DeleteObjectCommand
      );
      expect(deleteCmd).toBeDefined();
      expect(deleteCmd!.input.Key).toBe(stagingKey);

      // If deleting the staging object fails during S3 promotion, S3StorageProvider rolls back the destination copy
      sentCommands.length = 0;
      failStagingDelete = true;
      await expect(
        s3Provider.promoteObject({
          sourceKey: stagingKey,
          destinationKey: finalKey,
          contentType: "application/pdf",
        })
      ).rejects.toThrow(StorageError);

      const deleteAttempts = sentCommands.filter(
        (c): c is DeleteObjectCommand => c instanceof DeleteObjectCommand
      );
      expect(deleteAttempts.map((d) => d.input.Key)).toContain(finalKey);
    });

    it("fails closed in production when S3 is unconfigured or set to local/placeholders", () => {
      expect(() =>
        resolveStorageProviderFromEnv({
          NODE_ENV: "production",
          STORAGE_PROVIDER: "local",
        })
      ).toThrow(StorageConfigurationError);

      expect(() =>
        resolveStorageProviderFromEnv({
          NODE_ENV: "production",
          STORAGE_PROVIDER: "s3",
          S3_BUCKET_NAME: "placeholder_bucket",
          S3_REGION: "us-east-1",
        })
      ).toThrow(StorageConfigurationError);

      expect(() =>
        resolveStorageProviderFromEnv({
          NODE_ENV: "production",
          S3_BUCKET_NAME: "syncspace-attachments",
          S3_REGION: "us-east-1",
          S3_ENDPOINT: "http://localhost:9000",
          S3_ACCESS_KEY_ID: "placeholder_s3_access_key",
          S3_SECRET_ACCESS_KEY: "placeholder_s3_secret_key",
        })
      ).toThrow(StorageConfigurationError);

      // Succeeds in production when valid S3 config is provided
      const prodProvider = resolveStorageProviderFromEnv({
        NODE_ENV: "production",
        STORAGE_PROVIDER: "s3",
        S3_BUCKET_NAME: "syncspace-prod-private-vault",
        S3_REGION: "us-east-1",
        S3_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
        S3_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      });
      expect(prodProvider).toBeInstanceOf(S3StorageProvider);
      expect(prodProvider.providerName).toBe("s3");
    });
  });
});
