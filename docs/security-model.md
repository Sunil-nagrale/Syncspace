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

Liveblocks room tokens are minted dynamically through `/api/liveblocks-auth`. 

### 4.1 Token Issuance Workflow
1. The client Liveblocks SDK attempts to join a room (e.g., `room: "art_clw12345"`).
2. The client fires an authenticated `POST` request to `/api/liveblocks-auth` with the target `room`.
3. The server validates the user's active session cookie.
4. The server extracts the `artifactId` from the room name and calls `resolveEffectivePermission(userId, artifactId)`.
5. If the user has:
   - `OWNER`, `ADMIN`, or `EDITOR`: The session receives write permissions:
     ```typescript
     session.allow(room, ["room:write"]);
     ```
   - `VIEWER`: The session receives read-only permissions:
     ```typescript
     session.allow(room, ["room:read", "room:presence:write"]);
     ```
   - `DENIED`: The endpoint immediately returns an HTTP 403 Forbidden without calling `session.authorize()`.

```mermaid
sequenceDiagram
    autonumber
    actor Client as Browser Client
    participant AuthRoute as /api/liveblocks-auth (Server)
    participant DB as PostgreSQL (Prisma)
    participant LBCloud as Liveblocks Cloud

    Client->>AuthRoute: POST /api/liveblocks-auth (room: "art_xyz") + Session Cookie
    AuthRoute->>AuthRoute: Validate Session Cookie
    AuthRoute->>DB: resolveEffectivePermission(userId, "xyz")
    alt User has No Access
        DB-->>AuthRoute: DENIED
        AuthRoute-->>Client: 403 Forbidden
    else User is Viewer
        DB-->>AuthRoute: VIEWER
        AuthRoute->>LBCloud: prepareSession(userId).allow("art_xyz", ["room:read", "room:presence:write"]).authorize()
        LBCloud-->>AuthRoute: Signed JWT Access Token
        AuthRoute-->>Client: 200 OK (Token Body)
    else User is Editor / Admin / Owner
        DB-->>AuthRoute: EDITOR
        AuthRoute->>LBCloud: prepareSession(userId).allow("art_xyz", ["room:write"]).authorize()
        LBCloud-->>AuthRoute: Signed JWT Access Token
        AuthRoute-->>Client: 200 OK (Token Body)
    end
    Client->>LBCloud: WSS Connect with Signed JWT Token
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

- **Token Generation**: Generated using cryptographically strong pseudo-random bytes (`crypto.randomBytes(32).toString('hex')`).
- **Expiration Window**: Strict 7-day expiration (`expiresAt < new Date()`).
- **Single-Use Enforcement**: When accepted, status flips from `PENDING` to `ACCEPTED` in an atomic database transaction. Subsequent attempts to use the same token are rejected.
- **Tenant Verification**: The inviting user must possess `OWNER` or `ADMIN` roles in that specific workspace.

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
