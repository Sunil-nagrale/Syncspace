import { describe, it, expect } from "vitest";
import {
  validateSnapshotPayload,
  createVersionSchema,
  restoreVersionSchema,
  listVersionsQuerySchema,
  MAX_SNAPSHOT_JSON_LENGTH,
} from "@/lib/validations/version";

describe("Version & Snapshot Validation Unit Tests", () => {
  describe("validateSnapshotPayload for DOCUMENT", () => {
    it("accepts valid Tiptap ProseMirror document snapshot", () => {
      const validDoc = {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Architecture Overview" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Distributed systems RFC." }],
          },
        ],
      };

      const result = validateSnapshotPayload("DOCUMENT", validDoc);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.type).toBe("doc");
      }
    });

    it("rejects non-object document payload", () => {
      const result = validateSnapshotPayload("DOCUMENT", "invalid string");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("Snapshot payload must be a non-empty object");
      }
    });

    it("rejects document snapshot missing type: 'doc'", () => {
      const invalidDoc = {
        type: "note",
        content: [],
      };

      const result = validateSnapshotPayload("DOCUMENT", invalidDoc);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("must be a valid ProseMirror/Tiptap document object");
      }
    });

    it("rejects oversized snapshot exceeding maximum size limit", () => {
      const hugeContent = "x".repeat(MAX_SNAPSHOT_JSON_LENGTH + 100);
      const hugeDoc = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: hugeContent }] }],
      };

      const result = validateSnapshotPayload("DOCUMENT", hugeDoc);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("exceeds maximum allowed size");
      }
    });
  });

  describe("validateSnapshotPayload for WHITEBOARD", () => {
    it("accepts valid Excalidraw scene snapshot", () => {
      const validBoard = {
        elements: [
          {
            id: "rect-1",
            type: "rectangle",
            x: 100,
            y: 100,
            width: 200,
            height: 150,
            version: 1,
            versionNonce: 12345,
            isDeleted: false,
          },
        ],
        appState: { viewBackgroundColor: "#ffffff" },
      };

      const result = validateSnapshotPayload("WHITEBOARD", validBoard);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(Array.isArray(result.data.elements)).toBe(true);
      }
    });

    it("rejects whiteboard snapshot missing elements array", () => {
      const invalidBoard = {
        appState: { viewBackgroundColor: "#ffffff" },
      };

      const result = validateSnapshotPayload("WHITEBOARD", invalidBoard);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("must be an object with an 'elements' array");
      }
    });
  });

  describe("Zod input schemas", () => {
    it("validates createVersionSchema bounds", () => {
      const valid = createVersionSchema.safeParse({
        title: "Release candidate 1.0",
        changeSummary: "Added consensus diagrams and auth flow",
      });
      expect(valid.success).toBe(true);

      const invalidTitle = createVersionSchema.safeParse({
        title: "a".repeat(250), // max is 200
      });
      expect(invalidTitle.success).toBe(false);
    });

    it("validates restoreVersionSchema expectedRevision", () => {
      const valid = restoreVersionSchema.safeParse({ expectedRevision: 5 });
      expect(valid.success).toBe(true);

      const invalidNegative = restoreVersionSchema.safeParse({ expectedRevision: -1 });
      expect(invalidNegative.success).toBe(false);

      const invalidMissing = restoreVersionSchema.safeParse({});
      expect(invalidMissing.success).toBe(false);

      const invalidZero = restoreVersionSchema.safeParse({ expectedRevision: 0 });
      expect(invalidZero.success).toBe(false);
    });

    it("validates listVersionsQuerySchema pagination defaults and limits", () => {
      const defaultParsed = listVersionsQuerySchema.parse({});
      expect(defaultParsed.limit).toBe(20);

      const clamped = listVersionsQuerySchema.safeParse({ limit: "50" });
      expect(clamped.success).toBe(true);
      if (clamped.success) {
        expect(clamped.data.limit).toBe(50);
      }

      const excessive = listVersionsQuerySchema.safeParse({ limit: 100 });
      expect(excessive.success).toBe(false);
    });
  });
});
