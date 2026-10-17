import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type {
  AppState,
  BinaryFiles,
  Collaborator,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import {
  useStorage,
  useMutation,
  useOthers,
  useUpdateMyPresence,
  useStatus,
  useSelf,
} from "@liveblocks/react";
import { LiveMap, type JsonObject } from "@liveblocks/client";
import type {
  CollaborativeWhiteboardProps,
  CollaboratorInfo,
} from "./types";
import {
  reconcileScene,
  applyRestoredElementsToStorageMap,
  applyMutatedElementsToStorageMap,
  updateWhiteboardDomAttributes,
  StorageUnavailableError,
} from "./reconciliation";

function extractElementsArray(elementsContainer: unknown): ExcalidrawElement[] {
  if (!elementsContainer) return [];
  if (Array.isArray(elementsContainer)) {
    return elementsContainer as ExcalidrawElement[];
  }
  const obj = elementsContainer as Record<string, unknown>;
  if (typeof (obj as { values?: unknown }).values === "function") {
    return Array.from((obj as { values: () => Iterable<ExcalidrawElement> }).values());
  }
  if (typeof elementsContainer === "object") {
    return Object.values(elementsContainer as Record<string, ExcalidrawElement>);
  }
  return [];
}

export function useWhiteboardSync(
  props: CollaborativeWhiteboardProps,
  excalidrawAPIRef: React.MutableRefObject<ExcalidrawImperativeAPI | null>
) {
  const { whiteboardId, effectiveRole, isDemoMode = false } = props;
  const canEdit = effectiveRole !== "VIEWER";

  const roomStatus = useStatus();
  const self = useSelf();
  const others = useOthers();
  const updateMyPresence = useUpdateMyPresence();

  // Reference storage element map (null when storage is not yet initialized)
  const elementsMap = useStorage(
    (root) => root.elements as LiveMap<string, JsonObject> | undefined
  );

  // Synchronization tracking refs to prevent echo and infinite loops
  const isApplyingRemoteUpdateRef = useRef(false);
  const lastSyncedVersionsRef = useRef<
    Map<string, { version: number; versionNonce: number }>
  >(new Map());
  const hasInitializedFromStorageRef = useRef(false);
  const postgresSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedText, setLastSavedText] = useState<string>(() => {
    try {
      return new Date(props.updatedAtIso).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "Just now";
    }
  });

  // Debounced PostgreSQL snapshot persistence
  const persistSnapshotToPostgres = useCallback(
    async (elements: readonly ExcalidrawElement[]) => {
      if (isDemoMode || !canEdit) return;

      try {
        setSaveState("saving");
        // Filter out deeply deleted elements for cleaner storage footprint
        const nonDeleted = elements.filter((el) => !el.isDeleted);
        const res = await fetch(`/api/artifacts/${whiteboardId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentSnapshot: {
              elements: nonDeleted,
            },
          }),
        });

        if (res.ok) {
          setSaveState("saved");
          setLastSavedText(
            new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          );
        } else {
          setSaveState("error");
        }
      } catch {
        setSaveState("error");
      }
    },
    [whiteboardId, isDemoMode, canEdit]
  );

  const schedulePostgresSnapshot = useCallback(
    (elements: readonly ExcalidrawElement[]) => {
      if (postgresSaveTimerRef.current) {
        clearTimeout(postgresSaveTimerRef.current);
      }
      postgresSaveTimerRef.current = setTimeout(() => {
        void persistSnapshotToPostgres(elements);
      }, 1500);
    },
    [persistSnapshotToPostgres]
  );

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (postgresSaveTimerRef.current) {
        clearTimeout(postgresSaveTimerRef.current);
      }
    };
  }, []);

  // Liveblocks mutation to update changed elements in room storage
  const updateStorageElements = useMutation(
    ({ storage }, elementsToSync: readonly ExcalidrawElement[]) => {
      let liveElements = storage.get("elements") as LiveMap<string, JsonObject> | undefined;
      if (!liveElements) {
        liveElements = new LiveMap();
        storage.set("elements", liveElements);
      }
      applyMutatedElementsToStorageMap(liveElements, elementsToSync);
    },
    []
  );

  // Liveblocks mutation to apply restored whiteboard scene to storage
  const restoreStorageElements = useMutation(
    ({ storage }, elementsToRestore: readonly ExcalidrawElement[]) => {
      let liveElements = storage.get("elements") as LiveMap<string, JsonObject> | undefined;
      if (!liveElements) {
        liveElements = new LiveMap();
        storage.set("elements", liveElements);
      }
      applyRestoredElementsToStorageMap(liveElements, elementsToRestore);
    },
    []
  );

  const restoreScene = useCallback(
    (restoredElements: readonly ExcalidrawElement[]) => {
      const api = excalidrawAPIRef.current;
      if (!api) {
        throw new Error("Whiteboard canvas is not initialized");
      }

      isApplyingRemoteUpdateRef.current = true;
      api.updateScene({ elements: restoredElements });

      const postRestoreElements = api.getSceneElementsIncludingDeleted();
      for (const el of postRestoreElements) {
        lastSyncedVersionsRef.current.set(el.id, {
          version: el.version,
          versionNonce: el.versionNonce,
        });
      }

      if (typeof document !== "undefined") {
        const container = document.querySelector<HTMLElement>(
          '[data-testid="excalidraw-canvas-container"]'
        );
        updateWhiteboardDomAttributes(container, restoredElements);
      }

      queueMicrotask(() => {
        isApplyingRemoteUpdateRef.current = false;
      });

      if (canEdit) {
        if (!elementsMap) {
          setSaveState("error");
          setLastSavedText("Live sync unavailable");
          throw new StorageUnavailableError(
            "Liveblocks storage is not available to propagate restored scene to connected peers"
          );
        }

        try {
          restoreStorageElements(restoredElements);
        } catch (err: unknown) {
          setSaveState("error");
          setLastSavedText("Live sync failed");
          console.error("Failed to propagate restored scene to Liveblocks storage:", err);
          throw new Error(
            `Failed to propagate restored scene to Liveblocks storage: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }

      setSaveState("saved");
      setLastSavedText("Just restored");
    },
    [excalidrawAPIRef, canEdit, restoreStorageElements, elementsMap]
  );

  // Initial scene hydration from Liveblocks Storage or PostgreSQL snapshot
  useEffect(() => {
    const api = excalidrawAPIRef.current;
    if (!api || hasInitializedFromStorageRef.current) return;

    if (elementsMap !== undefined && elementsMap !== null) {
      const storageElements = extractElementsArray(elementsMap);

      if (storageElements.length > 0) {
        hasInitializedFromStorageRef.current = true;
        isApplyingRemoteUpdateRef.current = true;
        api.updateScene({ elements: storageElements });

        const postInitElements = api.getSceneElementsIncludingDeleted();
        for (const el of postInitElements) {
          lastSyncedVersionsRef.current.set(el.id, {
            version: el.version,
            versionNonce: el.versionNonce,
          });
        }

        if (typeof document !== "undefined") {
          const container = document.querySelector<HTMLElement>(
            '[data-testid="excalidraw-canvas-container"]'
          );
          updateWhiteboardDomAttributes(container, storageElements);
        }

        queueMicrotask(() => {
          isApplyingRemoteUpdateRef.current = false;
        });
      } else if (
        props.initialSnapshot?.elements &&
        props.initialSnapshot.elements.length > 0
      ) {
        hasInitializedFromStorageRef.current = true;
        const initialEls = props.initialSnapshot.elements;
        isApplyingRemoteUpdateRef.current = true;
        api.updateScene({ elements: initialEls });

        const postSnapshotElements = api.getSceneElementsIncludingDeleted();
        for (const el of postSnapshotElements) {
          lastSyncedVersionsRef.current.set(el.id, {
            version: el.version,
            versionNonce: el.versionNonce,
          });
        }

        if (typeof document !== "undefined") {
          const container = document.querySelector<HTMLElement>(
            '[data-testid="excalidraw-canvas-container"]'
          );
          updateWhiteboardDomAttributes(container, initialEls);
        }

        // If authorized editor, seed Liveblocks storage with the initial snapshot
        if (canEdit) {
          try {
            updateStorageElements(initialEls);
          } catch (err: unknown) {
            console.warn("Liveblocks storage unavailable during initial snapshot seeding:", err);
          }
        }

        queueMicrotask(() => {
          isApplyingRemoteUpdateRef.current = false;
        });
      } else {
        hasInitializedFromStorageRef.current = true;
      }
    }
  }, [elementsMap, excalidrawAPIRef, props.initialSnapshot, canEdit, updateStorageElements]);

  // Reconcile incoming remote updates from Liveblocks storage into Excalidraw canvas
  useEffect(() => {
    const api = excalidrawAPIRef.current;
    if (!api || !elementsMap) return;

    const remoteElements = extractElementsArray(elementsMap);
    if (remoteElements.length === 0) return;

    const localElements = api.getSceneElementsIncludingDeleted();
    const localMap = new Map<string, ExcalidrawElement>(
      localElements.map((el) => [el.id, el])
    );

    // Detect if remote elements contain differences or newer versions
    let hasDifferences = false;
    for (const remote of remoteElements) {
      const local = localMap.get(remote.id);
      if (
        !local ||
        local.version < remote.version ||
        (local.version === remote.version && local.versionNonce !== remote.versionNonce)
      ) {
        hasDifferences = true;
        break;
      }
    }

    if (!hasDifferences) return;

    // Apply robust property-aware whiteboard reconciliation
    const reconciled = reconcileScene(
      localElements,
      remoteElements,
      api.getAppState()
    );

    isApplyingRemoteUpdateRef.current = true;
    api.updateScene({ elements: reconciled });

    const postReconcileElements = api.getSceneElementsIncludingDeleted();
    for (const el of postReconcileElements) {
      lastSyncedVersionsRef.current.set(el.id, {
        version: el.version,
        versionNonce: el.versionNonce,
      });
    }

    if (typeof document !== "undefined") {
      const container = document.querySelector<HTMLElement>(
        '[data-testid="excalidraw-canvas-container"]'
      );
      updateWhiteboardDomAttributes(container, reconciled);
    }

    queueMicrotask(() => {
      isApplyingRemoteUpdateRef.current = false;
    });
  }, [elementsMap, excalidrawAPIRef]);

  // Handle local Excalidraw canvas mutations and broadcast changed elements
  const handleCanvasChange = useCallback(
    (
      elements: readonly ExcalidrawElement[],
      _appState: AppState,
      _files: BinaryFiles
    ) => {
      if (!canEdit || isApplyingRemoteUpdateRef.current) return;

      const mutatedElements: ExcalidrawElement[] = [];

      for (const el of elements) {
        const last = lastSyncedVersionsRef.current.get(el.id);
        if (
          !last ||
          el.version > last.version ||
          (el.version === last.version && el.versionNonce !== last.versionNonce)
        ) {
          mutatedElements.push(el);
        }
      }

      if (mutatedElements.length > 0) {
        try {
          updateStorageElements(mutatedElements);
          for (const el of mutatedElements) {
            lastSyncedVersionsRef.current.set(el.id, {
              version: el.version,
              versionNonce: el.versionNonce,
            });
          }
        } catch (err: unknown) {
          console.error("Failed to update Liveblocks storage elements:", err);
          setSaveState("error");
        }
        schedulePostgresSnapshot(elements);
      }
    },
    [canEdit, updateStorageElements, schedulePostgresSnapshot]
  );

  // Handle local pointer movements for ephemeral presence (laser / cursor)
  const handlePointerUpdate = useCallback(
    (payload: {
      pointer: { x: number; y: number; tool: "pointer" | "laser" };
      button: "down" | "up";
    }) => {
      updateMyPresence({
        cursor: {
          x: payload.pointer.x,
          y: payload.pointer.y,
        },
      });
    },
    [updateMyPresence]
  );

  // Map Liveblocks others presence to Excalidraw Collaborator map
  const collaborators = useMemo(() => {
    const map = new Map<string, Collaborator>();

    for (const other of others) {
      const presence = other.presence as
        | { cursor?: { x: number; y: number } | null }
        | undefined;
      const info = (other.info ?? {}) as {
        name?: string;
        email?: string;
        color?: string;
        avatar?: string;
      };

      const collaboratorId = other.id ?? `conn-${other.connectionId}`;
      const name = info.name || info.email || "Collaborator";
      const color = info.color || "#10B981";

      map.set(String(other.connectionId), {
        id: collaboratorId,
        username: name,
        avatarUrl: info.avatar,
        color: {
          background: color,
          stroke: color,
        },
        pointer: presence?.cursor
          ? {
              x: presence.cursor.x,
              y: presence.cursor.y,
              tool: "pointer",
            }
          : undefined,
      });
    }

    return map;
  }, [others]);

  // List of remote collaborators for UI avatar rendering in the header
  const remoteCollaborators: CollaboratorInfo[] = useMemo(() => {
    return others.map((other) => {
      const info = (other.info ?? {}) as {
        name?: string;
        email?: string;
        color?: string;
        role?: string;
      };
      return {
        connectionId: other.connectionId,
        id: other.id ?? `conn-${other.connectionId}`,
        name: info.name || info.email || "Collaborator",
        color: info.color || "#10B981",
        role: info.role || "EDITOR",
      };
    });
  }, [others]);

  const selfCollaborator = useMemo(() => {
    if (self?.info) {
      const info = self.info as {
        name?: string;
        email?: string;
        color?: string;
      };
      return {
        id: self.id ?? props.currentUser?.id ?? "self",
        name: info.name || props.currentUser?.name || "You",
        color: info.color || props.currentUser?.color || "#6366F1",
      };
    }
    if (props.currentUser) {
      return {
        id: props.currentUser.id,
        name: props.currentUser.name,
        color: props.currentUser.color || "#6366F1",
      };
    }
    return null;
  }, [self, props.currentUser]);

  return {
    roomStatus,
    collaborators,
    remoteCollaborators,
    selfCollaborator,
    handleCanvasChange,
    handlePointerUpdate,
    saveState,
    lastSavedText,
    restoreScene,
  };
}
