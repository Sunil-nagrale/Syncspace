import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  ActivityValidationError,
  DEFAULT_ACTIVITY_LIMIT,
  MAX_ACTIVITY_LIMIT,
  MAX_METADATA_STRING_LENGTH,
  activityFeedQuerySchema,
  classifyActivityCategory,
  decodeActivityCursor,
  encodeActivityCursor,
  formatActivitySummary,
  sanitizeActivityMetadata,
  type WorkspaceActivityItem,
} from "@/lib/validations/activity";
import {
  WorkspaceActivityFeed,
  formatActivityTimestamp,
} from "@/components/activity/workspace-activity-feed";

describe("Phase 10B Unit Tests — Workspace Activity Validation, Formatting & UI", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("activityFeedQuerySchema & cursor validation", () => {
    it("applies safe defaults and validates bounded limit and category filter", () => {
      const parsed = activityFeedQuerySchema.parse({});
      expect(parsed.limit).toBe(DEFAULT_ACTIVITY_LIMIT);
      expect(parsed.category).toBe("ALL");
      expect(parsed.cursor).toBeUndefined();

      const custom = activityFeedQuerySchema.parse({
        limit: "25",
        category: "COMMENT",
      });
      expect(custom.limit).toBe(25);
      expect(custom.category).toBe("COMMENT");

      expect(() => activityFeedQuerySchema.parse({ limit: 0 })).toThrow();
      expect(() =>
        activityFeedQuerySchema.parse({ limit: MAX_ACTIVITY_LIMIT + 1 })
      ).toThrow();
      expect(() =>
        activityFeedQuerySchema.parse({ category: "UNKNOWN_CATEGORY" })
      ).toThrow();
      expect(() =>
        activityFeedQuerySchema.parse({ cursor: "bad\u0000cursor" })
      ).toThrow();
    });

    it("encodes and decodes deterministic keyset cursors and rejects malformed cursors", () => {
      const date = new Date("2026-10-17T15:00:00.000Z");
      const cursor = encodeActivityCursor(date, "evt_12345");
      const decoded = decodeActivityCursor(cursor);

      expect(decoded.createdAt.toISOString()).toBe("2026-10-17T15:00:00.000Z");
      expect(decoded.id).toBe("evt_12345");

      expect(() => decodeActivityCursor("not-valid-base64-json!!!")).toThrow(
        ActivityValidationError
      );

      const missingIdCursor = Buffer.from(
        JSON.stringify({ t: "2026-10-17T15:00:00.000Z", id: "   " }),
        "utf8"
      ).toString("base64url");
      expect(() => decodeActivityCursor(missingIdCursor)).toThrow(
        ActivityValidationError
      );

      const badDateCursor = Buffer.from(
        JSON.stringify({ t: "not-a-date", id: "evt_1" }),
        "utf8"
      ).toString("base64url");
      expect(() => decodeActivityCursor(badDateCursor)).toThrow(
        ActivityValidationError
      );
    });
  });

  describe("sanitizeActivityMetadata", () => {
    it("strips secrets, tokens, presigned URLs, storage keys, snapshots, comment bodies, emails, and sha256 digests", () => {
      const dirty = {
        title: "   Q4   Product   Architecture   ",
        versionNumber: 3,
        isPinned: true,
        fileName: "architecture-diagram.pdf",
        fileSize: 4096,
        role: "EDITOR",
        // Forbidden / non-allowlisted keys that must never leak:
        passwordHash: "bcrypt$2b$12$secret",
        rawToken: "deadbeef1234567890",
        sessionToken: "sess_abc",
        uploadUrl: "https://s3.example.com/presigned?X-Amz-Signature=secret",
        downloadUrl: "https://s3.example.com/download?sig=secret",
        storageKey: "workspaces/ws_1/artifacts/art_1/blobs/obj.pdf",
        contentSnapshot: { type: "doc", content: [{ text: "Private body" }] },
        snapshotData: { elements: [] },
        content: "Private comment body that should not be in activity metadata",
        body: "Private body",
        recipientEmail: "private.user@syncspace.dev",
        removedUserEmail: "removed.user@syncspace.dev",
        email: "owner@syncspace.dev",
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        arbitraryKey: "not in allowlist",
      };

      const sanitized = sanitizeActivityMetadata(dirty);

      expect(sanitized).toEqual({
        title: "Q4 Product Architecture",
        versionNumber: 3,
        isPinned: true,
        fileName: "architecture-diagram.pdf",
        fileSize: 4096,
        role: "EDITOR",
      });

      expect(sanitized).not.toHaveProperty("passwordHash");
      expect(sanitized).not.toHaveProperty("rawToken");
      expect(sanitized).not.toHaveProperty("sessionToken");
      expect(sanitized).not.toHaveProperty("uploadUrl");
      expect(sanitized).not.toHaveProperty("downloadUrl");
      expect(sanitized).not.toHaveProperty("storageKey");
      expect(sanitized).not.toHaveProperty("contentSnapshot");
      expect(sanitized).not.toHaveProperty("snapshotData");
      expect(sanitized).not.toHaveProperty("content");
      expect(sanitized).not.toHaveProperty("recipientEmail");
      expect(sanitized).not.toHaveProperty("removedUserEmail");
      expect(sanitized).not.toHaveProperty("email");
      expect(sanitized).not.toHaveProperty("sha256");
    });

    it("truncates overly long metadata strings and removes control characters", () => {
      const longTitle = "A".repeat(MAX_METADATA_STRING_LENGTH + 50);
      const sanitized = sanitizeActivityMetadata({
        title: `Hello\u0000World\u0007 ${longTitle}`,
      });

      expect(typeof sanitized.title).toBe("string");
      expect((sanitized.title as string).length).toBeLessThanOrEqual(
        MAX_METADATA_STRING_LENGTH
      );
      expect(sanitized.title as string).not.toContain("\u0000");
    });
  });

  describe("classifyActivityCategory & formatActivitySummary", () => {
    it("classifies actions into the expected activity categories", () => {
      expect(
        classifyActivityCategory("artifact.created.document", "artifact")
      ).toBe("ARTIFACT");
      expect(
        classifyActivityCategory("comment.thread_created", "comment_thread")
      ).toBe("COMMENT");
      expect(
        classifyActivityCategory("artifact.version.restored", "artifact_version")
      ).toBe("VERSION");
      expect(
        classifyActivityCategory("UPLOADED_ATTACHMENT", "ATTACHMENT")
      ).toBe("ATTACHMENT");
      expect(classifyActivityCategory("project.created", "project")).toBe(
        "PROJECT"
      );
      expect(classifyActivityCategory("invitation.accepted", "workspace_member")).toBe(
        "MEMBER"
      );
    });

    it("formats readable summaries for active and archived/deleted targets without leaking restricted titles", () => {
      expect(
        formatActivitySummary({
          action: "artifact.created.document",
          entityType: "artifact",
          targetTitle: "System Design Spec",
          isTargetArchivedOrDeleted: false,
          metadata: {},
        })
      ).toBe('created document "System Design Spec"');

      expect(
        formatActivitySummary({
          action: "artifact.created.document",
          entityType: "artifact",
          targetTitle: null,
          isTargetArchivedOrDeleted: true,
          metadata: {},
        })
      ).toBe("created a document (archived)");

      expect(
        formatActivitySummary({
          action: "artifact.version.restored",
          entityType: "artifact_version",
          targetTitle: "Architecture Board",
          isTargetArchivedOrDeleted: false,
          metadata: { restoredFromVersion: 2 },
        })
      ).toBe('restored "Architecture Board" to v2');

      expect(
        formatActivitySummary({
          action: "UPLOADED_ATTACHMENT",
          entityType: "ATTACHMENT",
          targetTitle: "Architecture Board",
          isTargetArchivedOrDeleted: false,
          metadata: { fileName: "topology.png" },
        })
      ).toBe('uploaded attachment "topology.png" to "Architecture Board"');

      expect(
        formatActivitySummary({
          action: "UPLOADED_ATTACHMENT",
          entityType: "ATTACHMENT",
          targetTitle: null,
          isTargetArchivedOrDeleted: true,
          metadata: {},
        })
      ).toBe("uploaded a file attachment to an archived artifact");
    });

    it("formats relative timestamps cleanly", () => {
      const nowIso = new Date().toISOString();
      expect(formatActivityTimestamp(nowIso)).toBe("Just now");
      expect(formatActivityTimestamp("invalid-date")).toBe("");
    });
  });

  describe("WorkspaceActivityFeed component", () => {
    const sampleItems: WorkspaceActivityItem[] = [
      {
        id: "act_1",
        workspaceId: "ws_1",
        action: "artifact.created.document",
        category: "ARTIFACT",
        entityType: "artifact",
        entityId: "doc_1",
        targetTitle: "Engineering Handbook",
        targetUrl: "/app/documents/doc_1",
        summary: 'created document "Engineering Handbook"',
        actor: {
          id: "usr_1",
          name: "Ada Lovelace",
          image: null,
          color: "#6366F1",
        },
        metadata: { title: "Engineering Handbook" },
        createdAt: new Date().toISOString(),
      },
      {
        id: "act_2",
        workspaceId: "ws_1",
        action: "comment.thread_created",
        category: "COMMENT",
        entityType: "comment_thread",
        entityId: "thr_1",
        targetTitle: "Engineering Handbook",
        targetUrl: "/app/documents/doc_1",
        summary: 'started a discussion thread on "Engineering Handbook"',
        actor: {
          id: "usr_2",
          name: "Grace Hopper",
          image: null,
          color: "#10B981",
        },
        metadata: { threadId: "thr_1" },
        createdAt: new Date(Date.now() - 120_000).toISOString(),
      },
    ];

    it("renders initial activity items, actor names, summaries, and authorized target links", () => {
      render(
        <WorkspaceActivityFeed
          workspaceId="ws_1"
          initialItems={sampleItems}
          initialNextCursor="cursor_page_2"
          initialHasMore={true}
        />
      );

      const feedItems = screen.getAllByTestId("activity-feed-item");
      expect(feedItems).toHaveLength(2);
      expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
      expect(
        screen.getByText('created document "Engineering Handbook"')
      ).toBeInTheDocument();
      expect(screen.getByText("Grace Hopper")).toBeInTheDocument();

      const links = screen.getAllByTestId("activity-target-link");
      expect(links[0]).toHaveAttribute("href", "/app/documents/doc_1");
      expect(
        screen.getByTestId("activity-load-more-button")
      ).toBeInTheDocument();
    });

    it("fetches filtered events when a category tab is clicked and paginates with Load More", async () => {
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspaceId: "ws_1",
          items: [sampleItems[1]],
          nextCursor: "cursor_comments_2",
          hasMore: true,
        }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspaceId: "ws_1",
          items: [
            {
              ...sampleItems[1],
              id: "act_3",
              summary: 'replied to a discussion on "Engineering Handbook"',
            },
          ],
          nextCursor: null,
          hasMore: false,
        }),
      });

      render(
        <WorkspaceActivityFeed
          workspaceId="ws_1"
          initialItems={sampleItems}
          initialNextCursor={null}
          initialHasMore={false}
        />
      );

      fireEvent.click(screen.getByTestId("activity-filter-comment"));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
      expect(fetchMock.mock.calls[0][0]).toContain("category=COMMENT");

      await waitFor(() => {
        expect(screen.getAllByTestId("activity-feed-item")).toHaveLength(1);
      });

      fireEvent.click(screen.getByTestId("activity-load-more-button"));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });
      expect(fetchMock.mock.calls[1][0]).toContain("cursor=cursor_comments_2");

      await waitFor(() => {
        expect(screen.getAllByTestId("activity-feed-item")).toHaveLength(2);
      });
    });

    it("renders empty state and handles error + retry recovery", async () => {
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      fetchMock.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Simulated network failure" }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspaceId: "ws_1",
          items: [],
          nextCursor: null,
          hasMore: false,
        }),
      });

      render(<WorkspaceActivityFeed workspaceId="ws_1" />);

      await waitFor(() => {
        expect(screen.getByTestId("activity-error-state")).toBeInTheDocument();
      });
      expect(
        screen.getByText("Simulated network failure")
      ).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("activity-retry-button"));

      await waitFor(() => {
        expect(screen.getByTestId("activity-empty-state")).toBeInTheDocument();
      });
    });
  });
});
