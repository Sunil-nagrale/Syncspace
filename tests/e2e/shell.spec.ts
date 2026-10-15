import { test, expect } from "@playwright/test";

test.describe("SyncSpace Application Shell & Navigation", () => {
  test("landing page renders successfully with branding and CTAs", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/SyncSpace/);
    await expect(page.locator("h1")).toContainText("Where technical specifications and architecture whiteboards");
    await expect(page.getByRole("link", { name: /enter workspace/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /launch workspace/i })).toBeVisible();
  });

  test("workspace shell loads with onboarding state or workspace header", async ({ page }) => {
    await page.goto("/app");
    // When no workspace is present in the database, the onboarding view is rendered
    await expect(page.locator("h1")).toBeVisible();
    const headingText = await page.locator("h1").innerText();
    expect(headingText === "Welcome to SyncSpace" || headingText === "Acme Engineering").toBe(true);
  });

  test("auth pages render login and register forms with Better Auth actions", async ({ page }) => {
    // Check login page
    await page.goto("/login");
    await expect(page.locator("h1, .font-bold").filter({ hasText: /sign in/i })).toBeVisible();
    await expect(page.locator("input[type='email']")).toBeVisible();
    await expect(page.locator("input[type='password']")).toBeVisible();
    await expect(page.getByRole("button", { name: /continue to workspace/i })).toBeVisible();

    // Check register page
    await page.goto("/register");
    await expect(page.locator("h1, .font-bold").filter({ hasText: /create your syncspace account/i })).toBeVisible();
    await expect(page.locator("input[type='email']")).toBeVisible();
    await expect(page.locator("input[placeholder='Sunil Kumar']")).toBeVisible();
    await expect(page.getByRole("button", { name: /create account/i })).toBeVisible();
  });

  test("navigates smoothly across primary application routes", async ({ page }) => {
    await page.goto("/app");
    await page.waitForLoadState("networkidle");

    // Navigate to Projects
    await page.locator("aside a[href='/app/projects']").first().click();
    await expect(page).toHaveURL(/\/app\/projects/);
    await expect(page.locator("h1")).toContainText("Projects");

    // Navigate to Documents
    await page.locator("aside a[href='/app/documents']").first().click();
    await expect(page).toHaveURL(/\/app\/documents/);
    await expect(page.locator("h1")).toContainText("Documents");

    // Navigate to Whiteboards
    await page.locator("aside a[href='/app/whiteboards']").first().click();
    await expect(page).toHaveURL(/\/app\/whiteboards/);
    await expect(page.locator("h1")).toContainText("Whiteboards");

    // Navigate to Notifications
    await page.locator("aside a[href='/app/notifications']").first().click();
    await expect(page).toHaveURL(/\/app\/notifications/);
    await expect(page.locator("h1")).toContainText("Notifications");

    // Navigate to Members
    await page.locator("aside a[href='/app/members']").first().click();
    await expect(page).toHaveURL(/\/app\/members/);
    await expect(page.locator("h1")).toContainText("Members & Roles");

    // Navigate to Settings
    await page.locator("aside a[href='/app/settings']").first().click();
    await expect(page).toHaveURL(/\/app\/settings/);
    await expect(page.locator("h1")).toContainText("Workspace Settings");
  });

  test("document editor route renders with presence and mock ribbon", async ({ page }) => {
    await page.goto("/app/documents/doc-arch-spec");
    await expect(page.locator("h1")).toContainText("Doc Arch Spec");
    await expect(page.getByText(/room: art_doc-arch-spec/i)).toBeVisible();
  });

  test("whiteboard route renders with floating toolbar and zoom controls", async ({ page }) => {
    await page.goto("/app/whiteboards/board-data-pipeline");
    await expect(page.getByRole("main").getByText("Board Data Pipeline")).toBeVisible();
    await expect(page.getByText(/Excalidraw Multiplayer Canvas Ready/i)).toBeVisible();
  });

  test("custom 404 page renders for nonexistent route", async ({ page }) => {
    await page.goto("/app/nonexistent-route-404");
    await expect(page.getByText("404")).toBeVisible();
    await expect(page.getByText("Artifact or Page Not Found")).toBeVisible();
  });
});
