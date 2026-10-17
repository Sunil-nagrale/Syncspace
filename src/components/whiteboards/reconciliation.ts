import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

// Categorized element properties for granular conflict-resolution
export const SPATIAL_PROPERTIES: readonly (keyof ExcalidrawElement)[] = [
  "x",
  "y",
  "width",
  "height",
  "angle",
] as const;

export const STYLE_PROPERTIES: readonly (keyof ExcalidrawElement)[] = [
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "opacity",
  "roundness",
] as const;

export const TEXT_PROPERTIES: readonly (keyof ExcalidrawTextElement)[] = [
  "text",
  "fontSize",
  "fontFamily",
  "textAlign",
  "verticalAlign",
  "lineHeight",
] as const;

/**
 * Strips transient local client properties (e.g. selection) before storage transmission.
 */
export function sanitizeWhiteboardElement(
  el: ExcalidrawElement
): ExcalidrawElement {
  const copy = { ...el };
  delete (copy as Record<string, unknown>).isSelected;
  return copy;
}

/**
 * Tombstones an element for permanent deletion propagation.
 * Increments the version and generates a new versionNonce to ensure dominance
 * over any in-flight or stale active updates.
 */
export function markElementAsDeleted(
  el: ExcalidrawElement,
  overrideNonce?: number
): ExcalidrawElement {
  return {
    ...el,
    isDeleted: true,
    version: el.version + 1,
    versionNonce:
      overrideNonce !== undefined
        ? overrideNonce
        : Math.floor(Math.random() * 2000000000) + 1,
    updated: Date.now(),
  };
}

/**
 * Detects whether any properties in a given property category differ between two element states.
 */
export function hasPropertyDiff(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  properties: readonly string[]
): boolean {
  for (const prop of properties) {
    if (a[prop] !== b[prop]) {
      return true;
    }
  }
  return false;
}

/**
 * Deterministically merges concurrent edits on the same element when changes
 * affect disjoint property sets (e.g. Peer A moved the element while Peer B changed its style).
 *
 * Conflict Resolution Policy:
 * 1. Tombstone Dominance:
 *    If either element is deleted:
 *    - If tombstone.version >= active.version: tombstone wins (prevents resurrection).
 *    - If versions are identical: tombstone wins.
 * 2. Active Interaction Priority:
 *    If local element is currently being actively edited/resized in localAppState,
 *    local element is retained to prevent cursor interruption.
 * 3. Safe Disjoint Merge:
 *    If local changed spatial properties only, and remote changed styling properties only
 *    (or vice versa), both changes are merged into a unified element with an incremented version.
 * 4. Deterministic LWW Fallback:
 *    If conflicting edits touch the same property set (e.g. both modified x/y or both modified strokeColor):
 *    - The element with the higher version wins.
 *    - If versions match, the element with the lowest versionNonce wins (matching Excalidraw's tie-break rule).
 */
export function reconcileElementPair(
  local: ExcalidrawElement,
  remote: ExcalidrawElement,
  localAppState?: AppState | null,
  base?: ExcalidrawElement | null
): ExcalidrawElement {
  // 1. Tombstone Dominance & Resurrection Prevention
  if (local.isDeleted || remote.isDeleted) {
    if (local.isDeleted && !remote.isDeleted) {
      if (local.version >= remote.version) {
        return local;
      }
      return remote;
    }
    if (remote.isDeleted && !local.isDeleted) {
      if (remote.version >= local.version) {
        return remote;
      }
      return local;
    }
    // Both deleted: pick higher version, or lowest versionNonce
    if (local.version !== remote.version) {
      return local.version > remote.version ? local : remote;
    }
    return local.versionNonce <= remote.versionNonce ? local : remote;
  }

  // 2. Active Interaction Protection
  if (
    localAppState &&
    (local.id === localAppState.editingTextElement?.id ||
      local.id === localAppState.resizingElement?.id)
  ) {
    return local;
  }

  // 3. Disjoint Property Set Merging (Movement vs Styling)
  // When base is provided, compare changes relative to base.
  // When base is not provided, compare local vs remote directly.
  const reference = (base ?? local) as unknown as Record<string, unknown>;
  const localRec = local as unknown as Record<string, unknown>;
  const remoteRec = remote as unknown as Record<string, unknown>;

  const localChangedSpatial = hasPropertyDiff(localRec, reference, SPATIAL_PROPERTIES);
  const localChangedStyle = hasPropertyDiff(localRec, reference, STYLE_PROPERTIES);
  const localChangedText = hasPropertyDiff(localRec, reference, TEXT_PROPERTIES);

  const remoteChangedSpatial = hasPropertyDiff(remoteRec, reference, SPATIAL_PROPERTIES);
  const remoteChangedStyle = hasPropertyDiff(remoteRec, reference, STYLE_PROPERTIES);
  const remoteChangedText = hasPropertyDiff(remoteRec, reference, TEXT_PROPERTIES);

  // Case A: Local changed spatial, Remote changed style (and neither collided on the other)
  if (
    localChangedSpatial &&
    !localChangedStyle &&
    !remoteChangedSpatial &&
    remoteChangedStyle &&
    !localChangedText &&
    !remoteChangedText
  ) {
    return {
      ...remote,
      // Apply local spatial properties
      x: local.x,
      y: local.y,
      width: local.width,
      height: local.height,
      angle: local.angle,
      // Increment version deterministically above both
      version: Math.max(local.version, remote.version) + 1,
      versionNonce: Math.min(local.versionNonce, remote.versionNonce) - 1,
      updated: Math.max(local.updated ?? 0, remote.updated ?? 0),
    };
  }

  // Case B: Local changed style, Remote changed spatial
  if (
    localChangedStyle &&
    !localChangedSpatial &&
    !remoteChangedStyle &&
    remoteChangedSpatial &&
    !localChangedText &&
    !remoteChangedText
  ) {
    return {
      ...local,
      // Apply remote spatial properties
      x: remote.x,
      y: remote.y,
      width: remote.width,
      height: remote.height,
      angle: remote.angle,
      // Increment version deterministically above both
      version: Math.max(local.version, remote.version) + 1,
      versionNonce: Math.min(local.versionNonce, remote.versionNonce) - 1,
      updated: Math.max(local.updated ?? 0, remote.updated ?? 0),
    };
  }

  // Case C: Local changed spatial, Remote changed text (for text elements)
  if (
    localChangedSpatial &&
    !localChangedText &&
    !remoteChangedSpatial &&
    remoteChangedText
  ) {
    return {
      ...remote,
      x: local.x,
      y: local.y,
      width: local.width,
      height: local.height,
      angle: local.angle,
      version: Math.max(local.version, remote.version) + 1,
      versionNonce: Math.min(local.versionNonce, remote.versionNonce) - 1,
      updated: Math.max(local.updated ?? 0, remote.updated ?? 0),
    };
  }

  // 4. Deterministic LWW Fallback
  if (local.version !== remote.version) {
    return local.version > remote.version ? local : remote;
  }

  // When versions are identical, lower versionNonce wins (Excalidraw standard)
  return local.versionNonce <= remote.versionNonce ? local : remote;
}

/**
 * Reconciles the full whiteboard scene between local canvas and remote Liveblocks storage.
 *
 * Guarantees:
 * 1. Concurrent Element Creation:
 *    Elements created independently by distinct users are preserved in the merged scene.
 * 2. Concurrent Edits on Same Element:
 *    Reconciles disjoint properties (spatial vs styling) or applies deterministic LWW.
 * 3. Tombstone Deletions:
 *    Deleted elements remain deleted against stale or delayed updates.
 * 4. Idempotence:
 *    Replaying updates produces the exact same deterministic state.
 */
export function reconcileScene(
  localElements: readonly ExcalidrawElement[],
  remoteElements: readonly ExcalidrawElement[],
  localAppState?: AppState | null
): ExcalidrawElement[] {
  const localMap = new Map<string, ExcalidrawElement>();
  for (const el of localElements) {
    localMap.set(el.id, el);
  }

  const remoteMap = new Map<string, ExcalidrawElement>();
  for (const el of remoteElements) {
    remoteMap.set(el.id, el);
  }

  const mergedElements: ExcalidrawElement[] = [];
  const processedIds = new Set<string>();

  // Process remote elements
  for (const remote of remoteElements) {
    processedIds.add(remote.id);
    const local = localMap.get(remote.id);

    if (!local) {
      // Element only exists remotely -> preserve
      mergedElements.push(remote);
    } else {
      // Element exists in both -> reconcile pair
      const reconciled = reconcileElementPair(local, remote, localAppState);
      mergedElements.push(reconciled);
    }
  }

  // Process local elements not in remote (concurrent creations or local additions)
  for (const local of localElements) {
    if (!processedIds.has(local.id)) {
      processedIds.add(local.id);
      mergedElements.push(local);
    }
  }

  // Stable deterministic ordering: preserve fractional index order when available
  return mergedElements.sort((a, b) => {
    const idxA = (a as unknown as { index?: string }).index;
    const idxB = (b as unknown as { index?: string }).index;
    if (idxA && idxB && idxA !== idxB) {
      return idxA < idxB ? -1 : 1;
    }
    return 0;
  });
}

/**
 * Thrown when Liveblocks room storage is null, undefined, or disconnected
 * during an active mutation or restore attempt.
 */
export class StorageUnavailableError extends Error {
  constructor(message = "Liveblocks storage is unavailable or not yet loaded") {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

/**
 * Applies a restored scene snapshot to a Liveblocks LiveMap elements storage container.
 * Displaces elements not present in the restored scene by tombstoning them with an incremented version.
 * Restored elements are sanitized and written to storage.
 */
export function applyRestoredElementsToStorageMap<T = unknown>(
  elementsMap: {
    entries: () => Iterable<[string, T]>;
    set: (key: string, value: T) => void;
  } | null | undefined,
  restoredElements: readonly ExcalidrawElement[]
): void {
  if (!elementsMap) {
    throw new StorageUnavailableError(
      "Liveblocks storage is not available to propagate restored scene to connected peers"
    );
  }

  const restoredIds = new Set(restoredElements.map((e) => e.id));

  // Displace elements not in the restored scene by marking them deleted
  for (const [key, val] of elementsMap.entries()) {
    if (!restoredIds.has(key)) {
      const elem = val as ExcalidrawElement;
      elementsMap.set(key, {
        ...elem,
        isDeleted: true,
        version: (elem.version ?? 0) + 1,
      } as unknown as T);
    }
  }

  // Add/overwrite all elements from restored scene with sanitized data
  for (const el of restoredElements) {
    const sanitized = sanitizeWhiteboardElement(el) as unknown as T;
    elementsMap.set(el.id, sanitized);
  }
}

/**
 * Updates mutated elements in a Liveblocks LiveMap elements storage container.
 */
export function applyMutatedElementsToStorageMap<T = unknown>(
  elementsMap: {
    set: (key: string, value: T) => void;
  } | null | undefined,
  elementsToSync: readonly ExcalidrawElement[]
): void {
  if (!elementsMap) {
    throw new StorageUnavailableError(
      "Liveblocks storage is not available for real-time element mutation"
    );
  }

  for (const el of elementsToSync) {
    const sanitized = sanitizeWhiteboardElement(el) as unknown as T;
    elementsMap.set(el.id, sanitized);
  }
}

/**
 * Updates DOM data attributes on the whiteboard canvas container for read-only test observability.
 * Provides element count, active IDs, and deterministic element summaries without exposing internal APIs on window.
 */
export function updateWhiteboardDomAttributes(
  container: HTMLElement | null,
  elements: readonly ExcalidrawElement[]
): void {
  if (!container) return;
  const active = elements.filter((el) => !el.isDeleted);
  container.setAttribute("data-active-count", String(active.length));
  container.setAttribute(
    "data-active-element-ids",
    active.map((el) => el.id).join(",")
  );
  container.setAttribute(
    "data-active-elements",
    JSON.stringify(
      active.map((el) => ({
        id: el.id,
        type: el.type,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
      }))
    )
  );
  container.setAttribute(
    "data-scene-signature",
    `${active.length}:${active.map((el) => `${el.id}_${el.type}_${Math.round(el.x)}_${Math.round(el.y)}`).join(";")}`
  );
}
