import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  MAX_EXCERPT_LENGTH,
  MAX_SEARCH_LIMIT,
  MAX_SEARCH_OFFSET,
  MAX_SEARCH_QUERY_LENGTH,
  SearchValidationError,
  buildSafePrefixTsQuery,
  buildSafeSearchExcerpt,
  decodeSearchCursor,
  encodeSearchCursor,
  escapeLikePattern,
  extractArtifactSearchText,
  searchQuerySchema,
} from "@/lib/validations/search";
import { CommandPaletteDialog } from "@/components/shared/command-palette-dialog";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

beforeEach(() => {
  pushMock.mockReset();

  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Phase 10A Unit Tests — Full-Text Search Validation, Indexing & Command Palette", () => {
  describe("searchQuerySchema validation", () => {
    it("applies safe defaults and normalizes whitespace in queries", () => {
      const parsed = searchQuerySchema.parse({
        q: "   distributed   consensus   architecture  ",
      });

      expect(parsed.q).toBe("distributed consensus architecture");
      expect(parsed.type).toBe("ALL");
      expect(parsed.limit).toBe(20);
      expect(parsed.includeRecent).toBe(false);
    });

    it("rejects queries exceeding MAX_SEARCH_QUERY_LENGTH or containing control characters", () => {
      const overlong = "a".repeat(MAX_SEARCH_QUERY_LENGTH + 1);
      expect(() => searchQuerySchema.parse({ q: overlong })).toThrow();

      expect(() =>
        searchQuerySchema.parse({ q: "normal\u0000injected" })
      ).toThrow(/control characters/i);
    });

    it("enforces bounded limit and valid entity type filters", () => {
      expect(() => searchQuerySchema.parse({ limit: 0 })).toThrow();
      expect(() =>
        searchQuerySchema.parse({ limit: MAX_SEARCH_LIMIT + 1 })
      ).toThrow();
      expect(() => searchQuerySchema.parse({ type: "INVALID_TYPE" })).toThrow();

      const valid = searchQuerySchema.parse({
        q: "roadmap",
        type: "WHITEBOARD",
        limit: "15",
        includeRecent: "true",
      });
      expect(valid.type).toBe("WHITEBOARD");
      expect(valid.limit).toBe(15);
      expect(valid.includeRecent).toBe(true);
    });
  });

  describe("Pagination cursor encoding and decoding", () => {
    it("encodes and decodes valid offsets round-trip", () => {
      const cursor0 = encodeSearchCursor(0);
      const cursor25 = encodeSearchCursor(25);
      expect(decodeSearchCursor(cursor0)).toBe(0);
      expect(decodeSearchCursor(cursor25)).toBe(25);
      expect(decodeSearchCursor(undefined)).toBe(0);
    });

    it("rejects malformed, negative, or out-of-range cursors with SearchValidationError", () => {
      expect(() => decodeSearchCursor("not-valid-base64-json!!!")).toThrow(
        SearchValidationError
      );

      const negativeCursor = Buffer.from(
        JSON.stringify({ o: -5 }),
        "utf8"
      ).toString("base64url");
      expect(() => decodeSearchCursor(negativeCursor)).toThrow(
        SearchValidationError
      );

      const excessiveCursor = Buffer.from(
        JSON.stringify({ o: MAX_SEARCH_OFFSET + 10 }),
        "utf8"
      ).toString("base64url");
      expect(() => decodeSearchCursor(excessiveCursor)).toThrow(
        SearchValidationError
      );
    });
  });

  describe("extractArtifactSearchText", () => {
    it("extracts nested plain text from Tiptap document JSON snapshots", () => {
      const tiptapSnapshot = {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Zero-Trust Security Architecture" }],
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "All Liveblocks room tokens require server-side verification.",
              },
              {
                type: "text",
                marks: [{ type: "code" }],
                text: "POST /api/liveblocks-auth",
              },
            ],
          },
        ],
      };

      const extracted = extractArtifactSearchText("DOCUMENT", tiptapSnapshot);
      expect(extracted).toContain("Zero-Trust Security Architecture");
      expect(extracted).toContain(
        "All Liveblocks room tokens require server-side verification."
      );
      expect(extracted).toContain("POST /api/liveblocks-auth");
    });

    it("extracts text from active Excalidraw whiteboard elements and ignores deleted elements", () => {
      const whiteboardSnapshot = {
        elements: [
          {
            id: "el-1",
            type: "text",
            text: "API Gateway Cluster",
            originalText: "API Gateway Cluster",
            isDeleted: false,
          },
          {
            id: "el-2",
            type: "text",
            text: "Deprecated Legacy Node",
            originalText: "Deprecated Legacy Node",
            isDeleted: true,
          },
          {
            id: "el-3",
            type: "frame",
            name: "PostgreSQL Primary Replica",
            isDeleted: false,
          },
        ],
      };

      const extracted = extractArtifactSearchText(
        "WHITEBOARD",
        whiteboardSnapshot
      );
      expect(extracted).toContain("API Gateway Cluster");
      expect(extracted).toContain("PostgreSQL Primary Replica");
      expect(extracted).not.toContain("Deprecated Legacy Node");
    });

    it("handles null or malformed snapshots gracefully", () => {
      expect(extractArtifactSearchText("DOCUMENT", null)).toBe("");
      expect(extractArtifactSearchText("WHITEBOARD", {})).toBe("");
      expect(
        extractArtifactSearchText("WHITEBOARD", { elements: "invalid" })
      ).toBe("");
    });
  });

  describe("Query sanitization & safe excerpt generation", () => {
    it("sanitizes special tsquery syntax characters in buildSafePrefixTsQuery", () => {
      expect(
        buildSafePrefixTsQuery("auth & (liveblocks | !exploit) 'drop':*")
      ).toBe("auth:* & liveblocks:* & exploit:* & drop:*");
      expect(buildSafePrefixTsQuery("??? !!! ()")).toBeNull();
    });

    it("escapes SQL LIKE wildcards in escapeLikePattern", () => {
      expect(escapeLikePattern("100%_complete\\path")).toBe(
        "100\\%\\_complete\\\\path"
      );
    });

    it("generates bounded excerpts centered around matching terms without leaking raw JSON", () => {
      const longBody = `${"Introductory context words. ".repeat(10)}Critical Byzantine fault tolerance invariant verified here. ${"Trailing summary text. ".repeat(10)}`;
      const result = buildSafeSearchExcerpt({
        query: "Byzantine fault",
        title: "Consensus Spec",
        description: "General notes",
        searchText: longBody,
        entityType: "DOCUMENT",
      });

      expect(result.matchField).toBe("content");
      expect(result.excerpt).toContain("Byzantine fault tolerance");
      expect(result.excerpt.length).toBeLessThanOrEqual(MAX_EXCERPT_LENGTH + 4);
    });
  });

  describe("CommandPaletteDialog UI interactions", () => {
    it("opens and closes on Ctrl+K / Cmd+K without intercepting normal 'k' typing", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { query: "", items: [], nextCursor: null, hasMore: false },
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const Wrapper = () => {
        const [open, setOpen] = React.useState(false);
        return (
          <div>
            <input data-testid="external-editor-input" />
            <CommandPaletteDialog
              open={open}
              onOpenChange={setOpen}
              debounceMs={0}
            />
          </div>
        );
      };

      render(<Wrapper />);

      const externalInput = screen.getByTestId("external-editor-input");
      externalInput.focus();

      // Plain 'k' keystroke must not open the command palette
      const plainKeyEvent = new KeyboardEvent("keydown", {
        key: "k",
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(plainKeyEvent);
      expect(plainKeyEvent.defaultPrevented).toBe(false);
      expect(
        screen.queryByTestId("command-palette-input")
      ).not.toBeInTheDocument();

      // Ctrl+K opens the command palette
      fireEvent.keyDown(document, { key: "k", ctrlKey: true });
      expect(
        await screen.findByTestId("command-palette-input")
      ).toBeInTheDocument();

      // Cmd+K closes the command palette
      fireEvent.keyDown(document, { key: "k", metaKey: true });
      await waitFor(() => {
        expect(
          screen.queryByTestId("command-palette-input")
        ).not.toBeInTheDocument();
      });
    });

    it("renders search results across Document, Whiteboard, and Project types and navigates on selection", async () => {
      const mockItems = [
        {
          id: "doc-101",
          entityType: "DOCUMENT",
          title: "Distributed Replication Protocol",
          excerpt: "Raft leader election and log compaction details.",
          url: "/app/documents/doc-101",
          workspaceId: "ws-1",
          workspaceName: "Core Engineering",
          projectId: "proj-1",
          projectName: "Storage Engine",
          updatedAt: new Date().toISOString(),
          matchField: "content",
        },
        {
          id: "wb-202",
          entityType: "WHITEBOARD",
          title: "Replication Topology Diagram",
          excerpt: "Primary node -> Read replicas canvas flow.",
          url: "/app/whiteboards/wb-202",
          workspaceId: "ws-1",
          workspaceName: "Core Engineering",
          projectId: "proj-1",
          projectName: "Storage Engine",
          updatedAt: new Date().toISOString(),
          matchField: "title",
        },
        {
          id: "proj-303",
          entityType: "PROJECT",
          title: "Replication Initiative",
          excerpt: "Multi-region replication roadmap.",
          url: "/app/projects/proj-303",
          workspaceId: "ws-1",
          workspaceName: "Core Engineering",
          projectId: "proj-303",
          projectName: "Replication Initiative",
          updatedAt: new Date().toISOString(),
          matchField: "title",
        },
      ];

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            query: "replication",
            items: mockItems,
            nextCursor: null,
            hasMore: false,
          },
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const onOpenChange = vi.fn();
      render(
        <CommandPaletteDialog
          open={true}
          onOpenChange={onOpenChange}
          debounceMs={0}
        />
      );

      const input = await screen.findByTestId("command-palette-input");
      fireEvent.change(input, { target: { value: "replication" } });

      const resultItems = await screen.findAllByTestId(
        "command-palette-result-item"
      );
      expect(resultItems).toHaveLength(3);

      const badges = screen.getAllByTestId("command-palette-result-badge");
      expect(badges.map((b) => b.textContent)).toEqual([
        "Document",
        "Whiteboard",
        "Project",
      ]);

      // Selecting the whiteboard result navigates to its canonical URL and closes the dialog
      fireEvent.click(resultItems[1]);
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(pushMock).toHaveBeenCalledWith("/app/whiteboards/wb-202");
    });

    it("renders empty state when no results match and error state with retry on failure", async () => {
      let shouldFail = true;
      const fetchMock = vi.fn().mockImplementation(async () => {
        if (shouldFail) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: "Temporary search failure" }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            data: {
              query: "nonexistent-xyz-987",
              items: [],
              nextCursor: null,
              hasMore: false,
            },
          }),
        };
      });
      vi.stubGlobal("fetch", fetchMock);

      render(
        <CommandPaletteDialog
          open={true}
          onOpenChange={vi.fn()}
          debounceMs={0}
        />
      );

      const input = await screen.findByTestId("command-palette-input");
      fireEvent.change(input, { target: { value: "nonexistent-xyz-987" } });

      const errorAlert = await screen.findByTestId("command-palette-error");
      expect(errorAlert).toHaveTextContent("Temporary search failure");

      // Retry succeeds and shows the empty state
      shouldFail = false;
      fireEvent.click(screen.getByTestId("command-palette-retry"));

      expect(
        await screen.findByTestId("command-palette-empty")
      ).toHaveTextContent(
        "No matching documents, whiteboards, projects, or commands found."
      );
    });
  });
});
