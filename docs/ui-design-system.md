# SyncSpace — UI & Visual Design System

## 1. Visual Identity & Aesthetic Philosophy

SyncSpace is designed for high-focus engineering, design, and product craftsmanship. It combines:
- **Notion**: Document-centric simplicity, clear hierarchy, and uncluttered writing surfaces.
- **Linear**: High keyboard efficiency, subtle borders, crisp monochromatic contrast, and fluid micro-interactions.
- **Figma**: Multi-user awareness, live collaborator cursor badges, and frictionless sharing drawers.
- **Excalidraw**: Unobtrusive canvas chrome, hand-drawn authenticity, and frictionless toolbars.

The visual design avoids gratuitous 3D skeuomorphism, garish gradients, and nonfunctional decoration in favor of typographic precision, generous breathing room, and deterministic component feedback.

---

## 2. Design Tokens

### 2.1 Color Palette & Themes

SyncSpace uses a semantic design token architecture mapped to CSS variables for instant, flicker-free light and dark theme switching.

| Token | Light Theme Value | Dark Theme Value | Purpose |
| :--- | :--- | :--- | :--- |
| `--background` | `hsl(0, 0%, 100%)` (#FFFFFF) | `hsl(240, 10%, 4%)` (#09090B) | Canvas & page backdrop |
| `--foreground` | `hsl(240, 10%, 4%)` (#09090B) | `hsl(0, 0%, 98%)` (#FAFAFA) | Primary headings & body copy |
| `--card` | `hsl(0, 0%, 100%)` (#FFFFFF) | `hsl(240, 10%, 6%)` (#101014) | Elevated cards, dialog surfaces |
| `--muted` | `hsl(240, 5%, 96%)` (#F4F4F5) | `hsl(240, 5%, 15%)` (#27272A) | Sidebar backgrounds, disabled states |
| `--muted-foreground` | `hsl(240, 4%, 46%)` (#71717A) | `hsl(240, 5%, 65%)` (#A1A1AA) | Secondary text, captions, timestamps |
| `--border` | `hsl(240, 6%, 90%)` (#E4E4E7) | `hsl(240, 4%, 18%)` (#2E2E33) | Subtle 1px dividing lines |
| `--primary` | `hsl(240, 6%, 10%)` (#18181B) | `hsl(0, 0%, 98%)` (#FAFAFA) | Primary CTAs, active pills |
| `--primary-foreground`| `hsl(0, 0%, 98%)` (#FAFAFA) | `hsl(240, 6%, 10%)` (#18181B) | Inverted text on primary buttons |
| `--accent` | `hsl(240, 5%, 94%)` (#F1F1F4) | `hsl(240, 4%, 16%)` (#28282D) | Hover states on list rows and buttons |
| `--brand-indigo` | `hsl(243, 75%, 59%)` (#4F46E5) | `hsl(243, 85%, 68%)` (#818CF8) | Sync indicators, active cursors, links |
| `--destructive` | `hsl(0, 84%, 60%)` (#EF4444) | `hsl(0, 63%, 31%)` (#7F1D1D) | Deletion alerts, danger actions |

#### Collaborator Presence Colors
Each collaborator is deterministically assigned one of eight high-contrast presence colors for cursor flags, selection highlights, and avatar rings:
- Coral: `#F43F5E`
- Orange: `#F97316`
- Amber: `#F59E0B`
- Emerald: `#10B981`
- Teal: `#14B8A6`
- Blue: `#3B82F6`
- Violet: `#8B5CF6`
- Fuchsia: `#D946EF`

---

### 2.2 Typography

SyncSpace utilizes the **Inter** or **Geist Sans** font stack with monospace fallback for code blocks:

- **Font Family**: `var(--font-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- **Monospace Family**: `var(--font-mono), "JetBrains Mono", Menlo, Consolas, monospace`
- **Scale**:
  - `Display / H1`: `2.25rem` (36px), Line-height: `2.5rem`, Weight: 700, Tracking: `-0.025em`
  - `Page Title / H2`: `1.75rem` (28px), Line-height: `2.125rem`, Weight: 600, Tracking: `-0.02em`
  - `Section / H3`: `1.375rem` (22px), Line-height: `1.75rem`, Weight: 600, Tracking: `-0.015em`
  - `Body Regular`: `0.9375rem` (15px), Line-height: `1.5rem`, Weight: 400
  - `Body Medium`: `0.9375rem` (15px), Line-height: `1.5rem`, Weight: 500
  - `Caption / Small`: `0.8125rem` (13px), Line-height: `1.125rem`, Weight: 400
  - `Micro / Badge`: `0.75rem` (12px), Line-height: `1rem`, Weight: 600, Tracking: `0.02em`

---

### 2.3 Spacing, Borders & Shadows

- **Grid Base**: 4px standard grid increments (`4px`, `8px`, `12px`, `16px`, `20px`, `24px`, `32px`, `48px`, `64px`).
- **Corner Radii**:
  - Small (badges, tags): `4px` (`rounded-sm`)
  - Medium (buttons, input fields): `6px` (`rounded-md`)
  - Large (dialogs, cards, popovers): `8px` (`rounded-lg`)
  - Extra Large (modals, drawers): `12px` (`rounded-xl`)
- **Borders & Dividers**: Crisp `1px solid var(--border)` with zero blur.
- **Shadows**:
  - Subtle (`shadow-sm`): `0 1px 2px 0 rgb(0 0 0 / 0.05)`
  - Elevated popover (`shadow-md`): `0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)`
  - Modal overlay (`shadow-xl`): `0 20px 25px -5px rgb(0 0 0 / 0.2)`

---

## 3. Component Conventions & States

Every interactive element in SyncSpace must exhibit five explicit states:
1. **Default**: Clear contrast meeting WCAG AA standards (minimum 4.5:1 ratio).
2. **Hover**: Subtle background tint (`var(--accent)`) with 150ms ease transition.
3. **Focus-Visible**: 2px high-visibility focus ring (`ring-2 ring-primary ring-offset-2`).
4. **Active / Pressed**: Subtle scale reduction (`active:scale-[0.98]`).
5. **Disabled**: Opacity reduced to `50%`, `cursor: not-allowed`, pointer events intercepted.
6. **Loading**: Replaced with animated spinner or pulse skeleton; controls disabled to prevent double-submit.

---

## 4. Screen Layouts & Specifications

### 4.1 Shell Architecture
```
+-----------------------------------------------------------------------------------------+
| [Workspace Switcher v]   [Project / Doc Breadcrumb]      (Search Cmd+K)  [Avatars] [Share] [Bell] [Profile]|
+----------------------+------------------------------------------------------------------+
| Collapsible Sidebar  | Main Content Canvas                                              |
|                      |                                                                  |
| - Quick Search       |                                                                  |
| - Recent Docs        |                                                                  |
| - Projects           |                                                                  |
|   v Sprint 42        |                                                                  |
|     - Arch Diagram   |                                                                  |
|     - API Spec       |                                                                  |
| - Whiteboards        |                                                                  |
| - Trash & Archive    |                                                                  |
|                      |                                                                  |
| [Settings] [Members] |                                                                  |
+----------------------+------------------------------------------------------------------+
```

### 4.2 Detailed Screen Layouts (16 Screens)

1. **Landing Page**: Minimalist dark-themed marketing landing showcasing dual real-time document and whiteboard capabilities, interactive feature carousel, and CTA buttons ("Get Started", "Live Demo").
2. **Sign-In & Registration**: Split-screen card layout with passwordless or credential inputs, OAuth buttons, and terms notice.
3. **Onboarding**: Step-by-step modal wizard collecting workspace name, team size, primary role, and auto-provisioning a starter workspace with demo templates.
4. **Workspace Dashboard**: Summary view with "Jump back in" recent cards, activity stream ticker, pinned team documents, and quick-create action buttons ("New Document", "New Whiteboard").
5. **Project View**: Grid or list view of all artifacts within a project with filter pills (All, Documents, Whiteboards), sorting by last modified, and project members list.
6. **Documents List**: Filterable table view of rich-text documents with author avatar, last edited timestamp, tag pills, and contextual three-dot action menu.
7. **Whiteboards List**: Thumbnail card gallery showing rendered scene previews, active collaborator badges, and creation dates.
8. **Document Editor**:
   - Clean, centered document container (max-width: 820px).
   - Document title input with auto-save indicator.
   - Floating bubble menu upon text selection (Bold, Italic, Link, Heading, Comment).
   - Slash command (`/`) popover menu appearing directly beneath the cursor.
   - Collaborator cursors with animated name badges.
   - Contextual right-side collapsible comment rail.
9. **Whiteboard Editor**:
   - Full viewport edge-to-edge canvas running Excalidraw.
   - Floating header with room status ("Connected", "Saving...", "Offline"), collaborator avatars, and Export action.
   - Bottom-left zoom percentage and minimap controls.
   - Bottom-right comment pin button.
10. **Sharing Dialog**: Centered modal with search field to invite workspace members, permission dropdown selector (Editor vs Viewer), copy invite link button, and list of current users with access overrides.
11. **Comment Panel**: Slide-over right drawer displaying active and resolved discussion threads, reply composer, and unread highlight dots.
12. **Notifications Inbox**: Popover panel triggered from header bell showing grouped notifications (Mentions, Comment replies, Invites) with one-click "Mark all as read" and deep navigation links.
13. **Search & Command Palette (`Cmd+K`)**: Modal dialog with fuzzy search input, categorized results (Recent, Documents, Whiteboards, Projects, Actions), and arrow-key keyboard navigation.
14. **Member Management**: Table of workspace users with avatar, email, join date, role selector dropdown (Owner, Admin, Editor, Viewer), and "Revoke Access" action.
15. **Workspace Settings**: Tabbed view with General Settings (Name, Slug, Logo), Export Workspace, and Danger Zone (Delete Workspace).
16. **User Profile & Preferences**: Profile settings tab (Name, Email, Avatar upload, assigned Collaborator Color) and Appearance tab (Light, Dark, System theme toggle).
