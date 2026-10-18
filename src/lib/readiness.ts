/**
 * SyncSpace Production Readiness & Environment Evaluation
 *
 * Evaluates whether the application is operating under strict production readiness requirements.
 *
 * CONTRACT & RULES:
 * 1. Default to Production:
 *    - `NODE_ENV === "production"` is treated as production by default.
 * 2. Never Weaken Production Based on URLs:
 *    - Application URLs pointing to localhost (`NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_URL`)
 *      must NEVER cause the application to infer non-production mode or permit insecure fallbacks.
 * 3. Strict Production Override:
 *    - `SYNCSPACE_STRICT_PRODUCTION === "true"` unconditionally enforces production mode.
 * 4. Explicit Test-Only Opt-In:
 *    - `SYNCSPACE_TEST_LOCAL_MODE === "true"` (aliasing `ALLOW_LOCAL_STORAGE_IN_TEST === "true"`)
 *      allows local test runners (e.g. Playwright testing a local production build via `npm run start`)
 *      to permit local disk storage or degraded collaboration status when external services are unconfigured.
 *    - This flag is strictly ignored if `SYNCSPACE_STRICT_PRODUCTION === "true"`.
 *    - In real production deployments, this flag must never be configured.
 */

export function isProductionEnvironment(
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.SYNCSPACE_STRICT_PRODUCTION === "true") {
    return true;
  }

  const isExplicitTestOptIn =
    env.SYNCSPACE_TEST_LOCAL_MODE === "true" ||
    env.ALLOW_LOCAL_STORAGE_IN_TEST === "true";

  if (isExplicitTestOptIn) {
    return false;
  }

  return env.NODE_ENV === "production";
}
