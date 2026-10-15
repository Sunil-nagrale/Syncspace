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
