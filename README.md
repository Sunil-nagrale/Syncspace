# SyncSpace

> Real-time collaborative engineering workspace converging rich-text technical specifications, interactive architecture whiteboards, and multi-tenant project management into a single unified platform.

---

## 1. Overview & Core Features

SyncSpace is a production-grade fullstack collaborative platform built with Next.js 15, React 19, PostgreSQL, Liveblocks, and Tailwind CSS. It is engineered for technical teams to draft specifications, diagram distributed architectures, and manage sprint milestones without context switching.

- **Collaborative Rich-Text Documents:** Real-time multi-user document editor powered by Tiptap v2 and Yjs CRDTs with headings, code blocks, task lists, tables, and slash commands.
- **Synchronized Architecture Whiteboards:** Interactive canvas powered by Excalidraw with per-element Last-Write-Wins (LWW) conflict reconciliation and Liveblocks live synchronization.
- **Multiplayer Presence:** Live collaborator cursors, active element selection outlines, selection-anchored discussion threads, and inline `@mentions`.
- **Multi-Tenant Workspaces & Projects:** Strict hierarchical organization with workspace isolation, role-based access control (OWNER, ADMIN, EDITOR, VIEWER), and fine-grained artifact permission overrides.
- **Version History & Restore:** Monotonic immutable version checkpoints, diff comparison, and conflict-free restore with displaced-state safety checkpoints.
- **Secure Private File Attachments:** Staged-to-final promotion pipeline preventing post-verification overwrites (TOCTOU defense), SHA-256 integrity verification, and signed download URLs.
- **Full-Text Search & Global Command Palette:** Fast workspace-wide search across documents, whiteboards, and projects with keyboard shortcuts (`Cmd+K` / `Ctrl+K`).
- **Workspace Activity Feed:** Comprehensive event stream capturing artifact edits, comments, member changes, and checkpoints with strict RBAC filtering.

---

## 2. Architecture & Service Dependencies

```
                          ┌───────────────────────────┐
                          │   Client Web Application  │
                          │   (Next.js 15 + React 19) │
                          └─────────────┬─────────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    │ HTTPS (App/API)   │ WSS (CRDT Sync)   │ S3 Presigned
                    ▼                   ▼                   ▼
        ┌───────────────────────┐ ┌───────────────┐ ┌───────────────────┐
        │ Next.js Monolith      │ │ Liveblocks    │ │ Private S3 Store  │
        │ Server Actions & APIs │ │ Cloud Relay   │ │ (AWS S3 / R2)     │
        └───────────┬───────────┘ └───────────────┘ └───────────────────┘
                    │
                    ▼ (Prisma ORM)
        ┌───────────────────────┐
        │  Managed PostgreSQL   │
        │  (Neon / Supabase)    │
        └───────────────────────┘
```

- **Hosting & Compute:** Vercel (or Node.js server container) running Next.js App Router.
- **Database:** Managed PostgreSQL (16+) with connection pooling (e.g. Neon, Supabase, or AWS RDS).
- **Multiplayer CRDT Relay:** Liveblocks Cloud for WebSocket room synchronization, awareness, and presence.
- **Object Storage:** Private AWS S3, Cloudflare R2, or MinIO with Block Public Access and TLS.
- **Authentication:** Better Auth with encrypted session cookies and strict build-secret isolation.

---

## 3. Environment Variable Inventory

| Variable | Purpose | Status | Required In | Build Time vs Runtime | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string | **Required** | All | Runtime | Use connection pooler URL in production with `?sslmode=require` |
| `BETTER_AUTH_SECRET` | 32+ char key for session encryption | **Required** | Production | Runtime | Never required at build time. Build generates ephemeral in-memory keys |
| `BETTER_AUTH_URL` | Canonical application base URL | **Required** | Production | Runtime | E.g. `https://syncspace.dev` |
| `NEXT_PUBLIC_APP_URL`| Public client base URL | **Required** | All | Build & Runtime | E.g. `https://syncspace.dev` or `http://localhost:3000` |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Comma-separated allowed CORS origins | Optional | Production | Runtime | E.g. `https://syncspace.dev,https://*.vercel.app` |
| `LIVEBLOCKS_SECRET_KEY` | Server secret key (`sk_...`) | **Required** | Production | Runtime | Never expose to browser; used only by `/api/liveblocks-auth` |
| `STORAGE_PROVIDER` | Object storage backend | **Required** | All | Runtime | Set to `"s3"` in production, `"local"` for local dev |
| `S3_BUCKET_NAME` | Private S3 bucket name | **Required** (if s3)| Production | Runtime | Dedicated bucket with Block Public Access enabled |
| `S3_REGION` | AWS region (e.g. `us-east-1`) | **Required** (if s3)| Production | Runtime | Bucket region |
| `S3_ENDPOINT` | Custom endpoint (MinIO / R2) | Optional | Production | Runtime | Omit for standard AWS S3 |
| `S3_ACCESS_KEY_ID` | IAM access key ID | **Required** (if s3)| Production | Runtime | Scoped IAM user with PutObject, GetObject, DeleteObject |
| `S3_SECRET_ACCESS_KEY` | IAM secret access key | **Required** (if s3)| Production | Runtime | Keep secure; never commit |
| `S3_FORCE_PATH_STYLE` | Path-style URL toggle | Optional | Local / MinIO | Runtime | Set `true` for MinIO, `false` for AWS S3 |
| `LOCAL_STORAGE_PATH` | Local attachments directory | Optional | Local Dev Only | Runtime | Defaults to `.storage/attachments` |

---

## 4. Local Development Setup

### Prerequisites
- Node.js 20+ (LTS recommended)
- Docker Desktop (for local PostgreSQL)
- npm 10+

### Step-by-Step Instructions
1. **Clone the repository:**
   ```bash
   git clone https://github.com/Sunil-nagrale/Syncspace.git
   cd syncspace
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure local environment:**
   ```bash
   cp .env.example .env.local
   ```

4. **Start local PostgreSQL (via Docker):**
   ```bash
   docker run --name syncspace-postgres -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=syncspace -p 5432:5432 -d postgres:16-alpine
   ```

5. **Apply database migrations:**
   ```bash
   npm run db:status
   npm run migrate:deploy
   ```

6. **Start development server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 5. Production Deployment Guide

### Deployment Architecture: Vercel + Neon + AWS S3 + Liveblocks
This stack is recommended because Next.js 15 App Router runs natively on Vercel with zero cold-start routing overhead, Neon provides serverless autoscaling PostgreSQL with instant connection pooling, S3 provides 99.999999999% durable private storage, and Liveblocks delivers sub-50ms WebSocket multiplayer state synchronization.

### 1. Database Provisioning (Neon / Supabase)
1. Create a PostgreSQL 16 database instance.
2. Retrieve the pooled connection string (with `?sslmode=require`).
3. Run migrations against the production database:
   ```bash
   DATABASE_URL="postgresql://...pooler...?sslmode=require" npx prisma migrate deploy
   ```

### 2. Private Object Storage Provisioning (AWS S3)
1. Create a dedicated S3 bucket: `syncspace-attachments-prod`.
2. **Enable Block all public access** (all 4 settings ON).
3. **Enable Default Encryption** (Amazon S3 managed SSE-S3 or AWS KMS).
4. **Configure CORS:**
   ```json
   [
     {
       "AllowedHeaders": ["*"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedOrigins": ["https://syncspace.dev"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
5. **Configure Lifecycle Rules:** Add an expiration rule on prefix `workspaces/*/artifacts/*/staging/` to automatically delete abandoned staging uploads older than 1 day.
6. **IAM Policy:** Grant an IAM user access strictly to the bucket:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
         "Resource": "arn:aws:s3:::syncspace-attachments-prod/*"
       }
     ]
   }
   ```

### 3. Liveblocks Setup
1. Create a project at [Liveblocks Dashboard](https://liveblocks.io).
2. Copy the **Secret Key** (`sk_prod_...`).
3. Set `LIVEBLOCKS_SECRET_KEY` in production environment variables.

### 4. Vercel Deployment
1. Import the repository into Vercel.
2. In Project Settings &rarr; Environment Variables, add all required production variables:
   - `DATABASE_URL`
   - `BETTER_AUTH_SECRET` (`openssl rand -base64 32`)
   - `BETTER_AUTH_URL` (`https://your-domain.com`)
   - `NEXT_PUBLIC_APP_URL` (`https://your-domain.com`)
   - `BETTER_AUTH_TRUSTED_ORIGINS` (`https://your-domain.com`)
   - `LIVEBLOCKS_SECRET_KEY` (`sk_prod_...`)
   - `STORAGE_PROVIDER` (`s3`)
   - `S3_BUCKET_NAME`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
3. Deploy. Vercel automatically runs `npx prisma generate && next build`.
4. Verify deployment health at `https://your-domain.com/api/health`.

### 5. Rollback Procedure
- **Application Rollback:** In Vercel, select the previous stable deployment and click **Promote to Production** for instant zero-downtime rollback.
- **Database Schema Rollback:** Schema migrations in `prisma/migrations/` are strictly additive and backward-compatible. If an emergency schema revert is needed, generate a migration down-script and apply via `npx prisma migrate deploy`.

---

## 6. Testing & Quality Verification

SyncSpace enforces 8 quality gates across the entire application stack:

```bash
# 1. Database migration verification
npm run db:status

# 2. Code linting
npm run lint

# 3. TypeScript typecheck
npx tsc --noEmit

# 4. Unit tests (Vitest)
npm run test

# 5. Integration tests (PostgreSQL + Better Auth)
npm run test:integration

# 6. Production build compilation
npm run build

# 7. End-to-end browser tests (Playwright)
npx playwright test

# 8. Dependency vulnerability audit
npm audit --omit=dev
```

---

## 7. Known Limitations & Operational Considerations

1. **In-Memory Rate Limiter:** The default Better Auth rate limiter runs in Node process memory. In serverless multi-region deployments (e.g. Vercel Edge/Serverless Lambdas), limits are enforced per-instance rather than globally distributed. For enterprise high-scale abuse protection, configure Upstash Redis secondary storage.
2. **Liveblocks Free Tier Connection Limits:** Liveblocks free tier accommodates up to 20 concurrent connections. Production deployments with larger teams should upgrade to a Liveblocks Team/Pro plan.
3. **Local Storage in Serverless:** Local file storage (`STORAGE_PROVIDER=local`) is strictly intended for local developer workstations. Serverless environments have ephemeral filesystems; production environments must configure `STORAGE_PROVIDER=s3`.

---

## 8. Demonstration Checklist

To safely demonstrate SyncSpace without exposing real credentials:
1. Open [http://localhost:3000](http://localhost:3000) or your production domain.
2. Click **Enter Workspace** or navigate to `/login`.
3. Use the **Demo credentials** link to log in as `lead.architect@syncspace.dev`.
4. Open a second browser window (e.g. Incognito or separate profile) and register a second account (`staff.engineer@syncspace.dev`).
5. In Workspace Settings, invite the second user to the workspace.
6. Open a Collaborative Document in both windows: observe simultaneous character keystrokes, presence badges, and section anchors.
7. Open a Collaborative Whiteboard in both windows: draw shapes and observe real-time element synchronization without canvas conflicts.
8. Press `Cmd+K` / `Ctrl+K` to search across all documents and whiteboards instantly.
9. Verify attachment upload: upload a PDF or image, preview inline, and verify SHA-256 integrity download.
10. Check `/api/health` to demonstrate 200 OK service uptime.
