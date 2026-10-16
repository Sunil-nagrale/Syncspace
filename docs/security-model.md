# SyncSpace — Security Model & Threat Mitigation

## 1. Security Architecture Principles

SyncSpace is engineered around a zero-trust model for client-side interactions. All authorization decisions, session validations, permission resolutions, and cryptographic signing take place exclusively on the backend. 

Key tenets:
1. **Never Trust Room IDs**: A Liveblocks room identifier is an arbitrary string; it provides zero authorization proof.
2. **Strict Multi-Tenant Isolation**: Every database query and storage lookup must be explicitly bound to the authenticated user's workspace context.
3. **Defense in Depth**: Access control is validated at the edge middleware, route handlers/server actions, application services, and external provider token endpoints.
4. **Least Privilege**: Users receive only the minimum required capabilities (e.g. read-only vs read-write scopes).

---

## 2. Authentication & Session Security

- **Session Protocol**: Standard Better Auth database session cookies marked with:
  - `HttpOnly: true` (inaccessible to malicious client scripts / XSS).
  - `Secure: true` (transmitted only over HTTPS in production).
  - `SameSite: "lax"` (mitigates Cross-Site Request Forgery).
- **Session Duration & Rotation**:
  - Max session age: 30 days.
  - Idle timeout: 7 days.
  - Periodic session token rotation on sensitive security actions (password change, email update).
- **Password Security**:
  - Hashed using `bcrypt` (cost factor 12) or `argon2id`.
  - Passwords are never returned in database queries or serialized into JWT payloads (`select: { passwordHash: false }`).
- **OAuth Providers**:
  - State parameter validation to prevent CSRF in OAuth authorization flows.
  - Verified email matching with existing local accounts.

---

## 3. Multi-Tenant Workspace Isolation & IDOR Defense

Insecure Direct Object Reference (IDOR) vulnerabilities are prevented by systematically enforcing workspace tenancy checks across all queries.

### 3.1 Tenancy Enforcement Pattern
All Prisma queries that access a project, artifact, or attachment must verify that the target entity belongs to the active `workspaceId`, and that the requesting `userId` has active membership:

```typescript
// SECURE: Strict compound filter prevents IDOR across workspaces
const artifact = await prisma.artifact.findFirst({
  where: {
    id: artifactId,
    workspace: {
      id: activeWorkspaceId,
      members: {
        some: { userId: session.user.id },
      },
    },
    isArchived: false,
  },
});

if (!artifact) {
  // Return generic 404 to avoid leaking existence of artifacts in other tenants
  throw new NotFoundError("Artifact not found");
}
```

---

## 4. Liveblocks Server-Side Authorization

Liveblocks room tokens are minted dynamically through `POST /api/liveblocks-auth` (`src/app/api/liveblocks-auth/route.ts` and `src/services/liveblocks-auth.service.ts`). Public key authentication is never used for private workspace rooms.

### 4.1 Token Issuance Workflow
1. The client `<LiveblocksProvider authEndpoint="/api/liveblocks-auth">` requests a room token when entering `<RoomProvider id={liveblocksRoomId}>`.
2. The server authenticates the request using `getServerSession()` (Better Auth session cookie) and loads the user record from PostgreSQL.
3. The server validates the requested `room` string and looks up the non-archived `Artifact` by `Artifact.liveblocksRoomId` via `AuthorizationService.requireArtifactRoomAccess(userId, roomId, "DOCUMENT")`.
4. Effective permission resolution (`AuthorizationService.requireArtifactAccess`) verifies `WorkspaceMember` membership first, then checks for an explicit per-artifact `ArtifactPermission` override (`NONE`, `VIEWER`, `EDITOR`) which constrains or elevates the workspace role (including `OWNER` and `ADMIN`):
   - Effective role `OWNER`, `ADMIN`, or `EDITOR` (when permitted by artifact policy): receives full write access:
     ```typescript
     session.allow(artifact.liveblocksRoomId, session.FULL_ACCESS); // ["*:write"]
     ```
   - Effective role `VIEWER`: receives strictly read-only access:
     ```typescript
     session.allow(artifact.liveblocksRoomId, session.READ_ACCESS); // ["*:read"]
     ```
   - Unauthenticated (`401`), malformed room (`400`), unauthorized / revoked (`NONE`) / wrong artifact type (`403`): rejected before any Liveblocks token is minted.
   - Missing or placeholder `LIVEBLOCKS_SECRET_KEY`: returns `503 Service Unavailable` (`LIVEBLOCKS_SECRET_KEY_NOT_CONFIGURED`).

```mermaid
sequenceDiagram
    autonumber
    actor Client as Browser Client
    participant AuthRoute as /api/liveblocks-auth (Server)
    participant DB as PostgreSQL (Prisma)
    participant LBCloud as Liveblocks Cloud

    Client->>AuthRoute: POST /api/liveblocks-auth (room: "art_...") + Session Cookie
    AuthRoute->>AuthRoute: Validate Better Auth Session
    AuthRoute->>DB: Lookup Artifact by liveblocksRoomId & resolve effective role + ArtifactPermission override
    alt Unauthorized / Revoked (NONE) / Nonexistent Room
        DB-->>AuthRoute: Denied
        AuthRoute-->>Client: 401 / 403 Forbidden
    else Effective Role is VIEWER
        DB-->>AuthRoute: VIEWER
        AuthRoute->>LBCloud: prepareSession(userId, userInfo).allow(roomId, READ_ACCESS).authorize()
        LBCloud-->>AuthRoute: Signed Room Access Token (Read-Only)
        AuthRoute-->>Client: 200 OK (Token Body)
    else Effective Role is OWNER / ADMIN / EDITOR
        DB-->>AuthRoute: EDITOR / ADMIN / OWNER
        AuthRoute->>LBCloud: prepareSession(userId, userInfo).allow(roomId, FULL_ACCESS).authorize()
        LBCloud-->>AuthRoute: Signed Room Access Token (Read/Write)
        AuthRoute-->>Client: 200 OK (Token Body)
    end
    Client->>LBCloud: WSS Connect with Signed Room Token
```

---

## 5. Active Session Handling Upon Membership Revocation

When an Admin or Owner revokes a user's membership:
1. **Database Action**: The `WorkspaceMember` row is deleted inside a transaction.
2. **Web Requests**: Any subsequent HTTP request or Server Action by the revoked user fails immediately with `403 Forbidden` because `WorkspaceMember` lookup returns `null`.
3. **Live Collaboration Rooms**:
   - Liveblocks tokens are short-lived (default 5–15 minutes).
   - Once a token expires, the client must request a new token from `/api/liveblocks-auth`. Because the user is no longer a member, this request fails with `403`, immediately disconnecting the client.
   - For instant termination, SyncSpace calls the Liveblocks REST API to evict the user or purge active room connections:
     ```typescript
     await liveblocks.deleteUserConnections(userId);
     ```

---

## 6. Invitation Security & Expiration

- **Token Generation**: Generated using 256 bits of cryptographically strong pseudo-random entropy (`crypto.randomBytes(32).toString('hex')`).
- **Token Hashing at Rest**: Raw bearer tokens are **never stored** in PostgreSQL. The server computes `sha256(rawToken)` and persists the 64-character hexadecimal digest in `Invitation.token`. Lookup queries hash the incoming raw token and match on the unique index.
- **Expiration Window**: Strict 7-day expiration (`expiresAt < new Date()`). Expired invitations reject acceptance and return status `EXPIRED`.
- **Single-Use Enforcement**: When accepted, the invitation's status transitions from `PENDING` to `ACCEPTED` inside an isolated atomic database transaction (`prisma.$transaction`). Subsequent attempts are immediately rejected (`ALREADY_ACCEPTED`).
- **Email Normalization & Strict Session Matching**:
  - Invitation recipient emails are normalized using `.trim().toLowerCase()`.
  - When an authenticated user attempts to accept an invitation, the server validates:
    `user.email.trim().toLowerCase() === invitation.email.trim().toLowerCase()`
  - If the session email differs, acceptance is denied with `403 Forbidden` (`ACCOUNT_MISMATCH`). The UI prompts the user to switch accounts or sign in with the invited address.
- **Role Boundary & Ownership Protection**:
  - Invitations can **never grant OWNER status**. Attempting to invite an `OWNER` fails with `400 Bad Request`.
  - An `ADMIN` cannot invite an `OWNER` or another `ADMIN`. Only an `OWNER` can invite an `ADMIN`. Regular members (`EDITOR`, `VIEWER`) cannot invite anyone.
  - An `ADMIN` cannot promote another member to `ADMIN` or demote an `OWNER`.
  - The last remaining `OWNER` cannot be demoted or removed from a workspace (`Cannot demote/remove the only workspace owner`).
- **Acceptance Race Protection**:
  - Database-level `@@unique([workspaceId, userId])` prevents duplicate memberships.
  - Transactions re-read the invitation row and check active membership before inserting `WorkspaceMember`.

---


## 7. Secure File Storage & Presigned URLs

SyncSpace never proxies heavy file bytes directly through Next.js server processes. It uses S3-compatible presigned URLs.

### 7.1 Upload Lifecycle
1. User selects a file to attach.
2. Client sends a request to `/api/attachments/presign-upload` with `fileName`, `fileSize`, `mimeType`, and `artifactId`.
3. Server validates:
   - User has `EDITOR`, `ADMIN`, or `OWNER` permission on `artifactId`.
   - `fileSize` <= 25 MB.
   - `mimeType` matches permitted whitelist (`image/png`, `image/jpeg`, `image/webp`, `image/svg+xml`, `application/pdf`, `text/plain`).
4. Server generates an S3 `PutObjectCommand` presigned URL with a 5-minute expiration:
   ```typescript
   const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });
   ```
5. Client uploads directly to S3 via HTTP `PUT`.
6. Client notifies `/api/attachments/complete` to persist the `Attachment` database record.

### 7.2 Download Lifecycle
- Files in the S3 bucket are marked strictly **private** (no public read permissions).
- To view or download an attachment, the client requests a presigned GET URL from `/api/attachments/[id]/download`.
- Server verifies the user currently has read permission on the associated artifact before generating a signed GET URL valid for 60 seconds.

---

## 8. Validation, Sanitization & Input Defense

- **Zod Schema Validation**: Every API route handler and Server Action validates incoming payloads using strict Zod schemas with `.strip()` to reject unknown fields.
- **XSS Sanitization**:
  - Tiptap JSON output is rendered via Tiptap’s sanitized schema serializer.
  - Any raw HTML export or preview is processed through `DOMPurify` before DOM injection.
- **Rate Limiting**:
  - Sensitive endpoints (`/api/auth/*`, `/api/invitations/*`, `/api/attachments/presign-upload`) are protected with token-bucket rate limiting (in-memory or Redis-backed) to prevent credential stuffing and resource exhaustion.
- **Audit Trail**:
  - All critical mutations (role change, member removal, artifact deletion, invite issuance) create an immutable row in `ActivityEvent`.
