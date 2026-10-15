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

### Step 2: Configure Environment Variables
Copy the template configuration file:
```powershell
cp .env.example .env.local
```

Edit `.env.local` to configure placeholder values. For Phase 3 (Foundation and UI Shell), external service credentials (Liveblocks, PostgreSQL, S3) are not strictly required to preview the shell.

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

### End-to-End Testing (Playwright)
```powershell
# Ensure Playwright browser binaries are installed
npx.cmd playwright install chromium

# Run tests
npm.cmd run test:e2e
```

### Production Build
```powershell
npm.cmd run build
```

---

## 5. Troubleshooting & FAQ

1. **Hydration Warning in Browser Console**:
   - `next-themes` applies `dark` class to `<html>` tags dynamically. The root `<html>` element includes `suppressHydrationWarning` in `src/app/layout.tsx` to handle theme attribute synchronization cleanly.
2. **Path Aliases Not Resolving**:
   - Verify that `tsconfig.json` has `"paths": { "@/*": ["./src/*"] }` and that the file is saved.
3. **Playwright Fails to Connect to WebServer**:
   - If port 3000 is occupied, set `PORT=3001` or run the dev server independently before running `npm.cmd run test:e2e`.
