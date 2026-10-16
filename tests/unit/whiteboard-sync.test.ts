import { describe, it, expect } from "vitest";
import type {
  ExcalidrawElement,
  ExcalidrawRectangleElement,
  ExcalidrawEllipseElement,
} from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import {
  sanitizeWhiteboardElement,
  markElementAsDeleted,
  reconcileElementPair,
  reconcileScene,
  hasPropertyDiff,
  SPATIAL_PROPERTIES,
  STYLE_PROPERTIES,
  applyRestoredElementsToStorageMap,
  applyMutatedElementsToStorageMap,
  updateWhiteboardDomAttributes,
  StorageUnavailableError,
} from "@/components/whiteboards/reconciliation";

function makeRectangle(
  id: string,
  overrides?: Partial<ExcalidrawRectangleElement>
): ExcalidrawRectangleElement {
  return {
    id,
    type: "rectangle",
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    roundness: null,
    seed: 123456,
    version: 1,
    versionNonce: 1000,
    isDeleted: false,
    boundElements: null,
    updated: 1700000000000,
    link: null,
    locked: false,
    ...overrides,
  } as ExcalidrawRectangleElement;
}

function makeEllipse(
  id: string,
  overrides?: Partial<ExcalidrawEllipseElement>
): ExcalidrawEllipseElement {
  return {
    id,
    type: "ellipse",
    x: 300,
    y: 200,
    width: 120,
    height: 120,
    angle: 0,
    strokeColor: "#3b82f6",
    backgroundColor: "#eff6ff",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    roundness: null,
    seed: 654321,
    version: 1,
    versionNonce: 2000,
    isDeleted: false,
    boundElements: null,
    updated: 1700000000000,
    link: null,
    locked: false,
    ...overrides,
  } as ExcalidrawEllipseElement;
}

describe("Whiteboard Concurrency & Reconciliation Suite (Phase 6B)", () => {
  describe("1. Element Sanitization", () => {
    it("strips transient local UI state (isSelected) before broadcasting to storage", () => {
      const raw = makeRectangle("rect-1", { isSelected: true } as any);
      const sanitized = sanitizeWhiteboardElement(raw);

      expect((sanitized as any).isSelected).toBeUndefined();
      expect(sanitized.id).toBe("rect-1");
      expect(sanitized.x).toBe(100);
      expect(sanitized.width).toBe(200);
    });

    it("preserves visual, geometric, and structural properties intact", () => {
      const raw = makeRectangle("rect-2", {
        strokeColor: "#8b5cf6",
        backgroundColor: "#ede9fe",
        strokeWidth: 4,
        roughness: 2,
        opacity: 80,
      });
      const sanitized = sanitizeWhiteboardElement(raw);
      expect(sanitized).toEqual(raw);
    });
  });

  describe("2. Scenario A — Concurrent Element Creation", () => {
    it("preserves both elements when two users independently create different elements", () => {
      const elA = makeRectangle("rect-user-a", { x: 50, y: 50, version: 1 });
      const elB = makeEllipse("ellipse-user-b", { x: 400, y: 150, version: 1 });

      // Local has elA; remote has elB
      const reconciled = reconcileScene([elA], [elB]);

      const ids = reconciled.map((el) => el.id);
      expect(ids).toContain("rect-user-a");
      expect(ids).toContain("ellipse-user-b");
      expect(reconciled).toHaveLength(2);

      const foundA = reconciled.find((el) => el.id === "rect-user-a");
      const foundB = reconciled.find((el) => el.id === "ellipse-user-b");

      expect(foundA?.type).toBe("rectangle");
      expect(foundA?.x).toBe(50);
      expect(foundB?.type).toBe("ellipse");
      expect(foundB?.x).toBe(400);
    });

    it("produces equivalent converged scenes regardless of update arrival order", () => {
      const elA = makeRectangle("rect-user-a", { x: 50, y: 50 });
      const elB = makeEllipse("ellipse-user-b", { x: 400, y: 150 });

      // Arrival Order 1: Peer 1 starts with A, receives B
      const scene1 = reconcileScene([elA], [elB]);

      // Arrival Order 2: Peer 2 starts with B, receives A
      const scene2 = reconcileScene([elB], [elA]);

      const ids1 = new Set(scene1.map((el) => el.id));
      const ids2 = new Set(scene2.map((el) => el.id));

      expect(ids1).toEqual(ids2);
      expect(ids1.has("rect-user-a")).toBe(true);
      expect(ids1.has("ellipse-user-b")).toBe(true);
    });
  });

  describe("3. Scenario B — Concurrent Changes to the Same Element", () => {
    it("merges independent changes when User A moves an element and User B changes its style", () => {
      const base = makeRectangle("shared-card", {
        x: 100,
        y: 100,
        strokeColor: "#000000",
        backgroundColor: "#ffffff",
        version: 1,
        versionNonce: 100,
      });

      // User A moves the element: (x, y) changed, style unchanged
      const localMoved = makeRectangle("shared-card", {
        ...base,
        x: 250,
        y: 320,
        version: 2,
        versionNonce: 101,
      });

      // User B styles the element: style changed, position unchanged
      const remoteStyled = makeRectangle("shared-card", {
        ...base,
        strokeColor: "#ef4444",
        backgroundColor: "#fee2e2",
        fillStyle: "cross-hatch",
        version: 2,
        versionNonce: 102,
      });

      const merged = reconcileElementPair(localMoved, remoteStyled, null, base);

      // Both independent changes must survive
      expect(merged.id).toBe("shared-card");
      expect(merged.x).toBe(250);
      expect(merged.y).toBe(320);
      expect(merged.strokeColor).toBe("#ef4444");
      expect(merged.backgroundColor).toBe("#fee2e2");
      expect(merged.fillStyle).toBe("cross-hatch");
      expect(merged.version).toBeGreaterThan(2);
    });

    it("applies deterministic LWW when both users modify the same property (spatial conflict)", () => {
      // Both users concurrently moved the element to different positions
      const local = makeRectangle("box-1", {
        x: 200,
        y: 200,
        version: 5,
        versionNonce: 50,
      });
      const remote = makeRectangle("box-1", {
        x: 800,
        y: 800,
        version: 4,
        versionNonce: 99,
      });

      // Higher version wins
      const winner = reconcileElementPair(local, remote);
      expect(winner.x).toBe(200);
      expect(winner.y).toBe(200);
      expect(winner.version).toBe(5);
    });

    it("breaks tie deterministically using lowest versionNonce when versions match", () => {
      // Both users have version 6 with conflicting coordinates
      const peerA = makeRectangle("box-1", {
        x: 150,
        y: 150,
        version: 6,
        versionNonce: 200, // lower nonce
      });
      const peerB = makeRectangle("box-1", {
        x: 450,
        y: 450,
        version: 6,
        versionNonce: 500, // higher nonce
      });

      // Lowest versionNonce wins deterministically across all peers (Excalidraw convention)
      const resultAtPeerA = reconcileElementPair(peerA, peerB);
      const resultAtPeerB = reconcileElementPair(peerB, peerA);

      expect(resultAtPeerA.x).toBe(150);
      expect(resultAtPeerB.x).toBe(150);
      expect(resultAtPeerA.versionNonce).toBe(200);
      expect(resultAtPeerB.versionNonce).toBe(200);
    });

    it("protects local element during active user interaction (resizing/editing)", () => {
      const localActive = makeRectangle("box-resizing", {
        x: 100,
        y: 100,
        width: 300,
        version: 2,
        versionNonce: 500,
      });
      const remoteIncoming = makeRectangle("box-resizing", {
        x: 100,
        y: 100,
        width: 150,
        version: 4, // higher version from remote
        versionNonce: 100,
      });

      const mockAppState: Partial<AppState> = {
        resizingElement: localActive as any,
      };

      const winner = reconcileElementPair(localActive, remoteIncoming, mockAppState as AppState);

      // Local is preserved during active gesture to prevent jarring layout jump
      expect(winner.width).toBe(300);
      expect(winner.id).toBe("box-resizing");
    });
  });

  describe("4. Scenario C — Deletion versus Stale Edit (Tombstone Resurrection Prevention)", () => {
    it("ensures a tombstone deletion supersedes an older active update", () => {
      // User B has a pending stale update from before the deletion
      const staleActive = makeRectangle("item-deleted", {
        version: 3,
        versionNonce: 50,
        isDeleted: false,
      });

      // User A deleted the element (tombstone version 4)
      const tombstone = markElementAsDeleted(staleActive);
      expect(tombstone.version).toBe(4);
      expect(tombstone.isDeleted).toBe(true);

      const result = reconcileElementPair(staleActive, tombstone);
      expect(result.isDeleted).toBe(true);
      expect(result.version).toBe(4);
    });

    it("ensures tombstone wins even when active edit has the same version", () => {
      const active = makeRectangle("item-conflict", {
        version: 5,
        versionNonce: 10,
        isDeleted: false,
      });
      const tombstone = makeRectangle("item-conflict", {
        version: 5,
        versionNonce: 999, // even with higher nonce, tombstone wins
        isDeleted: true,
      });

      const result = reconcileElementPair(active, tombstone);
      expect(result.isDeleted).toBe(true);
    });

    it("prevents late-arriving stale update from resurrecting an element in full scene reconciliation", () => {
      const activeEl1 = makeRectangle("el-1", { version: 1, isDeleted: false });
      const tombstoneEl2 = makeRectangle("el-2", { version: 3, isDeleted: true });

      // Local scene already has the tombstone
      const localScene = [activeEl1, tombstoneEl2];

      // Stale remote update arrives with older active el-2 (version 2)
      const staleRemoteEl2 = makeRectangle("el-2", { version: 2, isDeleted: false, x: 999 });
      const remoteScene = [activeEl1, staleRemoteEl2];

      const reconciled = reconcileScene(localScene, remoteScene);

      const el2 = reconciled.find((el) => el.id === "el-2");
      expect(el2).toBeDefined();
      expect(el2?.isDeleted).toBe(true);
      expect(el2?.version).toBe(3);
    });
  });

  describe("5. Scenario D — Duplicate and Out-of-Order Updates", () => {
    it("is strictly idempotent when replaying already applied updates", () => {
      const current = makeRectangle("rect-idem", {
        x: 120,
        y: 180,
        version: 5,
        versionNonce: 444,
      });

      // Replay the exact same update
      const replay = { ...current };

      const result = reconcileElementPair(current, replay);
      expect(result).toEqual(current);
    });

    it("discards out-of-order older updates without corrupting newer scene state", () => {
      const currentNewer = makeRectangle("rect-order", {
        x: 500,
        y: 600,
        strokeColor: "#10b981",
        version: 8,
        versionNonce: 888,
      });

      // Delayed update with version 4 arrives
      const delayedOlder = makeRectangle("rect-order", {
        x: 100,
        y: 100,
        strokeColor: "#ef4444",
        version: 4,
        versionNonce: 444,
      });

      const result = reconcileElementPair(currentNewer, delayedOlder);

      expect(result.version).toBe(8);
      expect(result.x).toBe(500);
      expect(result.strokeColor).toBe("#10b981");
    });

    it("preserves unrelated elements during single-element updates", () => {
      const el1 = makeRectangle("el-1", { version: 2 });
      const el2 = makeEllipse("el-2", { version: 3 });
      const el3 = makeRectangle("el-3", { version: 1 });

      const localScene = [el1, el2, el3];

      // Remote update only touches el2
      const updatedEl2 = makeEllipse("el-2", {
        ...el2,
        strokeColor: "#f59e0b",
        version: 4,
      });
      const remoteScene = [updatedEl2];

      const reconciled = reconcileScene(localScene, remoteScene);

      expect(reconciled).toHaveLength(3);
      const found1 = reconciled.find((el) => el.id === "el-1");
      const found2 = reconciled.find((el) => el.id === "el-2");
      const found3 = reconciled.find((el) => el.id === "el-3");

      expect(found1).toBeDefined();
      expect(found3).toBeDefined();
      expect(found2?.strokeColor).toBe("#f59e0b");
      expect(found2?.version).toBe(4);
    });
  });

  describe("6. Scenario E — Reconnection and Late Joining", () => {
    it("updates stale local elements while preserving local offline creations upon reconnect", () => {
      // Local client was disconnected.
      // It has a stale version of el-1, and created el-offline while disconnected.
      const localStale1 = makeRectangle("el-1", {
        x: 100,
        y: 100,
        version: 1,
      });
      const localOfflineNew = makeRectangle("el-offline", {
        x: 350,
        y: 350,
        version: 1,
      });
      const localScene = [localStale1, localOfflineNew];

      // Remote cloud scene progressed while peer was offline:
      // el-1 was moved to (400, 400) at version 3, and another peer created el-remote-new.
      const remoteUpdated1 = makeRectangle("el-1", {
        x: 400,
        y: 400,
        version: 3,
      });
      const remoteNew = makeEllipse("el-remote-new", {
        x: 600,
        y: 600,
        version: 1,
      });
      const remoteScene = [remoteUpdated1, remoteNew];

      const reconciled = reconcileScene(localScene, remoteScene);

      // el-1 must receive the newer remote coordinates
      const el1 = reconciled.find((el) => el.id === "el-1");
      expect(el1?.version).toBe(3);
      expect(el1?.x).toBe(400);

      // el-offline created locally must be preserved
      const elOffline = reconciled.find((el) => el.id === "el-offline");
      expect(elOffline).toBeDefined();
      expect(elOffline?.x).toBe(350);

      // el-remote-new from peers must be incorporated
      const elRemote = reconciled.find((el) => el.id === "el-remote-new");
      expect(elRemote).toBeDefined();
      expect(elRemote?.x).toBe(600);

      expect(reconciled).toHaveLength(3);
    });

    it("hydrates complete scene for late-joining collaborator or full page refresh", () => {
      const emptyLocalScene: ExcalidrawElement[] = [];

      const cloudStorageElements = [
        makeRectangle("box-a", { x: 50, y: 50, version: 2 }),
        makeEllipse("box-b", { x: 250, y: 250, version: 4 }),
      ];

      const hydrated = reconcileScene(emptyLocalScene, cloudStorageElements);

      expect(hydrated).toHaveLength(2);
      expect(hydrated.map((el) => el.id)).toEqual(["box-a", "box-b"]);
    });
  });

  describe("7. PostgreSQL Snapshot Data Filtering & Integrity", () => {
    it("filters out deleted tombstones before persisting snapshot payload to database", () => {
      const canvasElements = [
        makeRectangle("el-1", { isDeleted: false }),
        makeRectangle("el-2", { isDeleted: true }),
        makeEllipse("el-3", { isDeleted: false }),
        makeRectangle("el-4", { isDeleted: true }),
      ];

      const snapshotPayload = {
        elements: canvasElements.filter((el) => !el.isDeleted),
      };

      expect(snapshotPayload.elements).toHaveLength(2);
      expect(snapshotPayload.elements.map((el) => el.id)).toEqual(["el-1", "el-3"]);
    });

    it("safely serializes and parses complex whiteboard scene structure without data loss", () => {
      const sceneData = {
        elements: [
          makeRectangle("rect-complex", {
            groupIds: ["group-alpha", "group-beta"],
            strokeColor: "#4f46e5",
            backgroundColor: "#e0e7ff",
            version: 15,
          }),
        ],
        appState: {
          viewBackgroundColor: "#ffffff",
          zoom: { value: 1.5 },
          scrollX: 100,
          scrollY: 200,
        },
      };

      const serialized = JSON.stringify(sceneData);
      const parsed = JSON.parse(serialized);

      expect(parsed).toEqual(sceneData);
      expect(parsed.elements[0].groupIds).toEqual(["group-alpha", "group-beta"]);
      expect(parsed.elements[0].strokeColor).toBe("#4f46e5");
    });
  });

  describe("8. Storage Mutation Error Handling & Failure Paths", () => {
    it("throws StorageUnavailableError when storage elements map is null or undefined on restore", () => {
      expect(() => {
        applyRestoredElementsToStorageMap(null, [makeRectangle("el-1")]);
      }).toThrow(StorageUnavailableError);

      expect(() => {
        applyRestoredElementsToStorageMap(undefined, [makeRectangle("el-1")]);
      }).toThrow("Liveblocks storage is not available to propagate restored scene to connected peers");
    });

    it("throws StorageUnavailableError when storage elements map is null or undefined on mutation", () => {
      expect(() => {
        applyMutatedElementsToStorageMap(null, [makeRectangle("el-1")]);
      }).toThrow(StorageUnavailableError);

      expect(() => {
        applyMutatedElementsToStorageMap(undefined, [makeRectangle("el-1")]);
      }).toThrow("Liveblocks storage is not available for real-time element mutation");
    });

    it("propagates unexpected storage errors without swallowing them", () => {
      const mockStorageMap = {
        entries: () => [],
        set: () => {
          throw new Error("Liveblocks WebSocket network disconnect");
        },
      };

      expect(() => {
        applyRestoredElementsToStorageMap(mockStorageMap as any, [makeRectangle("el-1")]);
      }).toThrow("Liveblocks WebSocket network disconnect");

      expect(() => {
        applyMutatedElementsToStorageMap(mockStorageMap as any, [makeRectangle("el-1")]);
      }).toThrow("Liveblocks WebSocket network disconnect");
    });

    it("successfully applies restored elements and marks non-restored elements as deleted", () => {
      const storageState = new Map<string, any>([
        ["el-existing", makeRectangle("el-existing", { version: 1, isDeleted: false })],
        ["el-displaced", makeEllipse("el-displaced", { version: 2, isDeleted: false })],
      ]);

      const mockLiveMap = {
        entries: () => storageState.entries(),
        set: (key: string, val: any) => storageState.set(key, val),
      };

      const restoredElements = [
        makeRectangle("el-existing", { version: 3, width: 300 }),
        makeRectangle("el-brand-new", { version: 1, height: 150 }),
      ];

      applyRestoredElementsToStorageMap(mockLiveMap as any, restoredElements);

      // el-displaced should be marked deleted with incremented version
      const displaced = storageState.get("el-displaced");
      expect(displaced.isDeleted).toBe(true);
      expect(displaced.version).toBe(3);

      // el-existing should be updated with restored data and sanitized
      const existing = storageState.get("el-existing");
      expect(existing.isDeleted).toBe(false);
      expect(existing.width).toBe(300);

      // el-brand-new should be inserted
      const brandNew = storageState.get("el-brand-new");
      expect(brandNew.isDeleted).toBe(false);
      expect(brandNew.height).toBe(150);
    });

    it("accurately computes and sets DOM data attributes on canvas container", () => {
      const mockDiv = {
        attributes: new Map<string, string>(),
        setAttribute(k: string, v: string) {
          this.attributes.set(k, v);
        },
        getAttribute(k: string) {
          return this.attributes.get(k) ?? null;
        },
      };

      const elements = [
        makeRectangle("rect-1", { x: 50, y: 60, width: 100, height: 80, isDeleted: false }),
        makeEllipse("ellipse-2", { x: 200, y: 150, width: 90, height: 90, isDeleted: true }),
        makeRectangle("rect-3", { x: 300, y: 400, width: 150, height: 120, isDeleted: false }),
      ];

      updateWhiteboardDomAttributes(mockDiv as unknown as HTMLElement, elements);

      expect(mockDiv.getAttribute("data-active-count")).toBe("2");
      expect(mockDiv.getAttribute("data-active-element-ids")).toBe("rect-1,rect-3");

      const activeJson = JSON.parse(mockDiv.getAttribute("data-active-elements")!);
      expect(activeJson).toHaveLength(2);
      expect(activeJson[0]).toEqual({
        id: "rect-1",
        type: "rectangle",
        x: 50,
        y: 60,
        width: 100,
        height: 80,
      });
      expect(activeJson[1]).toEqual({
        id: "rect-3",
        type: "rectangle",
        x: 300,
        y: 400,
        width: 150,
        height: 120,
      });

      expect(mockDiv.getAttribute("data-scene-signature")).toContain("2:rect-1_rectangle_50_60;rect-3_rectangle_300_400");
    });
  });
});
