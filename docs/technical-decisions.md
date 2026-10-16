# SyncSpace — Architecture Decision Records (ADRs)

## Overview

This document formalizes the pivotal architectural and technological choices made for SyncSpace. Each record details the problem context, selected approach, evaluated alternatives, pros and cons, and technical justification backed by official documentation.

---

## ADR 1: Document Collaboration Architecture

### Context
SyncSpace requires enterprise-grade concurrent rich-text document editing. Multiple users must be able to edit paragraphs, headings, tables, and lists simultaneously with live cursor tracking, conflict-free convergence, threaded comments, and inline mentions.

### Decision
Adopt **Tiptap** with the official **`@liveblocks/react-tiptap`** integration backed by **Yjs CRDTs**.

### Alternatives Considered
1. **Custom WebSockets + ShareDB / Operational Transformation (OT)**:
   - High complexity in maintaining an OT server; OT handles rich-text formatting and complex tree mutations with significant edge-case brittleness compared to modern CRDTs.
2. **Liveblocks LiveText mode (`collaborationMode: "liveblocks"`)**:
   - LiveText is optimized for pure text inputs, whereas complex rich-text trees with tables, nested blocks, and marks are natively supported by the standard Yjs ProseMirror bindings (`y-prosemirror`) inside `@liveblocks/react-tiptap`.
3. **Self-hosted Yjs WebSocket Server (`y-websocket`)**:
   - Requires hosting, clustering, maintaining, and scaling independent stateful Node.js WebSocket servers, plus custom integration for presence and comments.

### Advantages
- **Single Real-time Provider**: Eliminates dual-provider race conditions; Liveblocks provides both WebSocket infrastructure and Yjs persistence.
- **Native Comments & Mentions**: `@liveblocks/react-tiptap` connects directly to Liveblocks Threads and Comment Composers without custom indexing.
- **Battle-tested CRDT**: Yjs guarantees deterministic convergence across concurrent edits.
- **Local Undo Isolation**: Yjs undo manager isolates local user transactions so hitting `Ctrl+Z` does not revert a collaborator's recent edits.

### Disadvantages & Trade-offs
- Requires Liveblocks subscription credentials for production rooms.
- Tiptap's built-in history extension must be explicitly disabled (`StarterKit.configure({ history: false })`) to prevent state corruption.

### Assumptions
- Official `@liveblocks/react-tiptap` package maintains active compatibility with Tiptap v2 and Yjs v13+.

---

## ADR 2: Whiteboard Collaboration Architecture

### Context
SyncSpace provides collaborative whiteboards and architecture diagramming via Excalidraw. We must provide genuine real-time synchronization where concurrent edits, element movements, additions, and deletions converge deterministically across multiple participants without overwriting changes.

### Options Evaluated

#### Option A: Standalone `excalidraw-room` Collaboration Server
- **Description**: Self-host the official Socket.IO-based `excalidraw-room` microservice.
- **Evaluation**:
  - *API Support & Maintenance*: The repository is minimally maintained and primarily designed for excalidraw.com's public anonymous model.
  - *Authentication*: Lacks built-in authentication, database sessions, and workspace tenancy. It relies on room keys passed in URL hashes.
  - *Concurrency*: Broadcasts encrypted scene deltas; prone to race conditions if concurrent users touch overlapping sets of elements.
  - *Operational Burden*: Requires deploying, monitoring, and scaling a secondary stateful Node.js Socket.IO cluster alongside Next.js.
  - *Verdict*: **Rejected**. Violates our constraint to prefer a modular monolith and avoid unauthenticated room IDs.

#### Option B: Application-Controlled Sync Layer via Liveblocks Storage (`LiveMap`) & `reconcileElements` (Chosen)
- **Description**: Integrate `@excalidraw/excalidraw` directly into Liveblocks room storage using `LiveMap<string, LiveObject<ExcalidrawElement>>` and Excalidraw's documented `reconcileElements` utility.
- **Evaluation**:
  - *API Support*: Excalidraw officially exposes `reconcileElements(localElements, remoteElements, appState)` specifically for third-party sync engines.
  - *Granular Concurrency*: Elements are stored individually by `id` in a `LiveMap`. User A moving Element 1 does not mutate Element 2 being edited by User B.
  - *Conflict Resolution*: Excalidraw's internal monotonic `version` and randomized `versionNonce` guarantee deterministic Last-Write-Wins convergence.
  - *Presence*: Liveblocks presence (`useMyPresence`, `useOthers`) maps directly to Excalidraw's `collaborators` API for live pointer tracking.
  - *Authorization*: Uses the exact same `/api/liveblocks-auth` server endpoint as documents, enforcing PostgreSQL workspace permissions.
  - *Operational Overhead*: Zero additional servers; fully consolidated into the modular monolith.
  - *Verdict*: **Accepted**.

### Naive Snapshot Broadcast Warning
Broadcasting full canvas snapshots on every `onChange` is strictly forbidden because it causes severe race conditions, resets version counters, and causes infinite update loops.

---

## ADR 3: Data Ownership & Single Source of Truth

### Context
Collaborative applications often suffer from dual sources of truth (e.g. database vs WebSocket cache) leading to lost updates or synchronization drift.

### Decision
Establish strict data partitioning:
1. **Relational Metadata & Auth**: **PostgreSQL** is the sole source of truth for users, workspaces, membership roles, projects, artifact metadata, permissions, and audit logs.
2. **Active Real-Time State**: **Liveblocks Room Storage** is the sole authoritative store for live Yjs document trees and Excalidraw element maps during active editing sessions.
3. **Historical Snapshots**: Point-in-time snapshots are periodically written to PostgreSQL `ArtifactVersion` (on room close, manual save, or scheduled interval).
4. **Binary Assets**: **S3-Compatible Object Storage** holds raw attachment binaries; metadata is stored in PostgreSQL `Attachment`.

---

## ADR 4: Application Architecture (Modular Monolith)

### Context
Determine the high-level application structure balancing development speed, operational simplicity, performance, and clear domain boundaries.

### Decision
Adopt a **Modular Monolith** using **Next.js App Router** with React Server Components, server actions, and domain-driven service modules (`@/services/*`).

### Advantages
- Zero microservice network latency or service mesh configuration.
- Unified TypeScript types shared end-to-end between Prisma, service layers, and React components.
- Single atomic CI/CD deployment pipeline.
- Clean directory-based feature isolation (`@/features/workspaces`, `@/features/documents`, `@/features/whiteboards`).

---

## ADR 5: Authentication & Session Strategy

### Context
Need a modern, secure, and type-safe authentication system supporting credential login, OAuth, session management, and deep integration with Prisma ORM 7 in the Next.js 15 App Router.

### Decision
Adopt **Better Auth** with its official **Prisma integration (Prisma ORM 7)** and `@prisma/adapter-pg`.

### Alternatives Considered
- **Auth.js (NextAuth v5)**: Replaced due to evolving beta APIs, configuration complexity in App Router, and community shift toward Better Auth's end-to-end typed client/server architecture.
- **Lucia Auth**: Officially deprecated in 2024.
- **Custom JWTs in Cookies**: High development burden to implement secure refresh token rotation, OAuth provider flows, password hashing, and CSRF protection from scratch.

### Advantages
- Official Prisma ORM 7 support with cleanly mapped models (`User`, `Session`, `Account`, `Verification`).
- Native Next.js 15 App Router integration via `toNextJsHandler(auth.handler)` and `@better-auth/react` client.
- Built-in secure password hashing, cryptographically random token generation, session cookies, and CSRF mitigation.
- Strict TypeScript inference between server auth configuration and client SDK.
- Single consolidated authentication library across the entire modular monolith.

---

## ADR 6: File Storage Strategy

### Context
Users upload images, diagrams, and attachments into documents and whiteboards. Storing files in PostgreSQL or the local file system is unscalable and insecure.

### Decision
Use **S3-Compatible Object Storage** (AWS S3, Cloudflare R2, or local MinIO) with **Direct Client Presigned URLs** (`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`).

### Advantages
- Zero bandwidth bottleneck on the Next.js server (clients upload and download directly to/from S3).
- Fine-grained security: buckets are completely private; access requires short-lived (60s) presigned URLs generated only after checking PostgreSQL artifact permissions.
- Local development runs against a local MinIO container with zero code differences.

---

## ADR 7: State Management & Data Fetching

### Context
The application needs efficient data fetching, caching, and state synchronization across complex UI layouts (sidebars, project trees, command palette, and modal dialogs).

### Decision
- **Server State**: Next.js Server Components for initial page loads + TanStack Query / SWR for client-side queries and mutations.
- **Real-Time Collaborative State**: Liveblocks React hooks (`useStorage`, `useMutation`, `useOthers`, `useMyPresence`, `useThreads`).
- **Local Ephemeral UI State**: React `useState`, `useReducer`, and Radix UI primitives.
- Avoid heavyweight global state libraries (Redux, MobX) which duplicate server and room storage states.

---

## ADR 8: Tiptap v3 + `@liveblocks/react-tiptap` v3 Package Alignment (Phase 5)

### Context
Phase 5 implements the collaborative rich-text document editor on React 19 and Next.js 15.5.28. We needed to align Liveblocks and Tiptap package versions to avoid peer-dependency conflicts, duplicate ProseMirror instances, or conflicting undo history stacks.

### Decision
- Standardize on **Liveblocks `3.24.3`** (`@liveblocks/client`, `@liveblocks/react`, `@liveblocks/react-ui`, `@liveblocks/react-tiptap`, `@liveblocks/node`), **Tiptap `3.32.0`** (`@tiptap/core`, `@tiptap/pm`, `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-placeholder`, `@tiptap/extension-table`, `@tiptap/extension-task-list`, `@tiptap/extension-task-item`, `@tiptap/suggestion`), and **`yjs@^13.6.29`**.
- Configure `StarterKit.configure({ undoRedo: false })` whenever `useLiveblocksExtension` is active, because Tiptap v3 consolidates `Link`, `Underline`, and `UndoRedo` into `StarterKit`, and `@liveblocks/react-tiptap` provides its own collaborative Yjs `yUndoPlugin`.
- Enforce safe link protocols (`http:`, `https:`, `mailto:`) via `isSafeLinkUrl` in both Tiptap's `Link` extension (`isAllowedUri`) and the toolbar link popover.

---

## ADR 9: Whiteboard Collaborative Synchronization & Tombstone Reconciliation Engine (Phase 6 & 6B)

### Context
Phase 6 delivers collaborative diagramming via `@excalidraw/excalidraw@0.18.1` and Liveblocks v3 on Next.js 15.5.28 and React 19. A naive synchronization approach (such as broadcasting full scene JSON arrays on `onChange`) causes devastating race conditions, infinite feedback loops, and element resurrection bugs. We require a rigorous, application-controlled synchronization architecture that provides deterministic convergence, conflict-free concurrent editing, and resilient deletion semantics.

### Decision
Implement an authoritative two-way synchronization adapter (`useWhiteboardSync`) and reconciliation engine (`reconciliation.ts`) combining **Liveblocks Room Storage (`LiveMap<string, JsonObject>`)**, **property-aware 3-way element reconciliation**, and **tombstoned element lifecycle management**.

#### 1. Data Representation & Propagation
- **Liveblocks Room Storage**: The root contains a `LiveMap<string, JsonObject>` named `elements`, where each key is `element.id`.
- **Granular Updates**: When an element is created, moved, resized, or restyled, only that specific element is pushed to the `LiveMap` via `liveElements.set(element.id, sanitizedElement)`.
- **Sanitization**: Local client transient state (such as `isSelected`) is stripped via `sanitizeWhiteboardElement` before publishing to storage.
- **High-Frequency Throttling**: Interactive drag and freehand draw gestures are batched and throttled through Liveblocks mutations, streaming coalesced updates to remote peers without degrading 60fps local rendering.

#### 2. Conflict-Resolution Policy (Proven by Unit & E2E Tests)
- **Concurrent Element Creation**:
  - Independent creations on distinct elements (User A creates Element 1 while User B creates Element 2) mutate different keys in `LiveMap`.
  - Both elements survive regardless of arrival order (`[A, B]` or `[B, A]`), producing identical converged scenes.
- **Concurrent Edits on the Same Element**:
  - Properties are partitioned into independent categories:
    - *Spatial*: `x`, `y`, `width`, `height`, `angle`.
    - *Styling*: `strokeColor`, `backgroundColor`, `fillStyle`, `strokeWidth`, `strokeStyle`, `roughness`, `opacity`, `roundness`.
    - *Text*: `text`, `fontSize`, `fontFamily`, `textAlign`, `verticalAlign`, `lineHeight`.
  - **Disjoint Safe Merging**: If User A modifies spatial properties (moves the element) and User B modifies styling properties (changes stroke/background color), the reconciliation engine (`reconcileElementPair`) safely merges both updates into a unified element:
    $$\text{merged} = \{ \dots\text{styleUpdate}, \text{x}: \text{spatialUpdate.x}, \text{y}: \text{spatialUpdate.y}, \text{version}: \max(v_A, v_B) + 1 \}$$
  - **Conflicting Same-Property Edits**: If both peers modify the same property (e.g. both peers drag the element to different positions, or both change stroke color):
    1. The update with the strictly higher `version` wins.
    2. If versions are identical, the tie is broken deterministically by selecting the update with the **lowest `versionNonce`** (matching Excalidraw's canonical tie-breaking rule: `local.version === remote.version && local.versionNonce < remote.versionNonce`).
  - **Active Interaction Protection**: If a local user is actively interacting with an element (e.g. actively resizing or text-editing, verified via `localAppState.resizingElement` or `localAppState.editingTextElement`), the local edit is preserved during the gesture to prevent jarring layout jumps.

#### 3. Deletion Semantics & Tombstone Lifecycle
- **Tombstone Strategy**: Deletion is modeled explicitly as a tombstone: `isDeleted: true` with `version: element.version + 1` and a new `versionNonce`.
- **Resurrection Prevention**:
  - If an element is tombstoned, any delayed, out-of-order, or in-flight active update with $\text{version} \le \text{tombstone.version}$ is discarded.
  - If an active update and a deletion have the exact same version, the deletion wins.
  - An element can only be un-deleted if an explicit user restoration action is performed with a strictly higher version than the tombstone.
- **Canvas Filtering**: Excalidraw's canvas renders only non-deleted elements (`isDeleted !== true`).
- **Snapshot Hygiene**: Background snapshot persistence filters out tombstones before saving to PostgreSQL `ArtifactVersion` to prevent storage bloat.

#### 4. Idempotence & Out-of-Order Updates
- **Replay Idempotence**: Replaying an already applied update produces the exact same element state without version inflation.
- **Out-of-Order Delivery**: Late-arriving older packets ($v_{\text{incoming}} < v_{\text{current}}$) are discarded without mutating current scene state or affecting unrelated elements.
- **Unrelated Element Safety**: Mutating an element never modifies or drops other existing elements in the scene.

#### 5. Reconnection and Late-Joining Behavior
- **Collaborator Disconnection**: When a peer disconnects (or navigates away), Liveblocks presence drops the collaborator avatar from remote headers.
- **Mid-Flight Offline Edits**: Edits made by remaining peers while a collaborator is away persist in Liveblocks Cloud storage and PostgreSQL snapshots.
- **Reconnection & Convergence**: When the disconnected peer returns, `reconcileScene` updates stale local elements to the newer remote versions, incorporates newly created remote elements, and preserves any local offline creations.
- **Late-Joining & Page Refresh**: A collaborator opening the board after peers have made changes (or after a full browser refresh) hydrates the complete, converged scene from storage.

#### 6. Dual-Tier Persistence
- **Tier 1 (Authoritative Real-Time)**: Liveblocks Cloud room storage persists the active `LiveMap` during editing sessions. Reconnecting users or users opening the board receive the full, converged element map directly from Liveblocks Cloud.
- **Tier 2 (PostgreSQL Snapshots)**: A debounced snapshot saver (1500ms after last local edit) serializes the non-deleted scene to PostgreSQL `ArtifactVersion` (`snapshotData: { elements }`). This provides historical snapshots, backup durability, and exportable offline state.

#### 7. Role-Based Access Control
- Whiteboard rooms enforce explicit artifact-level access via `AuthorizationService.requireArtifactRoomAccess` and `/api/liveblocks-auth` with `expectedType: "WHITEBOARD"`.
- `VIEWER` users receive `READ_ACCESS` (`["*:read"]`) token scopes, `viewModeEnabled={true}` in `<Excalidraw />`, and `initialStorage` mutation bypass. All outgoing mutations are disabled, and direct API write attempts are rejected with `403 Forbidden`.
- Unauthorized users (non-workspace members) are completely denied token issuance (403) and receive `Not Found` UI fallbacks.

#### 8. Remaining Limitations
- **Atomic Freehand Strokes**: Freehand drawing (`freedraw`) and polygon points are treated as atomic point arrays; concurrent edits to the same freehand stroke do not interleave individual points.
- **Local Undo/Redo**: Excalidraw's undo/redo history is local to the client. Undoing an action produces a new forward mutation with an incremented version rather than rewinding shared cloud state.
- **Liveblocks Connection Limits**: Cloud room concurrency is constrained by the provisioned Liveblocks plan tier.

---

### ADR 10: Workspace Invitations, Token Hashing, and Granular Artifact Sharing Precedence

#### Context
Collaborative teams require seamless onboarding via workspace invitations, flexible role-based access control, and fine-grained per-artifact permission overrides on documents and whiteboards. Storing raw bearer tokens at rest introduces severe exposure risks if the database is backed up or compromised. Unrestricted invitation acceptance could allow rogue users to hijack invited slots or elevate themselves to unauthorized roles.

#### Decision

1. **Cryptographic Token Hashing at Rest**:
   - Invitation links contain an unguessable 256-bit bearer token (`crypto.randomBytes(32).toString('hex')`).
   - The server hashes the token using SHA-256 (`crypto.createHash('sha256').update(rawToken).digest('hex')`) and only persists the hexadecimal digest in the `Invitation.token` column.
   - Raw bearer tokens are never stored, logged, or returned in unrestricted listing endpoints.
   - Lookups compute the SHA-256 digest of the client-supplied token and match on the unique index `invitation_token_key`.

2. **Invitation Expiration & Single-Use Enforcement**:
   - Invitations expire automatically after 7 days (`expiresAt < new Date()`).
   - Acceptance transitions status from `PENDING` to `ACCEPTED` inside an isolated database transaction (`prisma.$transaction`).
   - Duplicate acceptance attempts are rejected (`ALREADY_ACCEPTED`).

3. **Strict Email Matching**:
   - To prevent token theft (e.g., forwarded or intercepted links), the server normalizes both emails (`.trim().toLowerCase()`) and requires that the authenticated session user's email strictly matches the invitation's recipient email.
   - If an account mismatch is detected, the API rejects acceptance with `403 Forbidden` (`ACCOUNT_MISMATCH`), and the UI offers a prompt to switch accounts or register with the invited address.

4. **Role Boundaries & Owner Protection**:
   - **No Owner Invitations**: Workspace ownership can never be granted via invitations.
   - **Admin Hierarchy**: Admins can only invite `EDITOR` or `VIEWER` roles. Only an `OWNER` can invite an `ADMIN`.
   - **Last Owner Protection**: The last remaining `OWNER` of a workspace cannot be demoted or removed (`Cannot demote/remove the only workspace owner`).

5. **Granular Artifact Permission Overrides**:
   - `ArtifactPermission` rows allow setting per-user overrides: `EDITOR`, `VIEWER`, or `NONE` (revoke).
   - `NONE` completely revokes access to the artifact, denying view, edit, and Liveblocks room token issuance with `403 Forbidden`, even if the user is an `EDITOR`, `ADMIN`, or `OWNER` in the parent workspace.
   - `VIEWER` restricts the user to read-only access, enforcing `canWrite: false`, read-only UI banners, and Liveblocks `READ_ACCESS` (`["*:read"]`).
   - `INHERIT` deletes the explicit override, restoring default workspace membership permissions.

6. **Member Removal & Revocation Policy**:
   - Removing a member deletes the `WorkspaceMember` row and cleans up all explicit `ArtifactPermission` overrides for that workspace inside an atomic transaction.
   - Any subsequent HTTP request by the user fails immediately with `404 Not Found` (IDOR defense) or `403 Forbidden`.
   - Subsequent `/api/liveblocks-auth` room token requests are denied. Existing short-lived Liveblocks tokens (5–15 min) expire naturally, and future WebSocket reconnections are blocked.

---

### ADR 11: Artifact Comments, Threaded Discussions, and Moderation Architecture (Phase 8A)

#### Context
Collaborative documents and whiteboards require contextual discussions, review threads, and emoji reactions. Commenting systems must maintain relational integrity, support multi-level authorization (authors vs workspace moderators vs viewers), prevent IDOR vulnerabilities across workspaces, and guarantee that deleting root comments cascades predictably.

#### Decision

1. **Normalized Relational Data Architecture**:
   - Model discussions with three normalized PostgreSQL tables: `CommentThread`, `Comment`, and `CommentReaction`.
   - `CommentThread` captures thread-level metadata (`isResolved`, `resolvedById`, `resolvedAt`, `anchorType`, `anchorData`).
   - `Comment` stores the root comment and all chronological replies (`threadId`, `authorId`, `content`, `isEdited`, `editedAt`).
   - `CommentReaction` stores individual user emoji reactions (`commentId`, `userId`, `emoji`).

2. **Atomic Lifecycle & Cascading Rules**:
   - Deleting the root comment of a thread automatically deletes the entire `CommentThread` and all associated replies and reactions via PostgreSQL `onDelete: Cascade`.
   - Deleting an individual reply removes only that reply without affecting the thread or sibling replies.
   - Resolving a thread marks `isResolved: true` and logs the resolving user and timestamp. Resolving or reopening can be triggered by the thread author, artifact editors, or workspace admins/owners.

3. **Role-Based Authorization & IDOR Defense**:
   - Every comment API endpoint verifies workspace tenancy and artifact access via `AuthorizationService.requireArtifactAccess(userId, artifactId, "VIEW")`.
   - If the user is not a member of the workspace, the server responds with `404 Not Found` to prevent information disclosure (IDOR isolation).
   - If the user has an explicit `NONE` override on the artifact, the server returns `403 Forbidden`.
   - Users with `VIEWER` permissions can view and post comments/reactions unless explicitly blocked by a `NONE` override.
   - Comment edits are strictly restricted to the comment author (`authorId`).
   - Comment deletion is restricted to either the comment author or workspace moderators (`OWNER` / `ADMIN`).

4. **Concurrency-Safe Reactions & Idempotence**:
   - A composite unique constraint `@@unique([commentId, userId, emoji])` at the database level guarantees data integrity.
   - The reaction service implements safe recovery: concurrent add/remove/toggle operations handle `P2002` uniqueness conflicts gracefully without throwing unhandled 500 errors.
   - Optional `intent: "toggle" | "add" | "remove"` ensures predictable outcomes under concurrent network requests.

5. **Bounded Cursor-Based Pagination**:
   - Discussion threads are paginated via deterministic cursor `take: limit + 1`, `skip: cursor ? 1 : 0`, ordered by `[{ createdAt: "desc" }, { id: "desc" }]`.
   - Thread pagination defaults to 20 items (max 50).
   - Thread replies are paginated separately from the root comment via `listReplies`, preserving the root comment bound to the thread header while streaming remaining replies in chronological order (`[{ createdAt: "asc" }, { id: "asc" }]`).

6. **Immutable State Transition Audit History (`CommentThreadEvent`)**:
   - Every `RESOLVED` and `REOPENED` transition is recorded atomically within a database transaction in `CommentThreadEvent`.
   - Transition events capture `threadId`, `workspaceId`, `artifactId`, `userId`, `type`, and `createdAt`.
   - Audit history is append-only: reopening a resolved thread appends a `REOPENED` event and preserves all historical `RESOLVED` events.
   - Transition mutations are idempotent: redundant resolve/reopen requests do not duplicate event records.

7. **Strict Validation, DTO Privacy & Route Canonicalization**:
   - Strict Zod schemas enforce length limits (max 5,000 characters per comment), valid emoji strings (max 16 chars), and anchor data payload bounds (max 10KB).
   - Anchor types (`GENERAL`, `TEXT_SELECTION`, `CANVAS_ELEMENT`, `CANVAS_COORDINATE`) are validated against schema definitions.
   - All outgoing DTOs strictly omit user email addresses to prevent accidental PII leakage across workspace members.
   - API routes are canonicalized under `/api/artifacts/[artifactId]/comments/threads/[threadId]/...` to eliminate duplicate conflicting routes.

8. **Universal Artifact Discussion Panel**:
   - A unified responsive discussion panel (`ArtifactDiscussionPanel`) is integrated into both the document editor (`/app/documents/[documentId]`) and the whiteboard editor (`/app/whiteboards/[boardId]`).
   - Features cursor progression ("Load more discussions" and "Load more replies"), resolution audit history drawer, filtering by Open, Resolved, and All threads, inline reply composers, emoji reaction pickers, and live counts.

9. **Artifact Version History and Safe Restoration (Phase 9A)**:
   - **Decoupled Autosave vs Historical Snapshots**: Continuous collaborative updates persist to `Artifact.currentSnapshot` with incrementing `Artifact.currentRevision`. Checkpoints are explicitly captured into immutable `ArtifactVersion` rows manually or on periodic intervals without mutating or resetting historical records.
   - **Dual Modality Support**: Full validation and preview support for both `DOCUMENT` (Tiptap ProseMirror JSON schema) and `WHITEBOARD` (Excalidraw scene elements + appState/files) under a 5MB payload limit.
   - **Conflict-Safe Restoration**: `POST /api/artifacts/[artifactId]/versions/[versionId]/restore` enforces optimistic concurrency via `expectedRevision`. If the artifact revision changed while inspecting history, a 409 Conflict is returned, prompting the user with a Refresh History action.
   - **Pre-Restore Safety & Displaced State Preservation**: Before replacing active state, if `currentSnapshot` has changes not captured in the latest version, a `RESTORE_RECOVERY` checkpoint is atomically created so no edits are ever lost.
   - **Multiplayer Propagation**: Restoring immediately dispatches content updates into the collaborative live session: `editor.commands.setContent(snapshotData)` updates Yjs/Liveblocks for documents, and `restoreScene` dispatches Liveblocks storage mutations for Excalidraw whiteboards.
   - **Read-Only Snapshot Previews**: Users can inspect any historical version with full metadata in a dedicated modal without mutating the live editor canvas or triggering state updates.
