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
import type { LiveMap, JsonObject } from "@liveblocks/client";
import type {
  CollaborativeWhiteboardProps,
  CollaboratorInfo,
} from "./types";
import { reconcileScene, sanitizeWhiteboardElement } from "./reconciliation";

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
  const lastSyncedVersionsRef = useRef<Map<string, number>>(new Map());
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
      const liveElements = storage.get("elements") as LiveMap<string, JsonObject> | undefined;
      if (!liveElements) return;

      for (const el of elementsToSync) {
        const sanitized = sanitizeWhiteboardElement(el);
        liveElements.set(el.id, sanitized as unknown as JsonObject);
      }
    },
    []
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

        for (const el of storageElements) {
          lastSyncedVersionsRef.current.set(el.id, el.version);
        }

        setTimeout(() => {
          isApplyingRemoteUpdateRef.current = false;
        }, 50);
      } else if (
        props.initialSnapshot?.elements &&
        props.initialSnapshot.elements.length > 0
      ) {
        hasInitializedFromStorageRef.current = true;
        const initialEls = props.initialSnapshot.elements;
        isApplyingRemoteUpdateRef.current = true;
        api.updateScene({ elements: initialEls });

        for (const el of initialEls) {
          lastSyncedVersionsRef.current.set(el.id, el.version);
        }

        // If authorized editor, seed Liveblocks storage with the initial snapshot
        if (canEdit) {
          updateStorageElements(initialEls);
        }

        setTimeout(() => {
          isApplyingRemoteUpdateRef.current = false;
        }, 50);
      } else {
        hasInitializedFromStorageRef.current = true;
      }
    }
  }, [elementsMap, excalidrawAPIRef, props.initialSnapshot, canEdit, updateStorageElements]);

  // Reconcile incoming remote updates from Liveblocks storage into Excalidraw canvas
  useEffect(() => {
    const api = excalidrawAPIRef.current;
    if (!api || !elementsMap || isApplyingRemoteUpdateRef.current) return;

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

    for (const el of reconciled) {
      lastSyncedVersionsRef.current.set(el.id, el.version);
    }

    setTimeout(() => {
      isApplyingRemoteUpdateRef.current = false;
    }, 50);
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
        const lastVersion = lastSyncedVersionsRef.current.get(el.id);
        if (lastVersion === undefined || el.version > lastVersion) {
          mutatedElements.push(el);
          lastSyncedVersionsRef.current.set(el.id, el.version);
        }
      }

      if (mutatedElements.length > 0) {
        updateStorageElements(mutatedElements);
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
  };
}
