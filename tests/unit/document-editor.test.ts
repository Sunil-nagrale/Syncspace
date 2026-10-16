import { describe, it, expect } from "vitest";
import { Extension } from "@tiptap/core";
import {
  isSafeLinkUrl,
  normalizeSafeLinkUrl,
  filterSlashCommands,
  extractHeadingsFromJson,
  buildDefaultDocumentContent,
  createDocumentEditorExtensions,
} from "@/components/documents/editor-extensions";
import {
  isLiveblocksSecretKeyConfigured,
  resolveLiveblocksPermissions,
  getDeterministicUserColor,
} from "@/services/liveblocks-auth.service";

describe("Document Editor Extensions & Security Utilities", () => {
  it("validates safe link URLs and blocks XSS protocols (javascript:, data:, vbscript:)", () => {
    expect(isSafeLinkUrl("https://syncspace.dev/docs")).toBe(true);
    expect(isSafeLinkUrl("http://localhost:3000/app")).toBe(true);
    expect(isSafeLinkUrl("mailto:team@syncspace.dev")).toBe(true);

    expect(isSafeLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkUrl("JAVASCRIPT:evil()")).toBe(false);
    expect(isSafeLinkUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeLinkUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeLinkUrl("")).toBe(false);
  });

  it("normalizes user-entered URLs safely and rejects unsafe protocols", () => {
    expect(normalizeSafeLinkUrl("syncspace.dev/spec")).toBe(
      "https://syncspace.dev/spec"
    );
    expect(normalizeSafeLinkUrl("https://github.com/ueberdosis/tiptap")).toBe(
      "https://github.com/ueberdosis/tiptap"
    );
    expect(normalizeSafeLinkUrl("mailto:security@syncspace.dev")).toBe(
      "mailto:security@syncspace.dev"
    );
    expect(normalizeSafeLinkUrl("javascript:alert(document.cookie)")).toBeNull();
    expect(normalizeSafeLinkUrl("   ")).toBeNull();
  });

  it("filters slash commands by title, description, and keywords", () => {
    const all = filterSlashCommands("");
    expect(all.length).toBeGreaterThanOrEqual(9);

    const headingMatches = filterSlashCommands("h2");
    expect(headingMatches.some((c) => c.id === "h2")).toBe(true);

    const tableMatches = filterSlashCommands("grid");
    expect(tableMatches).toHaveLength(1);
    expect(tableMatches[0].id).toBe("table");

    const codeMatches = filterSlashCommands("snippet");
    expect(codeMatches.some((c) => c.id === "codeBlock")).toBe(true);
  });

  it("extracts H1, H2, and H3 headings in order for the Document Outline", () => {
    const sampleDoc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "System Architecture" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Introductory paragraph." }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "CRDT State Vectors" }],
        },
        {
          type: "heading",
          attrs: { level: 3 },
          content: [{ type: "text", text: "Room Token Boundary" }],
        },
      ],
    };

    const headings = extractHeadingsFromJson(sampleDoc);
    expect(headings).toHaveLength(3);
    expect(headings[0]).toMatchObject({ level: 1, text: "System Architecture" });
    expect(headings[1]).toMatchObject({ level: 2, text: "CRDT State Vectors" });
    expect(headings[2]).toMatchObject({ level: 3, text: "Room Token Boundary" });
  });

  it("configures StarterKit with undoRedo disabled when Liveblocks extension is active", () => {
    const mockLiveblocksExt = Extension.create({ name: "liveblocksExtension" });
    const extensionsWithCollab = createDocumentEditorExtensions({
      liveblocksExtension: mockLiveblocksExt,
    });

    const starterKitExt = extensionsWithCollab.find(
      (ext) => ext.name === "starterKit"
    );
    expect(starterKitExt).toBeDefined();
    expect(
      (starterKitExt?.options as { undoRedo?: unknown } | undefined)?.undoRedo
    ).toBe(false);

    const hasLiveblocks = extensionsWithCollab.some(
      (ext) => ext.name === "liveblocksExtension"
    );
    expect(hasLiveblocks).toBe(true);
  });

  it("builds valid default document JSONContent", () => {
    const doc = buildDefaultDocumentContent("RFC-101 Protocol");
    expect(doc.type).toBe("doc");
    expect(Array.isArray(doc.content)).toBe(true);
    const headings = extractHeadingsFromJson(doc);
    expect(headings.length).toBeGreaterThanOrEqual(2);
  });
});

describe("LiveblocksAuthService — Credential & Scope Helpers", () => {
  it("detects missing or placeholder LIVEBLOCKS_SECRET_KEY values honestly", () => {
    expect(isLiveblocksSecretKeyConfigured(undefined)).toBe(false);
    expect(isLiveblocksSecretKeyConfigured("")).toBe(false);
    expect(
      isLiveblocksSecretKeyConfigured("sk_dev_placeholder_liveblocks_secret_key")
    ).toBe(false);
    expect(
      isLiveblocksSecretKeyConfigured("not-a-liveblocks-secret-key")
    ).toBe(false);
    expect(
      isLiveblocksSecretKeyConfigured("pk_live_not_a_secret_key_123456789")
    ).toBe(false);
    expect(
      isLiveblocksSecretKeyConfigured("sk_liveblocks_mock_valid_key_abcdef123456")
    ).toBe(true);
  });

  it("maps effective roles to minimum required Liveblocks room permissions", () => {
    expect(resolveLiveblocksPermissions("OWNER")).toEqual(["*:write"]);
    expect(resolveLiveblocksPermissions("ADMIN")).toEqual(["*:write"]);
    expect(resolveLiveblocksPermissions("EDITOR")).toEqual(["*:write"]);
    expect(resolveLiveblocksPermissions("VIEWER")).toEqual(["*:read"]);
  });

  it("assigns deterministic collaborator colors", () => {
    expect(getDeterministicUserColor("user-1", "#10B981")).toBe("#10B981");
    const colorA = getDeterministicUserColor("user-abc-123", null);
    const colorB = getDeterministicUserColor("user-abc-123", null);
    expect(colorA).toBe(colorB);
    expect(colorA).toMatch(/^#[0-9A-F]{6}$/i);
  });
});
