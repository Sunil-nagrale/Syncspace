# SyncSpace — Product Specification

## 1. Executive Summary & Vision

SyncSpace is an enterprise-grade real-time collaborative workspace designed for modern product, engineering, and design teams. It consolidates rich-text documentation, live whiteboard sketching, architecture diagramming, contextual discussions, and structured workspace organization into a single, cohesive web platform.

SyncSpace synthesizes:
- **Tiptap & Yjs**: Real-time concurrent document editing with conflict-free replicated data types (CRDTs).
- **Liveblocks**: Enterprise collaboration infrastructure providing authenticated room presence, live multiplayer cursors, threaded contextual comments, inline user mentions, and real-time notification streams.
- **Excalidraw**: Frictionless, hand-drawn and technical diagramming integrated into a synchronized, multiplayer canvas.
- **PostgreSQL & Prisma**: A strictly typed relational source of truth for workspaces, projects, artifacts, membership roles, permissions, audit history, and file metadata.

SyncSpace takes inspiration from:
- **Notion**: Document-first hierarchy, flexible nesting, and distraction-free writing.
- **Linear**: High keyboard efficiency, command palette navigation, restrained monochromatic design, and crisp responsiveness.
- **Figma**: Multi-user awareness, live cursor trails, contextual presence badges, and frictionless sharing.
- **Excalidraw**: Natural whiteboarding, rapid wireframing, and architecture modeling.

---

## 2. Product Capabilities & User Stories

### A. Authentication & Onboarding

#### Capabilities
1. **Registration & Login**: Secure email/password authentication and OAuth (GitHub/Google) via Better Auth with official Prisma ORM 7 adapter.
2. **Session Management**: Secure HTTP-only cookie-based sessions with configurable rotation and multi-device revocation.
3. **User Profile & Avatar**: Configurable display name, bio, email, avatar image upload (stored via S3), and unique collaborator presence color.
4. **Workspace Creation**: Streamlined workspace initialization with slug generation, workspace icon, and company size/use-case profiling.
5. **Initial Onboarding**: Guided first-run wizard creating a sample project, starter document, and tutorial whiteboard.
6. **Workspace Switcher**: Instant switching between multiple workspaces without re-authenticating; persistent last-active workspace memory.
7. **Invitations & Acceptance**: Cryptographic invite links and email invites with expiration and role pre-assignment.

#### Detailed User Stories & Acceptance Criteria

- **US-A1: User Registration**
  - *As a* new user,  
  *I want to* sign up using my work email and password or an OAuth provider,  
  *so that* I can access SyncSpace securely.
  - **Acceptance Criteria**:
    - Email inputs are validated using RFC 5322 regex.
    - Passwords must be at least 8 characters and contain at least one uppercase letter, one lowercase letter, one number, and one symbol.
    - Passwords are salted and hashed using `bcrypt` (cost factor 12) or `argon2id`.
    - Duplicate email registrations fail gracefully with a user-friendly error without leaking user enumeration.
    - An initial user profile record is created in PostgreSQL within a Prisma transaction.

- **US-A2: Multi-Workspace Switching**
  - *As a* consultant or multi-team engineer,  
  *I want to* switch between distinct workspaces from the top sidebar switcher,  
  *so that* I can collaborate on separate team assets with strict boundary isolation.
  - **Acceptance Criteria**:
    - The workspace switcher dropdown displays all workspaces where `WorkspaceMember.userId == currentUser.id`.
    - Switching workspace updates the active session/cookie and routes to `/[workspaceSlug]/dashboard`.
    - All subsequent data queries enforce `workspaceId` tenant scoping.

- **US-A3: Member Invitation & Acceptance**
  - *As a* workspace Admin or Owner,  
  *I want to* invite colleagues via email with a specific role (Admin, Editor, Viewer),  
  *so that* they can join the workspace with appropriate permissions.
  - **Acceptance Criteria**:
    - Invites generate a cryptographically random token (`crypto.randomBytes(32)`).
    - Tokens expire in 7 days (`expiresAt = now() + 7d`).
    - Invited users visiting `/invite/[token]` are prompted to log in or register.
    - Upon confirmation, a `WorkspaceMember` record is created, and the `Invitation` record status updates to `ACCEPTED`.
    - If the user is already a member, an informative banner is displayed and no duplicate record is created.

---

### B. Workspaces & Projects

#### Capabilities
1. **Workspace Hierarchy**: A workspace contains multiple projects, members, settings, and shared assets.
2. **Projects**: Logical folders grouping related documents and whiteboards by initiative, squad, or domain.
3. **Workspace Roles & Permissions**:
   - `OWNER`: Full administrative access, billing, workspace deletion, ownership transfer.
   - `ADMIN`: Manage members, create/delete projects, manage workspace settings, invite users.
   - `EDITOR`: Create, edit, move, and archive documents, whiteboards, and projects.
   - `VIEWER`: Read-only access to all workspace assets; can comment if permitted.
4. **Project Navigation**: Tree view and collapsible project sidebar with live unread indicators and activity counters.
5. **Recent Artifacts**: Fast-access view of the user’s most recently opened documents and whiteboards.
6. **Shared-With-Me View**: Directory of artifacts shared specifically with the user across or outside standard projects.
7. **Workspace Activity Feed**: Chronological stream of created, edited, renamed, and archived artifacts and membership changes.
8. **Settings & Member Management**: Interface for managing workspace metadata, transferring ownership, revoking memberships, and updating member roles.

#### Detailed User Stories & Acceptance Criteria

- **US-B1: Project Organization**
  - *As an* Editor or Admin,  
  *I want to* create a Project with a custom title, icon, and description,  
  *so that* our team can organize documents and whiteboards by sprint or epic.
  - **Acceptance Criteria**:
    - Project names must be 1 to 80 characters.
    - Projects belong to a single `workspaceId`.
    - Deleting a project provides an option to move contained artifacts to the workspace root or archive them.
    - Real-time activity log records `PROJECT_CREATED` and `PROJECT_DELETED` events.

- **US-B2: Member Role Revocation & Active Session Eviction**
  - *As a* workspace Admin,  
  *I want to* revoke a user's membership or downgrade their role to Viewer,  
  *so that* ex-employees or contractors lose immediate access to proprietary documents.
  - **Acceptance Criteria**:
    - The member’s `WorkspaceMember` record is updated or deleted.
    - Next request to any route under `/[workspaceSlug]` denies access (HTTP 403).
    - If the user is currently connected to a Liveblocks room within that workspace, the backend authorization token endpoint rejects renewals and Liveblocks kicks the user off the WebSocket connection.
    - Explicit `ArtifactPermission` overrides for the removed member are cleaned up in an atomic transaction.
    - The last remaining workspace `OWNER` cannot be demoted or removed.

- **US-B3: Secure Workspace Invitations & Token Hashing**
  - *As a* workspace Owner or Admin,
  *I want to* invite collaborators by email with a designated role (`ADMIN`, `EDITOR`, `VIEWER`),
  *so that* they can join the workspace via an encrypted, single-use invitation link.
  - **Acceptance Criteria**:
    - Inviter specifies recipient email and role.
    - Invitations cannot grant `OWNER` status. Admins cannot invite `ADMIN` or `OWNER` roles.
    - Server generates an unpredictable 256-bit token, hashes it with SHA-256 at rest, and enforces a 7-day expiration.
    - If transactional email is unconfigured, the UI presents a secure copyable invitation link and transparently indicates email service is unavailable.
    - Unauthenticated invitees receive an invitation preview prompting login/registration.
    - Acceptance enforces strict email matching between the authenticated user and the invitation recipient (`403 Forbidden` on mismatch).
    - Acceptance atomically creates `WorkspaceMember` and marks the invitation `ACCEPTED`.

- **US-B4: Artifact-Level Permission Overrides & Sharing**
  - *As a* document or whiteboard owner/admin,
  *I want to* configure explicit collaborator overrides (`EDITOR`, `VIEWER`, `NONE`, `INHERIT`),
  *so that* sensitive assets are restricted to specific team members regardless of their default workspace role.
  - **Acceptance Criteria**:
    - An explicit `NONE` override denies access completely (403 on API and Liveblocks room auth).
    - An explicit `VIEWER` override restricts an `EDITOR` to read-only mode (`canWrite: false`, read-only UI banner).
    - `INHERIT` removes the explicit override and falls back to the workspace membership role.
    - Overrides persist across reloads and are enforced synchronously by `/api/liveblocks-auth`.

---


### C. Collaborative Documents (Tiptap + Yjs + Liveblocks)

#### Capabilities
1. **Rich-Text Formatting**: Paragraphs, Headings (H1, H2, H3), Bold, Italic, Strikethrough, Inline Code, Underline, Blockquote, Divider, Task Lists, Bulleted Lists, Numbered Lists.
2. **Tables**: Resizable columns, row insertion, column insertion, cell selection, cell headers.
3. **Links & Media**: Auto-linking, inline link editing, modal link preview, S3 image uploads with drag-and-drop.
4. **Code Blocks**: Syntax highlighting with language selector and line numbering.
5. **Slash Commands (`/`)**: Keyboard-driven command menu for inserting blocks without taking hands off the keyboard.
6. **Multiplayer Concurrent Editing**: Conflict-free text merging powered by Yjs CRDTs synchronized over Liveblocks room WebSockets.
7. **Live Cursors & Presence**: Real-time cursor movement, collaborator selection highlights, and presence badges with user avatar and designated color.
8. **Comments & Mentions**: Text-selection anchored comments, threaded replies, `@mention` autocomplete, and comment resolution.
9. **Read-Only / Viewer Mode**: Automatic disabling of editor mutation capabilities when the user has `VIEWER` permissions.
10. **Persistence & Offline Reconnection**: Automatic persistence to Liveblocks cloud storage and PostgreSQL snapshot sync, with seamless reconnection backoff.
11. **Document Version History**: Named and automatic historical snapshots with side-by-side diff preview and one-click rollback.
12. **Export**: Export document to Markdown (.md), HTML (.html), and JSON.

#### Detailed User Stories & Acceptance Criteria

- **US-C1: Concurrent Rich-Text Editing**
  - *As an* Editor,  
  *I want to* collaborate on a specification document simultaneously with two or more teammates,  
  *so that* our changes merge smoothly without overwriting each other's paragraphs.
  - **Acceptance Criteria**:
    - Document initializes using `@liveblocks/react-tiptap` with Yjs collaboration mode.
    - Typing concurrently in different paragraphs converges deterministically on both screens within 100ms on broadband connections.
    - Typing concurrently in the exact same sentence produces no character loss or duplication.
    - Tiptap's native undo/redo history is disabled in favor of Liveblocks/Yjs undo manager to ensure local undos do not revert remote users' edits.

- **US-C2: Contextual Document Comments**
  - *As an* Editor or Viewer,  
  *I want to* highlight a phrase and leave a comment with an `@mention`,  
  *so that* the author receives an alert and can respond in a threaded conversation.
  - **Acceptance Criteria**:
    - Highlighting text displays a floating bubble menu with an "Add Comment" action.
    - Comments are tied to text ranges via Liveblocks comments thread extension.
    - Mentioning `@Jane` queries `/api/users/mention-suggestions` and sends a notification event to Jane.
    - Resolving a comment hides it from the default editor view while keeping it in the resolved comment archive.

---

### D. Collaborative Whiteboards (Excalidraw + Liveblocks)

#### Capabilities
1. **Excalidraw Canvas**: Full drawing suite including rectangles, ellipses, diamonds, arrows, lines, freehand pencil, text, and eraser.
2. **Canvas Navigation**: Infinite 2D plane, smooth pan (Space+Drag / Middle click), and zoom (Ctrl/Cmd + Wheel).
3. **Element Manipulation**: Multi-selection, alignment tools, grouping, distribution, rotation, z-index ordering, stroke width, and fill styles.
4. **Image & File Insertion**: Drag-and-drop image import onto the canvas with client-side thumbnail rendering and S3 asset persistence.
5. **Real-Time Scene Synchronization**: Per-element CRDT synchronization using Liveblocks `LiveMap<string, LiveObject<ExcalidrawElement>>` coupled with Excalidraw's `reconcileElements` algorithm.
6. **Collaborator Presence**: Live remote cursors, active element bounding-box indicators, and collaborator viewport awareness.
7. **Persistence & Restoration**: Canvas elements and scene files are continuously synchronized to room storage and periodically snapshotted to PostgreSQL.
8. **Read-Only / Viewer Mode**: Canvas locked against interaction when the user possesses `VIEWER` permissions (`viewModeEnabled={true}`).
9. **Export**: High-fidelity export to PNG, SVG, and Excalidraw JSON format.
10. **Contextual Whiteboard Feedback**: Sticky notes and contextual comment pins attached to canvas coordinates.

#### Detailed User Stories & Acceptance Criteria

- **US-D1: Multi-User Whiteboard Synchronization**
  - *As an* Architect,  
  *I want to* create shapes and diagram arrows while a colleague annotates the same diagram,  
  *so that* we can model system flows in real time without overwriting each other's shapes.
  - **Acceptance Criteria**:
    - Moving or resizing Shape A on Client 1 updates Shape A on Client 2 within 100ms.
    - If Client 1 edits Shape A while Client 2 simultaneously edits Shape B, both edits succeed without conflict.
    - When an element is deleted, its deletion propagates to all clients via Excalidraw's tombstone/reconcile protocol (`isDeleted: true` / `elementsMap.delete(id)`).
    - Remote updates do not interrupt or jitter an active dragging gesture on the local client.

- **US-D2: Whiteboard Read-Only Protection**
  - *As a* Project Viewer,  
  *I want to* inspect a technical whiteboard without the risk of accidentally modifying or deleting components,  
  *so that* the integrity of the design is preserved.
  - **Acceptance Criteria**:
    - If the user's role on the artifact is `VIEWER`, the Excalidraw component renders with `viewModeEnabled={true}` and `zenModeEnabled={false}`.
    - Drawing tools, shape selectors, and deletion keys are disabled.
    - Pan and zoom remain responsive for navigation.
    - Backend rejects any mutation attempts sent over Liveblocks room storage.

---

### E. Shared Productivity Features

#### Capabilities
1. **In-App Notifications**: Notification center showing unread mentions, comment replies, project invitations, and document updates.
2. **Global Command Palette (`Cmd+K` / `Ctrl+K`)**: Rapid fuzzy-search across all documents, whiteboards, projects, and actions.
3. **Full-Text Search**: Search document headings, body copy, whiteboard text elements, and project titles.
4. **File Attachments**: File upload drawer supporting PDF, images, diagrams, and code snippets, stored in S3 with presigned secure download URLs.
5. **Activity Log**: Workspace-wide audit trail of user actions with entity links and relative timestamps.
6. **User Preferences & Themes**: Light and dark themes with system preference detection and seamless CSS token switching.
7. **Responsive Shell**: Collapsible sidebar, mobile drawer navigation, breadcrumb navigation, and adaptive canvas layouts.

---

## 3. Scope Matrix: MVP vs. Post-MVP

| Feature Category | MVP Scope (Phase 1–2 Target) | Post-MVP Enhancements (Phase 3+) |
| :--- | :--- | :--- |
| **Authentication** | Email/Password, Sessions, Profile, Avatars | SAML/SSO, Passkeys, OAuth (Google/GitHub) |
| **Workspaces** | Multi-workspace, Projects, Member Roles (Owner, Admin, Editor, Viewer), Invites | Workspace billing, custom domain mapping |
| **Documents** | Tiptap rich-text, slash commands, headings, tables, code blocks, task lists, Yjs live cursors, comments, export to Markdown/HTML | AI text autocomplete, LaTeX equation editor, nested sub-pages tree |
| **Whiteboards** | Excalidraw canvas, shape drawing, arrows, text, image insertion, Liveblocks LiveMap sync, reconcileElements, PNG/SVG export | Custom shape libraries, AI sketch-to-diagram |
| **Permissions** | Workspace-level RBAC + Artifact-level role overrides (Editor, Viewer) | Granular folder inheritance rules, public view links with passwords |
| **Search & Nav** | Global Command Palette (Cmd+K), PostgreSQL full-text search, recent items | Semantic vector search (pgvector), OCR on whiteboard images |
| **Attachments** | S3-compatible private upload/download via presigned URLs (up to 25MB) | In-app video playback, audio notes, 500MB uploads |
| **History** | Periodic manual & auto-snapshots (ArtifactVersion), restore snapshot | Visual side-by-side line diff viewer, branch/merge documents |
