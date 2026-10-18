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
This stack is recommended because Next.js 15 App Router runs natively on Vercel with zero cold-start routing overhead, Neon provides serverless autoscaling PostgreSQL with instant connection pooling, S3 provides durable private object storage, and Liveblocks delivers low-latency WebSocket multiplayer state synchronization.

### Repository Preparation Status vs. External Operator Actions
- **100% Prepared in Repository (Ready for Deployment):**
  - Next.js 15 App Router monolith with dynamic server routes and static pages.
  - Prisma ORM schema with 8 additive PostgreSQL migrations (`npm run migrate:deploy`).
  - Hardened Better Auth authentication with secure HTTPS cookies, dynamic trusted origins, and build-phase secret isolation.
  - Safe, non-destructive dependency readiness probe (`GET /api/health`).
  - Strict HTTP security headers in `vercel.json` and zero-leakage production bundles.
- **External Operator Actions Required (Needs Cloud Accounts & Explicit Operator Credentials):**
  1. Provision a Neon PostgreSQL 16 database and apply schema migrations.
  2. Create an AWS S3 bucket (or Cloudflare R2), configure CORS for the deployed origin, and create IAM credentials.
  3. Create a Liveblocks Cloud project and obtain the secret key (`LIVEBLOCKS_SECRET_KEY`).
  4. Link the repository to Vercel, populate production environment variables, and trigger the live deployment.

---

### 1. Database Provisioning (Neon / Supabase)
1. Create a PostgreSQL 16 database instance.
2. Retrieve the pooled connection string (with `?sslmode=require`).
3. Run migrations against the production database:
   ```bash
   DATABASE_URL="postgresql://...pooler...?sslmode=require" npx prisma migrate deploy
   ```

### 2. Private Object Storage Provisioning (AWS S3 / Cloudflare R2)
1. Create a dedicated private S3 bucket: `syncspace-attachments-prod`.
2. **Enable Block all public access** (all 4 settings ON).
3. **Enable Default Encryption** (Amazon S3 managed SSE-S3 or AWS KMS).
4. **Configure CORS:**
   Configure `AllowedOrigins` with the exact HTTPS origin(s) of your deployed Next.js application. Never use wildcard `*` in production.
   ```json
   [
     {
       "AllowedHeaders": ["*"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedOrigins": [
         "https://your-production-domain.com",
         "https://your-preview-domain.vercel.app"
       ],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
5. **Staging Upload Lifecycle & Abandoned Object Cleanup:**
   SyncSpace stages uploads using the structured key layout:
   - Staging uploads: `workspaces/{workspaceId}/artifacts/{artifactId}/staging/{uploadId}`
   - Promoted blobs: `workspaces/{workspaceId}/artifacts/{artifactId}/blobs/{blobId}`

   When uploads succeed, the backend promotes the verified bytes to the final `blobs/` key and immediately deletes the staging object. However, if an upload is initiated but abandoned before completion (e.g. browser tab closed mid-upload), the staging object remains in storage.

   *Important*: Amazon S3 Lifecycle rule prefixes only support literal leading string prefixes; wildcards or regex patterns are treated as literal characters and cannot match intermediate path segments. Because browser presigned uploads do not attach tags:
   - Abandoned staging uploads are **not** automatically cleaned up by bucket-level S3 lifecycle rules.
   - **Recommended Operational Solution (Scheduled Cleaner):** Configure an AWS EventBridge rule to invoke a periodic cleanup script or AWS Lambda once daily to sweep and delete objects containing `/staging/` older than 24 hours.
   - **Alternative Solution (Dedicated Staging Bucket):** In environments requiring native S3 lifecycle rules without custom cleaner functions, route temporary staging uploads to a dedicated staging bucket with a standard 1-day bucket-wide expiration rule.

6. **Health Check Marker Object Provisioning:**
   SyncSpace's production readiness probe (`GET /api/health`) verifies storage connectivity using a deterministic read check on a known health-marker key (`workspaces/health/artifacts/probe/blobs/marker`).
   This allows the probe to operate under least-privilege IAM permissions: the application only requires `s3:GetObject` on object keys, without granting broad bucket listing (`s3:ListBucket`).

   To provision the initial marker object during bucket setup:
   ```bash
   aws s3api put-object \
     --bucket syncspace-attachments-prod \
     --key workspaces/health/artifacts/probe/blobs/marker \
     --body - <<< "syncspace-health-marker"
   ```
   Or upload a small file named `marker` into `workspaces/health/artifacts/probe/blobs/` via the AWS S3 Console.

7. **IAM Policy:** Grant an IAM user least-privilege access strictly to the bucket objects:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "SyncSpaceObjectAccess",
         "Effect": "Allow",
         "Action": [
           "s3:PutObject",
           "s3:GetObject",
           "s3:DeleteObject"
         ],
         "Resource": "arn:aws:s3:::syncspace-attachments-prod/*"
       }
     ]
   }
   ```
   *Security Note*: With the provisioned health marker in place, the application only requires `s3:GetObject` to confirm connectivity via `HeadObject`. No broad `s3:ListBucket` permission is granted or required.

### 3. Liveblocks Setup
1. Create a project at [Liveblocks Dashboard](https://liveblocks.io).
2. Copy the **Secret Key** (`sk_prod_...`).
3. Set `LIVEBLOCKS_SECRET_KEY` in production environment variables.

### 4. Vercel Deployment
1. Import the repository into Vercel.
2. In Project Settings &rarr; Environment Variables, add all required production variables:
   - `DATABASE_URL` (pooled connection string)
   - `DIRECT_URL` (direct connection string for schema migrations)
   - `BETTER_AUTH_SECRET` (generate via `openssl rand -base64 32`)
   - `BETTER_AUTH_URL` (`https://your-production-domain.com`)
   - `NEXT_PUBLIC_APP_URL` (`https://your-production-domain.com`)
   - `BETTER_AUTH_TRUSTED_ORIGINS` (`https://your-production-domain.com,https://your-preview-domain.vercel.app`)
   - `LIVEBLOCKS_SECRET_KEY` (`sk_prod_...`)
   - `STORAGE_PROVIDER` (`s3`)
   - `S3_BUCKET_NAME`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
3. Deploy. Vercel automatically runs `npm run build`.
4. Verify deployment health at `https://your-production-domain.com/api/health`.

### 5. Production Readiness & Security Enforcement
- **Strict Production Mode Across All Hosts:** `NODE_ENV === "production"` strictly enforces production safeguards across all deployment targets—including managed platforms (Vercel, AWS), self-hosted Docker containers, and bare VPS servers. Localhost URLs (`NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_URL`) and accidental test flags (`SYNCSPACE_TEST_LOCAL_MODE`, `ALLOW_LOCAL_STORAGE_IN_TEST`, `SYNCSPACE_LOCAL_TEST_RUNNER`, `PLAYWRIGHT`) can **never** weaken production enforcement or authorize local file storage when `NODE_ENV === "production"`. Missing required production dependencies (database, S3, or Liveblocks) strictly fail closed with HTTP 503.
- **Platform Deployment Indicators:** On managed cloud platforms (such as Vercel via `VERCEL=1` / `VERCEL_ENV`, AWS, Render, Fly, Railway), production safeguards and S3 storage requirements are enforced unconditionally.
- **Isolated Local Test Harness:** Legitimate local test runners (Playwright E2E and Vitest) run with `NODE_ENV="test"` alongside explicit runner markers (`SYNCSPACE_LOCAL_TEST_RUNNER=true`, `PLAYWRIGHT=1`) and opt-in flags. This allows local file storage and mock modes during automated tests without weakening production runtime security. Setting `SYNCSPACE_STRICT_PRODUCTION=true` unconditionally overrides all test flags.

### 6. Rollback Procedure
- **Application Rollback:** In Vercel, select the previous stable deployment and click **Promote to Production** for instant zero-downtime rollback.
- **Database Schema Rollback:** Schema migrations in `prisma/migrations/` are strictly additive and backward-compatible. If an emergency schema revert is needed, generate a migration down-script and apply via `npx prisma migrate deploy`.

---

## 7. Testing & Quality Verification

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

To safely evaluate and demonstrate SyncSpace across environments:

### Environment Credentials & Demo Account Policy
- **Fresh Production Deployments:** A fresh production database contains **no pre-existing accounts**. Demo credential autofill is strictly disabled by default (`NODE_ENV === "production"`) to protect production environments from shared credentials. In production, register your initial administrator account directly via `/register`.
- **Local Development & Staging Instances:** In local development (`NODE_ENV !== "production"`), the login screen provides a convenience autofill helper (`Development autofill: lead.architect@syncspace.dev`) populated when developing against the seeded local database. For dedicated demo deployments, autofill can be enabled explicitly by configuring `NEXT_PUBLIC_ENABLE_DEMO_LOGIN="true"`.

### Guided Demonstration Steps
1. **Access Application:** Open `http://localhost:3000` (local dev) or your deployed production domain.
2. **Account Sign-in / Registration:**
   - In local dev: Click **Development autofill** on `/login` to sign in as `lead.architect@syncspace.dev`, or register a new user.
   - In production: Click **Create an account** (`/register`) to register your primary user account.
3. **Multi-User Real-Time Sync:**
   - Open a second browser window (e.g., Incognito or a separate browser profile) and register a collaborator account (`staff.engineer@...`).
   - In Workspace Settings (`/app/settings`), invite the second user to the workspace.
4. **Collaborative Document Editing:**
   - Open the same document in both windows simultaneously.
   - Observe live character keystrokes, collaborator presence indicators, and document outline navigation.
5. **Collaborative Whiteboard Canvas:**
   - Open the same whiteboard in both windows.
   - Draw shapes, add text nodes, and observe instant CRDT element synchronization without canvas state conflicts.
6. **Unified Search & Command Palette:**
   - Press `Cmd+K` / `Ctrl+K` to search across all documents, whiteboards, and projects with instant keyboard navigation.
7. **Attachment Storage & Integrity:**
   - In any document or whiteboard, upload an attachment (PDF, image, or text file).
   - Verify inline preview and download with verified SHA-256 integrity checks.
8. **Dependency Readiness Probe:**
   - Request `GET /api/health` to confirm overall status `200 OK` (`healthy` or `degraded` in dev).
