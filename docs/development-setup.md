# SyncSpace — Local Development Setup & Engineering Guide

## 1. Prerequisites & Environment

SyncSpace is engineered on a modern JavaScript/TypeScript stack. Ensure the following environment requirements are met before running the application:

- **Operating System**: Windows 10/11, macOS, or Linux.
- **Node.js**: `v24.15.0` or higher (LTS / Current release).
- **Package Manager**: `npm` `v11.x` (installed with Node.js).
- **Git**: `v2.40+`

---

## 2. Windows-Specific CLI Guidelines

On Windows machines with PowerShell execution policy restrictions, executing `.ps1` wrapper scripts (such as `npm.ps1` or `npx.ps1`) may result in `PSSecurityException: UnauthorizedAccess`.

### Recommended Execution Pattern
Always invoke `npm.cmd` and `npx.cmd` explicitly in PowerShell:

```powershell
# Install dependencies
npm.cmd install

# Start local Next.js development server
npm.cmd run dev

# Run Vitest unit & integration test suite
npm.cmd run test

# Run Playwright E2E browser test suite
npm.cmd run test:e2e

# Run Next.js production build
npm.cmd run build
```

Alternatively, bypass execution policy for your current PowerShell session:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

---

## 3. Installation & Getting Started

### Step 1: Clone Repository & Install Dependencies
```powershell
git clone <repository_url> d:\syncspace
cd d:\syncspace
npm.cmd install
```

### Step 2: Configure Environment Variables & PostgreSQL
Copy the template configuration file:
```powershell
cp .env.example .env
```

1. **PostgreSQL Database (`DATABASE_URL`)**:
   Ensure the `syncspace-postgres` Docker container is running on port `5432` and migrations are applied:
   ```powershell
   npx.cmd prisma migrate status
   ```
2. **Liveblocks Real-Time Collaboration (`LIVEBLOCKS_SECRET_KEY`)**:
   - Retrieve your server secret key (`sk_dev_...` or `sk_prod_...`) from [https://liveblocks.io/dashboard/apikeys](https://liveblocks.io/dashboard/apikeys).
   - Set `LIVEBLOCKS_SECRET_KEY=sk_dev_...` in `.env` (server-only; never expose in `NEXT_PUBLIC_*`).
   - If `LIVEBLOCKS_SECRET_KEY` is left as the placeholder `sk_dev_placeholder_liveblocks_secret_key`, `/api/liveblocks-auth` returns `503 Service Unavailable` after completing PostgreSQL RBAC checks, and the document editor operates in local PostgreSQL snapshot mode with an explicit configuration banner.

### Step 3: Run the Development Server
```powershell
npm.cmd run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser:
- **Landing Page**: [http://localhost:3000](http://localhost:3000)
- **Workspace Dashboard**: [http://localhost:3000/app](http://localhost:3000/app)
- **Projects Directory**: [http://localhost:3000/app/projects](http://localhost:3000/app/projects)
- **Documents Directory**: [http://localhost:3000/app/documents](http://localhost:3000/app/documents)
- **Whiteboards Gallery**: [http://localhost:3000/app/whiteboards](http://localhost:3000/app/whiteboards)
- **Notifications**: [http://localhost:3000/app/notifications](http://localhost:3000/app/notifications)
- **Members**: [http://localhost:3000/app/members](http://localhost:3000/app/members)
- **Settings**: [http://localhost:3000/app/settings](http://localhost:3000/app/settings)
- **Profile**: [http://localhost:3000/app/profile](http://localhost:3000/app/profile)
- **Sign In**: [http://localhost:3000/login](http://localhost:3000/login)
- **Sign Up**: [http://localhost:3000/register](http://localhost:3000/register)

---

## 4. Quality Verification Commands

### Linting
```powershell
npm.cmd run lint
```

### Type Checking
```powershell
npx.cmd tsc --noEmit
```

### Unit & Component Testing (Vitest)
```powershell
npm.cmd run test
```

### Integration Testing (Real PostgreSQL)
```powershell
# Runs database persistence, RBAC overrides, and invitation lifecycle suites against localhost:5432
npm.cmd run test:integration
```

### End-to-End Testing (Playwright)
```powershell
# Ensure Playwright browser binaries are installed
npx.cmd playwright install chromium

# Run all E2E suites
npm.cmd run test:e2e

# Run targeted E2E suites
npx.cmd playwright test tests/e2e/invitations-and-sharing.spec.ts
npx.cmd playwright test tests/e2e/collaborative-whiteboards.spec.ts
npx.cmd playwright test tests/e2e/collaborative-documents.spec.ts
npx.cmd playwright test tests/e2e/version-history.spec.ts
npx.cmd playwright test tests/e2e/attachments.spec.ts
npx.cmd playwright test tests/e2e/auth-and-workspaces.spec.ts
```

### Production Build
```powershell
npm.cmd run build
```

---

## 5. Private Object Storage Setup (Phase 9B)

SyncSpace supports three storage providers via `STORAGE_PROVIDER`:
- **Local Development (`STORAGE_PROVIDER=local`)**: Stores private attachment blobs in `.storage/attachments` (outside `public/`). No cloud credentials are required for local development.
- **Automated Tests (`STORAGE_PROVIDER=memory`)**: Uses `InMemoryStorageProvider` with fault-injection capabilities for unit and integration tests.
- **Production Deployment (`STORAGE_PROVIDER=s3`)**: Requires private S3-compatible storage (`S3_BUCKET_NAME`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`). Production builds fail closed if S3 is not properly configured.

---

## 6. Transactional Email Delivery Setup (Optional)

When no transactional email provider is configured, SyncSpace automatically operates in **Secure Copyable Link Mode**:
- Workspace administrators receive an encrypted, copyable invitation link upon invitation generation.
- The UI clearly labels email delivery as unavailable and does not produce misleading "Email sent" messages.

To enable automated transactional email delivery in production or staging, configure an email provider in `.env`:

```env
# Resend Email Delivery (Recommended)
RESEND_API_KEY=re_your_api_key_here
EMAIL_FROM=SyncSpace <invitations@yourdomain.com>

# Or SMTP Gateway
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=your_smtp_password
SMTP_FROM=invitations@yourdomain.com
```


---

## 7. Troubleshooting & FAQ

1. **Hydration Warning in Browser Console**:
   - `next-themes` applies `dark` class to `<html>` tags dynamically. The root `<html>` element includes `suppressHydrationWarning` in `src/app/layout.tsx` to handle theme attribute synchronization cleanly.
2. **Path Aliases Not Resolving**:
   - Verify that `tsconfig.json` has `"paths": { "@/*": ["./src/*"] }` and that the file is saved.
3. **Playwright Fails to Connect to WebServer**:
   - If port 3000 is occupied, set `PORT=3001` or run the dev server independently before running `npm.cmd run test:e2e`.
