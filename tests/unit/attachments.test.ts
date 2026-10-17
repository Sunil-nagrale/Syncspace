import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import { promises as fs } from "fs";
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  buildContentDispositionHeader,
  computeSha256Hex,
  generateAttachmentStorageKey,
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
  assertSafeStorageKey,
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

    it("generates unpredictable storage keys completely independent of user filenames", () => {
      const key1 = generateAttachmentStorageKey("ws_123", "art_456");
      const key2 = generateAttachmentStorageKey("ws_123", "art_456");

      expect(key1).not.toBe(key2);
      expect(key1).toMatch(
        /^workspaces\/ws_123\/artifacts\/art_456\/blobs\/[a-f0-9-]+$/
      );
      expect(() => assertSafeStorageKey(key1)).not.toThrow();

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

  describe("Storage provider adapters & fail-closed behavior", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "syncspace-storage-"));
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    });

    it("stores, inspects, reads, and deletes objects in LocalFileStorageProvider outside public/", async () => {
      const localProvider = new LocalFileStorageProvider(tempDir);
      const key = generateAttachmentStorageKey("ws_local", "art_local");

      const beforeHead = await localProvider.headObject(key);
      expect(beforeHead.exists).toBe(false);

      await localProvider.putObject({
        storageKey: key,
        bytes: VALID_PDF_BYTES,
        contentType: "application/pdf",
      });

      const afterHead = await localProvider.headObject(key);
      expect(afterHead.exists).toBe(true);
      expect(afterHead.byteLength).toBe(VALID_PDF_BYTES.byteLength);
      expect(afterHead.contentType).toBe("application/pdf");

      const readBytes = await localProvider.getObjectBytes(key);
      expect(readBytes).not.toBeNull();
      expect(Buffer.from(readBytes!)).toEqual(Buffer.from(VALID_PDF_BYTES));

      await localProvider.deleteObject(key);
      const deletedHead = await localProvider.headObject(key);
      expect(deletedHead.exists).toBe(false);

      // Idempotent second delete
      await expect(localProvider.deleteObject(key)).resolves.toBeUndefined();
    });

    it("rejects configuring LocalFileStorageProvider inside public/", () => {
      expect(
        () => new LocalFileStorageProvider(path.join(process.cwd(), "public/uploads"))
      ).toThrow(StorageConfigurationError);
    });

    it("supports fault injection and retry recovery in InMemoryStorageProvider", async () => {
      const mem = new InMemoryStorageProvider();
      const key = generateAttachmentStorageKey("ws_mem", "art_mem");

      mem.setFailNextPut(true);
      await expect(
        mem.putObject({
          storageKey: key,
          bytes: VALID_PNG_BYTES,
          contentType: "image/png",
        })
      ).rejects.toThrow(StorageError);

      // Subsequent retry succeeds
      await expect(
        mem.putObject({
          storageKey: key,
          bytes: VALID_PNG_BYTES,
          contentType: "image/png",
        })
      ).resolves.toEqual({ byteLength: VALID_PNG_BYTES.byteLength });

      mem.setFailNextDelete(true);
      await expect(mem.deleteObject(key)).rejects.toThrow(StorageError);
      expect(mem.hasKey(key)).toBe(true);

      // Retry delete succeeds
      await expect(mem.deleteObject(key)).resolves.toBeUndefined();
      expect(mem.hasKey(key)).toBe(false);
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
