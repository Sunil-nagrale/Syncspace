# SyncSpace — Implementation Roadmap & Milestones

## Overview & Execution Strategy

The implementation of SyncSpace is structured into nine sequential, dependency-aware phases (Phase A through Phase I). Each phase delivers verified, functional capabilities without placeholder mock implementations.

```mermaid
graph LR
    PhaseA["Phase A: Foundation & Shell"] --> PhaseB["Phase B: Auth & DB"]
    PhaseB --> PhaseC["Phase C: RBAC & Room Auth"]
    PhaseC --> PhaseD["Phase D: Tiptap Docs"]
    PhaseC --> PhaseE["Phase E: Excalidraw Canvas"]
    PhaseD --> PhaseF["Phase F: Comments & Sharing"]
    PhaseE --> PhaseF
    PhaseF --> PhaseG["Phase G: Versioning & Search"]
    PhaseG --> PhaseH["Phase H: Security & Reliability"]
    PhaseH --> PhaseI["Phase I: Polish & Demo"]
```

---

## Phase A: Foundation & UI Shell

- **Prerequisites**: Node.js v24.x environment, empty workspace at `d:\syncspace`.
- **Deliverables**:
  - Initialized Next.js App Router application with strict TypeScript, Tailwind CSS, and shadcn/ui.
  - Design token system (colors, typography, radii, dark/light theme provider).
  - Main responsive application shell (collapsible sidebar, breadcrumb bar, user menu, navigation links).
  - Vitest and Playwright configuration.
- **Expected Files / Modules**:
  - `package.json`, `tsconfig.json`, `tailwind.config.ts`, `components.json`
  - `app/layout.tsx`, `app/globals.css`, `components/theme-provider.tsx`
  - `components/layout/sidebar.tsx`, `components/layout/header.tsx`, `components/layout/breadcrumbs.tsx`
  - `vitest.config.ts`, `playwright.config.ts`
- **Acceptance Criteria**:
  - Application builds clean with `npm run build` with zero TypeScript or ESLint errors.
  - Dark mode and light mode toggle smoothly without flicker.
  - Sidebar expands and collapses with persisted state.
- **Automated Tests**:
  - Unit tests verifying theme switching and layout rendering.
- **External Dependencies**: None.
- **Definition of Done**: Base shell loads, responsive on mobile and desktop, ready for routing and database bindings.

---

## Phase B: Authentication, Database & Workspace Management

- **Prerequisites**: Phase A complete, local PostgreSQL connection string.
- **Deliverables**:
  - Prisma schema with `User`, `Account`, `Session`, `Verification`, `Workspace`, `WorkspaceMember`, and `Project`.
  - Database schema generated and migration ready.
  - Better Auth setup (email/password credentials, session handling, Prisma adapter).
  - Onboarding wizard and workspace creation flow.
  - Workspace switcher and project CRUD operations.
- **Expected Files / Modules**:
  - `prisma/schema.prisma`, `prisma.config.ts`, `src/lib/prisma.ts`
  - `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/app/api/auth/[...all]/route.ts`
  - `src/services/workspace.service.ts`, `src/services/project.service.ts`, `src/services/authorization.service.ts`
  - `src/app/login/page.tsx`, `src/app/register/page.tsx`
  - `app/(app)/[workspaceSlug]/dashboard/page.tsx`, `app/(app)/[workspaceSlug]/projects/page.tsx`
- **Acceptance Criteria**:
  - Users can register, log in, create a workspace, and switch between workspaces.
  - All workspace queries are scoped to the active tenant.
  - Seed script seeds synthetic test users and workspaces.
- **Automated Tests**:
  - Vitest unit tests for user hashing and workspace slug generator.
  - Integration tests for `WorkspaceService` and `ProjectService` CRUD.
- **External Dependencies**: Local PostgreSQL instance.
- **Definition of Done**: Multi-workspace tenancy functional with authenticated sessions and project management.

---

## Phase C: Authorization, Invitations & Collaboration-Room Access (Implemented in Phase 4B & Phase 5)

- **Prerequisites**: Phase B complete.
- **Deliverables**:
  - Role-based access control (RBAC) helpers (`AuthorizationService.requireWorkspaceAccess`, `requireProjectAccess`, `requireArtifactAccess`, `requireArtifactRoomAccess`).
  - Per-artifact permission overrides (`ArtifactPermission` with `EDITOR`, `VIEWER`, `NONE` precedence over workspace roles).
  - Liveblocks server-side authorization endpoint (`POST /api/liveblocks-auth` and `LiveblocksAuthService`).
- **Implemented Files / Modules**:
  - `src/services/authorization.service.ts`, `src/services/liveblocks-auth.service.ts`, `src/services/artifact.service.ts`
  - `src/app/api/liveblocks-auth/route.ts`, `src/app/api/artifacts/[artifactId]/permissions/route.ts`
- **Acceptance Criteria**:
  - Supplying an unauthorized or revoked room ID to `/api/liveblocks-auth` returns HTTP 403.
  - Effective `OWNER`/`ADMIN`/`EDITOR` role receives `["*:write"]`; effective `VIEWER` role receives `["*:read"]`.
- **Automated Tests**:
  - `tests/unit/authorization.test.ts` and `tests/integration/liveblocks-auth.test.ts`.
- **External Dependencies**: Liveblocks secret key (`LIVEBLOCKS_SECRET_KEY`).

---

## Phase D: Tiptap Documents with Genuine Real-Time Editing (Implemented in Phase 5)

- **Prerequisites**: Phase C complete.
- **Deliverables**:
  - Rich-text document editor powered by Tiptap v3 (`@tiptap/react@3.32.0`), `yjs@13.6.29`, and `@liveblocks/react-tiptap@3.24.3`.
  - Slash command menu (`/` trigger), formatting toolbar, safe link popover (`http:`, `https:`, `mailto:`), resizable tables, task lists, and dynamic Document Outline.
  - Real-time multiplayer synchronization via Yjs CRDTs (`StarterKit.configure({ undoRedo: false })`).
  - Live collaborator presence avatars and cursor carets with assigned user colors.
  - Read-only enforcement (`editable: false`) for `VIEWER` roles and constrained artifact overrides.
  - Automatic debounced snapshot persistence to PostgreSQL `ArtifactVersion`.
- **Implemented Files / Modules**:
  - `src/components/documents/collaborative-editor.tsx`
  - `src/components/documents/editor-extensions.ts`
  - `src/components/documents/documents-directory.tsx`
  - `src/app/app/documents/[documentId]/page.tsx`, `src/app/app/documents/page.tsx`
- **Acceptance Criteria**:
  - Rich-text editing, title updates, slash commands, tables, outline, and snapshots persist in PostgreSQL.
  - Viewer role cannot edit or trigger slash commands.
  - External Liveblocks cloud multi-user WebSocket sync activates automatically when a non-placeholder `LIVEBLOCKS_SECRET_KEY` (`sk_...`) is configured in `.env`.
- **Phase 5B Verified Status (Liveblocks Cloud Real-Time Collaboration)**:
  - **Live WebSocket Synchronization**: User A and User B concurrently connect to the Liveblocks room via WebSocket without page reload. User A types -> User B observes updates live in real-time. User B replies -> User A observes updates live.
  - **Conflict-Free Concurrent Edits**: Rapid interleaved updates from multiple users merge deterministically via Yjs CRDTs without loss or overwrites.
  - **Live Presence & Indicators**: Online collaborator avatars display active peers in `[data-testid="collaborator-avatars"]` with deterministic user presence colors.
  - **Snapshot & Reload Persistence**: Document updates persist across full browser reloads and save to PostgreSQL `ArtifactVersion` via debounced snapshots.
  - **Strict Security & RBAC**: `VIEWER` members are enforced read-only in the live room (`contenteditable="false"`, disabled toolbar, API mutations blocked 403). Unauthorized users (outsiders not belonging to the workspace) are completely rejected from minting Liveblocks tokens (`/api/liveblocks-auth` 403) and denied document access.
  - **Secret Key Hygiene**: `LIVEBLOCKS_SECRET_KEY` is loaded strictly on the server, excluded from Git via `.gitignore`, never exposed to the client bundle or browser, and never logged.
- **Automated Verification**:
  - `npm.cmd run test:integration` (2 files, 5 passed)
  - `npm.cmd run test` (6 files, 33 passed)
  - `npm.cmd run lint` (0 warnings, 0 errors)
  - `npx.cmd tsc --noEmit` (0 errors)
  - `npm.cmd run build` (18/18 routes compiled)
  - `npx.cmd playwright test` (11/11 passed across UI shell, PostgreSQL auth/workspaces, and collaborative documents)


---

## Phase E: Excalidraw Integration & Genuine Synchronized Whiteboards

- **Prerequisites**: Phase C complete.
- **Deliverables**:
  - Collaborative whiteboard powered by `@excalidraw/excalidraw` and Liveblocks `LiveMap`.
  - Granular per-element synchronization using `reconcileElements`.
  - Collaborator presence and cursor synchronization via `collaborators` API.
  - Read-only view mode for `VIEWER` users.
  - PNG, SVG, and JSON scene export.
  - Whiteboard snapshot persistence to PostgreSQL `ArtifactVersion`.
- **Expected Files / Modules**:
  - `features/whiteboards/components/whiteboard-canvas.tsx`
  - `features/whiteboards/components/collaborative-excalidraw.tsx`
  - `features/whiteboards/hooks/use-whiteboard-sync.ts`
  - `features/whiteboards/utils/reconciliation.ts`
  - `app/(app)/[workspaceSlug]/boards/[artifactId]/page.tsx`
- **Acceptance Criteria**:
  - Shapes drawn on Browser 1 appear on Browser 2 in real time (<100ms).
  - Simultaneous movements of distinct shapes merge without rollbacks or conflicts.
  - Deleted shapes propagate tombstones correctly without resurrection.
  - Canvas exports to PNG and SVG cleanly.
- **Automated Tests**:
  - Unit tests for Excalidraw element diffing and reconciliation wrappers.
  - Playwright test simulating two users creating shapes simultaneously.
- **External Dependencies**: Liveblocks keys.
- **Definition of Done**: Multi-user whiteboard editing completely operational with genuine CRDT/reconciliation sync.
- **Phase 6 Verified Status (Excalidraw & Liveblocks Collaborative Whiteboards)**:
  - **Live WebSocket Element Synchronization**: Users concurrently connect to Liveblocks room storage (`LiveMap<string, ExcalidrawElement>`). User A draws shapes (rectangles) -> User B observes shapes live without page reload. User B connects arrows -> User A observes updates live.
  - **Granular LWW Reconciliation & Tombstones**: `reconcileElements` merges local canvas state with remote element updates without whole-canvas replacement. Deletions apply tombstone dominance (`isDeleted: true`, incremented version) preventing element resurrection.
  - **Feedback Loop Elimination**: Bidirectional synchronization prevents infinite loops via `isApplyingRemoteUpdateRef` suppression and element version tracking (`lastSyncedVersionsRef`).
  - **Ephemeral Presence & Collaborator Avatars**: Active remote peers are tracked via Liveblocks presence (`useMyPresence`, `useOthers`) and displayed as live collaborator badges with custom presence colors.
  - **Dual-Tier Persistence**: Active rooms persist in Liveblocks Cloud storage; debounced background saves (1500ms) persist non-deleted scene snapshots (`{ elements: ... }`) into PostgreSQL `ArtifactVersion` records.
  - **Role-Based Access Control & Security**: `VIEWER` users are enforced read-only (`viewModeEnabled={true}` in Excalidraw, `initialStorage` mutation suppression, `canEdit: false`, read-only UI banner). Non-workspace members (outsiders) receive 403 Forbidden on `/api/liveblocks-auth` and 404 Not Found on direct route access.
  - **Multi-Format Export**: Client-only dynamic export helpers support PNG, SVG, and JSON scene downloads without SSR window errors.
- **Automated Verification**:
  - `npm.cmd run test:integration` (2 files, 5 passed)
  - `npm.cmd run test` (7 files, 42 passed)
  - `npm.cmd run lint` (0 errors)
  - `npx.cmd tsc --noEmit` (0 errors)
  - `npm.cmd run build` (18/18 routes compiled, client chunks optimized)
  - `npx.cmd playwright test tests/e2e/collaborative-whiteboards.spec.ts` (2/2 passed)
  - `npx.cmd playwright test tests/e2e/collaborative-documents.spec.ts` (2/2 passed - Phase 5B regression verified clean)
  - `npx.cmd playwright test tests/e2e/auth-and-workspaces.spec.ts` (2/2 passed - Phase 4B regression verified clean)

---

## Phase F: Comments, Mentions, Notifications & Sharing

- **Prerequisites**: Phase D and Phase E complete.
- **Deliverables**:
  - Selection-anchored comments in Tiptap documents using Liveblocks threads.
  - Sticky notes and contextual comment pins on Excalidraw boards.
  - Inline `@mention` user autocomplete and notification trigger.
  - In-app notification center inbox with unread counts and direct artifact deep-links.
  - Artifact sharing modal with user-specific permission overrides.
- **Expected Files / Modules**:
  - `features/comments/components/comment-thread.tsx`, `features/comments/components/comment-panel.tsx`
  - `features/notifications/components/notifications-popover.tsx`
  - `features/sharing/components/share-dialog.tsx`
  - `app/api/users/mention-suggestions/route.ts`
- **Acceptance Criteria**:
  - Leaving a comment on highlighted text pins the thread to the document range.
  - Mentioning a user triggers an in-app notification for that user.
  - Sharing an artifact with a user as `VIEWER` restricts their room token to read-only.
- **Automated Tests**:
  - Integration test for mention suggestion search and permission overrides.
- **External Dependencies**: Liveblocks comments infrastructure.
- **Definition of Done**: Threaded discussions, mentions, notifications, and sharing dialogs work seamlessly across documents and whiteboards.

---

## Phase G: Version History, Attachments, Search & Activity

- **Prerequisites**: Phase F complete.
- **Deliverables**:
  - S3-compatible private file attachment service with presigned upload and download URLs.
  - File upload drawer with drag-and-drop preview.
  - Point-in-time version history viewer with one-click snapshot rollback.
  - Full-text search and global command palette (`Cmd+K`).
  - Workspace-wide activity feed.
- **Expected Files / Modules**:
  - `services/storage.service.ts`, `app/api/attachments/presign-upload/route.ts`, `app/api/attachments/presign-download/route.ts`
  - `features/attachments/components/attachment-drawer.tsx`
  - `features/history/components/version-history-panel.tsx`
  - `features/search/components/command-palette.tsx`
  - `features/activity/components/activity-feed.tsx`
- **Acceptance Criteria**:
  - Files up to 25MB upload directly to S3 via presigned URLs and render download links.
  - Reverting a version restores the exact previous document/board snapshot.
  - `Cmd+K` finds documents, whiteboards, and projects instantly by title or content.
- **Automated Tests**:
  - Unit tests for S3 key formatting and command palette search indexing.
- **External Dependencies**: S3 bucket or MinIO.
- **Definition of Done**: Attachments, version history, search, and activity tracking fully verified.

---

## Phase H: Security Review, Automated Testing & Reliability

- **Prerequisites**: Phase G complete.
- **Deliverables**:
  - End-to-end multi-user Playwright suite testing concurrent documents, whiteboards, and permissions.
  - Vitest unit and integration test suite with high coverage across services.
  - Security audit: IDOR verification, room auth brute-force protection, rate limiting, and XSS sanitization checks.
  - Reconnection resilience tests (network simulation drop and reconnect).
- **Expected Files / Modules**:
  - `tests/e2e/collaboration.spec.ts`, `tests/e2e/permissions.spec.ts`, `tests/e2e/reconnection.spec.ts`
  - `tests/unit/permissions.test.ts`, `tests/integration/artifacts.test.ts`
  - `middleware/rate-limiter.ts`
- **Acceptance Criteria**:
  - All unit, integration, and E2E Playwright tests pass without flakes.
  - Zero unhandled security exceptions or IDOR leaks.
- **Definition of Done**: Full test suite passes; production reliability standards proven.

---

## Phase I: UI Polish, Deployment, Documentation & Demo

- **Prerequisites**: Phase H complete.
- **Deliverables**:
  - Micro-interactions, loading skeletons, empty states, and toast notifications.
  - Seed script with realistic demo scenarios (architecture diagram, technical spec, team workspace).
  - Production build audit (`npm run build`).
  - Environment variable documentation (`.env.example`) and deployment guide.
  - Interactive demo walkthrough script.
- **Acceptance Criteria**:
  - Zero layout shift, flawless theme transitions, accessible keyboard focus rings.
  - Production build completes cleanly with optimal bundle sizes.
- **Definition of Done**: Complete, polished, production-ready collaborative workspace product.
