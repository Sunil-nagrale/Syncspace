# SyncSpace — Data Model & Entity Specifications

## 1. Overview & Data Design Principles

SyncSpace relies on **PostgreSQL** as the single source of truth for identity, tenancy, workspaces, membership roles, project hierarchies, metadata, permissions, audit history, and file attachments. 

Content editing states (such as Yjs document trees and Excalidraw element maps) are managed in real time within Liveblocks room storage, while point-in-time snapshots and backup history are captured into the relational `ArtifactVersion` table.

---

## 2. Entity-Relationship Diagram

```mermaid
erDiagram
    User ||--o{ Account : "has"
    User ||--o{ Session : "has"
    User ||--o{ WorkspaceMember : "belongs to"
    User ||--o{ Artifact : "creates"
    User ||--o{ ArtifactPermission : "granted"
    User ||--o{ ArtifactVersion : "snapshots"
    User ||--o{ Attachment : "uploads"
    User ||--o{ ActivityEvent : "acts in"
    User ||--o{ Notification : "receives"
    User ||--o{ NotificationPreference : "configures"

    Workspace ||--o{ WorkspaceMember : "has"
    Workspace ||--o{ Invitation : "issues"
    Workspace ||--o{ Project : "contains"
    Workspace ||--o{ Artifact : "owns"
    Workspace ||--o{ CommentThread : "scopes"
    Workspace ||--o{ ActivityEvent : "logs"

    Project ||--o{ Artifact : "organizes"

    Artifact ||--o{ ArtifactPermission : "overrides"
    Artifact ||--o{ ArtifactVersion : "archives"
    Artifact ||--o{ Attachment : "attaches"
    Artifact ||--o{ CommentThread : "hosts"

    CommentThread ||--o{ Comment : "contains"
    Comment ||--o{ CommentReaction : "receives"

    WorkspaceMember }|--|| Workspace : "member of"
    WorkspaceMember }|--|| User : "identifies"
```

---

## 3. Detailed Entity Specifications

### 3.1 Authentication & Identity Entities

#### `User`
Primary user identity record.
- **Fields**:
  - `id`: `String` (cuid2 / uuidv7, Primary Key)
  - `email`: `String` (Unique, indexed)
  - `emailVerified`: `DateTime?`
  - `passwordHash`: `String?` (Null for pure OAuth users)
  - `name`: `String`
  - `avatarUrl`: `String?`
  - `color`: `String` (Hex color code assigned for live cursors and avatars, e.g. `#6366F1`)
  - `createdAt`: `DateTime` (Default: `now()`)
  - `updatedAt`: `DateTime` (Updated automatically)
- **Relationships**: One-to-many with `WorkspaceMember`, `Account`, `Session`, `Artifact`, `Attachment`, `ActivityEvent`.
- **Deletion Behavior**: Soft-delete flag or restricted cascade. If a user is deleted, their created artifacts remain intact with `createdById` preserved or reassigned to a designated workspace owner.

#### `Account`, `Session` & `Verification` (Better Auth Standard)
- Official Better Auth Prisma adapter entities mapping OAuth accounts (`accountId`, `providerId`, `userId`, `accessToken`, `refreshToken`, `password`), active database sessions (`token`, `userId`, `expiresAt`, `ipAddress`, `userAgent`), and email/phone verification records (`identifier`, `value`, `expiresAt`).

---

### 3.2 Tenancy, Workspaces & Membership

#### `Workspace`
The core organizational tenant.
- **Fields**:
  - `id`: `String` (Primary Key)
  - `name`: `String` (e.g. "Acme Product Team")
  - `slug`: `String` (Unique, indexed; URL-safe slug, e.g. "acme-product")
  - `logoUrl`: `String?`
  - `createdAt`: `DateTime` (Default: `now()`)
  - `updatedAt`: `DateTime`
- **Indexes**: `@@index([slug])`
- **Deletion Behavior**: Cascades to `WorkspaceMember`, `Invitation`, `Project`, `Artifact`, `ActivityEvent`.

#### `WorkspaceMember`
Associates users with workspaces and defines their role.
- **Fields**:
  - `id`: `String` (Primary Key)
  - `workspaceId`: `String` (Foreign Key -> `Workspace.id`)
  - `userId`: `String` (Foreign Key -> `User.id`)
  - `role`: `WorkspaceRole` (Enum: `OWNER`, `ADMIN`, `EDITOR`, `VIEWER`)
  - `joinedAt`: `DateTime` (Default: `now()`)
- **Constraints & Indexes**:
  - `@@unique([workspaceId, userId])`
  - `@@index([userId])`
  - `@@index([workspaceId, role])`
- **Deletion Behavior**: Cascades on `Workspace` or `User` deletion. Deleting a member immediately revokes workspace access.

#### `Invitation`
Pending email invitations to join a workspace.
- **Fields**:
  - `id`: `String` (Primary Key)
  - `workspaceId`: `String` (Foreign Key -> `Workspace.id`)
  - `email`: `String` (Recipient email)
  - `role`: `WorkspaceRole` (Default: `EDITOR`, restricted to `ADMIN`, `EDITOR`, `VIEWER`; never `OWNER`)
  - `token`: `String` (Unique SHA-256 hash of the 256-bit unguessable raw token for token hashing at rest; raw bearer tokens are never persisted)
  - `invitedById`: `String` (Foreign Key -> `User.id`)
  - `status`: `InvitationStatus` (Enum: `PENDING`, `ACCEPTED`, `REVOKED`, `EXPIRED`)
  - `expiresAt`: `DateTime` (Default: 7 days from creation)
  - `createdAt`: `DateTime` (Default: `now()`)
- **Constraints & Indexes**:
  - `@@unique([token])`
  - `@@index([workspaceId, email])`
  - `@@index([token, status])`
- **Deletion Behavior**: Cascade on `Workspace` deletion.


---

### 3.3 Projects & Unified Artifact Model

#### `Project`
Logical grouping within a workspace.
- **Fields**:
  - `id`: `String` (Primary Key)
  - `workspaceId`: `String` (Foreign Key -> `Workspace.id`)
  - `name`: `String` (e.g., "Mobile Redesign")
  - `description`: `String?`
  - `icon`: `String?` (Lucide icon identifier or emoji)
  - `color`: `String?`
  - `isArchived`: `Boolean` (Default: `false`)
  - `createdById`: `String` (Foreign Key -> `User.id`)
  - `createdAt`: `DateTime` (Default: `now()`)
  - `updatedAt`: `DateTime`
- **Indexes**:
  - `@@index([workspaceId, isArchived])`
  - `@@index([createdById])`
- **Deletion Behavior**: Restricted if artifacts exist, or triggers artifact migration to workspace root.

#### `Artifact`
Unified polymorphic model for both rich-text **Documents** and visual **Whiteboards**.
- **Fields**:
  - `id`: `String` (Primary Key)
  - `workspaceId`: `String` (Foreign Key -> `Workspace.id`)
  - `projectId`: `String?` (Foreign Key -> `Project.id`, optional)
  - `type`: `ArtifactType` (Enum: `DOCUMENT`, `WHITEBOARD`)
  - `title`: `String` (Default: "Untitled")
  - `description`: `String?`
  - `icon`: `String?`
  - `coverImageUrl`: `String?`
  - `liveblocksRoomId`: `String` (Unique, calculated or stored: `art_${id}`)
  - `isPinned`: `Boolean` (Default: `false`)
  - `isArchived`: `Boolean` (Default: `false`)
  - `createdById`: `String` (Foreign Key -> `User.id`)
  - `updatedById`: `String?` (Foreign Key -> `User.id`)
  - `createdAt`: `DateTime` (Default: `now()`)
  - `updatedAt`: `DateTime`
- **Constraints & Indexes**:
  - `@@unique([liveblocksRoomId])`
  - `@@index([workspaceId, projectId, isArchived])`
  - `@@index([workspaceId, type, updatedAt])`
  - `@@index([createdById])`
- **Deletion Behavior**: Soft-deletable (`isArchived: true`) or hard delete cascading to `ArtifactPermission`, `ArtifactVersion`, `Attachment`.

#### `ArtifactPermission`
Granular per-artifact access overrides that exceed or constrain workspace defaults.
- **Fields**:
  - `id`: `String` (Primary Key)
  - `artifactId`: `String` (Foreign Key -> `Artifact.id`)
  - `userId`: `String` (Foreign Key -> `User.id`)
  - `role`: `ArtifactRole` (Enum: `EDITOR`, `VIEWER`, `NONE`)
  - `createdAt`: `DateTime` (Default: `now()`)
- **Constraints & Indexes**:
  - `@@unique([artifactId, userId])`
  - `@@index([userId])`
- **Deletion Behavior**: Cascade on `Artifact` or `User` deletion.

---

### 3.4 Version History & Attachments

#### `ArtifactVersion`
Point-in-time snapshots for recovery and audit history.
- **Fields**:
  - `id`: `String` (Primary Key)
  - `artifactId`: `String` (Foreign Key -> `Artifact.id`)
  - `versionNumber`: `Int`
  - `title`: `String` (Snapshot of title at version time)
  - `snapshotData`: `Json` (Full JSON serialization of Tiptap document or Excalidraw scene elements)
  - `changeSummary`: `String?` (e.g. "Auto-saved snapshot", "Major rewrite of Section 3")
  - `createdById`: `String` (Foreign Key -> `User.id`)
  - `createdAt`: `DateTime` (Default: `now()`)
- **Constraints & Indexes**:
  - `@@unique([artifactId, versionNumber])`
  - `@@index([artifactId, createdAt])`
- **Deletion Behavior**: Cascade on `Artifact` deletion.

#### `Attachment`
Uploaded media and files attached to documents or whiteboards.
- **Fields**:
  - `id`: `String` (Primary Key)
  - `workspaceId`: `String` (Foreign Key -> `Workspace.id`)
  - `artifactId`: `String` (Foreign Key -> `Artifact.id`)
  - `fileName`: `String`
  - `fileKey`: `String` (S3 object key: `workspaces/${wsId}/artifacts/${artId}/${fileId}-${fileName}`)
  - `fileSize`: `Int` (Bytes)
  - `mimeType`: `String`
  - `uploadedById`: `String` (Foreign Key -> `User.id`)
  - `createdAt`: `DateTime` (Default: `now()`)
- **Constraints & Indexes**:
  - `@@index([artifactId])`
  - `@@index([workspaceId])`
- **Deletion Behavior**: S3 object must be deleted when record is purged.

---

### 3.5 Artifact Discussions & Comments (Phase 8A)

#### `CommentThread`
Top-level contextual or general discussion thread attached to an artifact.
- **Fields**:
  - `id`: `String` (cuid, Primary Key)
  - `artifactId`: `String` (Foreign Key -> `Artifact.id`, Cascades)
  - `workspaceId`: `String` (Foreign Key -> `Workspace.id`, Cascades)
  - `createdById`: `String` (Foreign Key -> `User.id`, Cascades)
  - `isResolved`: `Boolean` (Default: `false`)
  - `resolvedById`: `String?` (Foreign Key -> `User.id`, SetNull)
  - `resolvedAt`: `DateTime?`
  - `anchorType`: `CommentAnchorType` (`GENERAL`, `TEXT_SELECTION`, `CANVAS_ELEMENT`, `CANVAS_COORDINATE`, Default: `GENERAL`)
  - `anchorData`: `Json?` (Contextual anchor coordinates, block IDs, or element IDs)
  - `createdAt`: `DateTime` (Default: `now()`)
  - `updatedAt`: `DateTime`
- **Constraints & Indexes**:
  - `@@index([artifactId, isResolved, createdAt])`
  - `@@index([workspaceId])`
  - `@@index([createdById])`
- **Lifecycle & Moderation**:
  - Deleting the root comment in a thread automatically deletes the parent `CommentThread` and cascades to all child replies and reactions.
  - Resolving / reopening can be triggered by thread author, artifact editors, or workspace admins/owners.

#### `Comment`
Individual comment item (root comment or chronological reply) inside a `CommentThread`.
- **Fields**:
  - `id`: `String` (cuid, Primary Key)
  - `threadId`: `String` (Foreign Key -> `CommentThread.id`, Cascades)
  - `authorId`: `String` (Foreign Key -> `User.id`, Cascades)
  - `content`: `String` (Text, max 5,000 chars)
  - `isEdited`: `Boolean` (Default: `false`)
  - `editedAt`: `DateTime?`
  - `createdAt`: `DateTime` (Default: `now()`)
  - `updatedAt`: `DateTime`
- **Constraints & Indexes**:
  - `@@index([threadId, createdAt])`
  - `@@index([authorId])`
- **Permissions**:
  - Editing is strictly restricted to the comment author (`authorId`).
  - Deletion is permitted for the comment author (`authorId`) or workspace moderators (`OWNER` / `ADMIN`).

#### `CommentReaction`
Lightweight emoji reaction on an individual comment item.
- **Fields**:
  - `id`: `String` (cuid, Primary Key)
  - `commentId`: `String` (Foreign Key -> `Comment.id`, Cascades)
  - `userId`: `String` (Foreign Key -> `User.id`, Cascades)
  - `emoji`: `String` (UTF-8 emoji string, max 16 chars)
  - `createdAt`: `DateTime` (Default: `now()`)
- **Constraints & Indexes**:
  - `@@unique([commentId, userId, emoji])` (Strict database guarantee preventing duplicate reactions)
  - `@@index([commentId])`
  - `@@index([userId])`

#### `CommentThreadEvent`
Immutable state transition audit log for discussion threads (`RESOLVED` and `REOPENED`).
- **Fields**:
  - `id`: `String` (cuid, Primary Key)
  - `threadId`: `String` (Foreign Key -> `CommentThread.id`, Cascades)
  - `workspaceId`: `String` (Foreign Key -> `Workspace.id`, Cascades)
  - `artifactId`: `String` (Foreign Key -> `Artifact.id`, Cascades)
  - `userId`: `String` (Foreign Key -> `User.id`, Cascades)
  - `type`: `CommentThreadEventType` (`RESOLVED`, `REOPENED`)
  - `createdAt`: `DateTime` (Default: `now()`)
- **Constraints & Indexes**:
  - `@@index([threadId, createdAt])`
  - `@@index([artifactId, createdAt])`
  - `@@index([workspaceId])`
  - `@@index([userId])`
- **Audit Invariant**:
  - Events are strictly append-only. Reopening a thread appends a `REOPENED` event and preserves all historical `RESOLVED` records. Duplicate state mutations are idempotent.

---

### 3.6 Activity & Notifications

#### `ActivityEvent`
Workspace-level audit log.
- **Fields**:
  - `id`: `String` (Primary Key)
  - `workspaceId`: `String` (Foreign Key -> `Workspace.id`)
  - `actorId`: `String` (Foreign Key -> `User.id`)
  - `entityType`: `String` ("ARTIFACT", "PROJECT", "MEMBER", "WORKSPACE")
  - `entityId`: `String`
  - `action`: `String` ("CREATED", "UPDATED", "ARCHIVED", "DELETED", "ROLE_CHANGED")
  - `metadata`: `Json?`
  - `createdAt`: `DateTime` (Default: `now()`)
- **Indexes**: `@@index([workspaceId, createdAt])`

#### `Notification` & `NotificationPreference`
- **Notification**: Stores in-app alerts (`id`, `userId`, `workspaceId`, `type`, `title`, `message`, `linkUrl`, `readAt`, `createdAt`).
- **NotificationPreference**: User preferences for email and in-app channels (`userId`, `emailMentions`, `emailReplies`, `emailInvites`).

---

## 4. Effective Access Resolution Logic

When an authenticated user requests access to an artifact (via web UI, API, or Liveblocks room authorization), the server evaluates effective permissions using the following deterministic precedence:

```typescript
export type EffectiveRole = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER" | "DENIED";

export async function resolveEffectivePermission(
  userId: string,
  artifactId: string
): Promise<EffectiveRole> {
  // 1. Fetch artifact and user's workspace membership
  const artifact = await prisma.artifact.findUnique({
    where: { id: artifactId },
    select: {
      workspaceId: true,
      createdById: true,
      isArchived: true,
    },
  });

  if (!artifact || artifact.isArchived) return "DENIED";

  const member = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: artifact.workspaceId,
        userId: userId,
      },
    },
  });

  if (!member) return "DENIED";

  // 2. Owners and Admins always have full administrative permissions
  if (member.role === "OWNER") return "OWNER";
  if (member.role === "ADMIN") return "ADMIN";

  // 3. Check for specific ArtifactPermission override
  const override = await prisma.artifactPermission.findUnique({
    where: {
      artifactId_userId: {
        artifactId: artifactId,
        userId: userId,
      },
    },
  });

  if (override) {
    if (override.role === "NONE") return "DENIED";
    if (override.role === "EDITOR") return "EDITOR";
    if (override.role === "VIEWER") return "VIEWER";
  }

  // 4. Fallback to general workspace membership role
  if (member.role === "EDITOR") return "EDITOR";
  if (member.role === "VIEWER") return "VIEWER";

  return "DENIED";
}
```

### Liveblocks Scope Translation
- `OWNER`, `ADMIN`, `EDITOR`: `session.allow(room, ["room:write"])`
- `VIEWER`: `session.allow(room, ["room:read", "room:presence:write"])`
- `DENIED`: Request rejected with HTTP 403 Forbidden.

---

## 8. Artifact Version History and Restoration Model (Phase 9A)

### Overview
Version history in SyncSpace decouples continuous autosaving from immutable historical snapshots. Routine collaborative typing modifies `Artifact.currentSnapshot` and increments `Artifact.currentRevision` without mutating or overwriting historical `ArtifactVersion` records.

### Schema Additions

```prisma
model Artifact {
  id              String            @id @default(cuid())
  // ... existing fields ...
  currentSnapshot Json?             // Durable snapshot of the current state
  currentRevision Int               @default(1) // Monotonically increasing revision counter for optimistic concurrency
  versions        ArtifactVersion[]
}

model ArtifactVersion {
  id                  String   @id @default(cuid())
  artifactId          String
  artifact            Artifact @relation(fields: [artifactId], references: [id], onDelete: Cascade)
  versionNumber       Int      // Sequential monotonic counter per artifact
  title               String
  snapshotData        Json     // Immutable full state snapshot (Tiptap ProseMirror JSON or Excalidraw scene)
  changeSummary       String?
  source              String   @default("AUTOMATIC") // AUTOMATIC, MANUAL, RESTORED, RESTORE_RECOVERY
  restoredFromVersion Int?     // References the historical versionNumber when source is RESTORED
  createdById         String
  createdBy           User     @relation(fields: [createdById], references: [id], onDelete: Cascade)
  createdAt           DateTime @default(now())

  @@unique([artifactId, versionNumber])
  @@index([artifactId, createdAt])
  @@index([artifactId, versionNumber])
  @@index([createdById])
}
```

### Safety & Concurrency Principles
1. **Immutable Snapshots**: Once created, `ArtifactVersion` rows are read-only and never updated or erased by routine edits or restores.
2. **Optimistic Concurrency**: Restore operations accept `expectedRevision`. If the artifact's current revision does not match `expectedRevision`, the server rejects with HTTP 409 Conflict.
3. **Displaced State Preservation**: If restoring a version when the current active state contains unsaved changes differing from the latest version, a `RESTORE_RECOVERY` checkpoint is atomically created before restoration.
4. **Monotonic Restoration**: Restoring creates a new `RESTORED` version entry with sequential `versionNumber = max(versionNumber) + 1` and `restoredFromVersion` linking to the restored source, preserving a clear timeline audit trail.

---

## 9. Secure File Attachment Model (Phase 9B)

The existing `Attachment` model is extended with explicit lifecycle state tracking (`AttachmentStatus`), integrity checksums (`sha256`), failure diagnostics (`failureReason`), unique storage keys, and composite indexes:

```prisma
enum AttachmentStatus {
  PENDING
  READY
  FAILED
  DELETING
}

model Attachment {
  id            String           @id @default(cuid())
  workspaceId   String
  workspace     Workspace        @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  artifactId    String?
  artifact      Artifact?        @relation(fields: [artifactId], references: [id], onDelete: Cascade)
  fileName      String
  fileType      String
  fileSize      Int
  storageKey    String           @unique
  publicUrl     String?
  status        AttachmentStatus @default(PENDING)
  sha256        String?
  failureReason String?
  uploadedById  String
  uploadedBy    User             @relation("AttachmentUploadedBy", fields: [uploadedById], references: [id], onDelete: Cascade)
  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @default(now()) @updatedAt

  @@index([workspaceId])
  @@index([artifactId])
  @@index([artifactId, status, createdAt])
  @@index([uploadedById, status])
  @@map("attachment")
}
```

### Lifecycle & Integrity Invariants
- **`storageKey` Confidentiality**: `storageKey` is unique, generated using cryptographic randomness (`workspaces/{workspaceId}/artifacts/{artifactId}/blobs/{uuid}-{randomHex}`), never derived from user filenames, and never serialized to client API responses.
- **No Permanent Public URLs**: `publicUrl` remains `null` for private attachments; expiring signed URLs are never persisted as permanent URLs.
- **Version Restore Independence**: Attachments are associated with `Artifact.id` rather than `ArtifactVersion.snapshotData`, ensuring attached files remain intact when a document or whiteboard is edited or restored to an earlier version.
