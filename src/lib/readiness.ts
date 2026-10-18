/**
 * SyncSpace Production Readiness & Environment Evaluation
 *
 * Evaluates whether the application is operating under strict production readiness requirements.
 *
 * CONTRACT & RULES:
 * 1. Default to Production:
 *    - `NODE_ENV === "production"` unconditionally enforces production safeguards across ALL hosts,
 *      including self-hosted Docker, VPS, bare metal, and unrecognized deployment platforms.
 *    - In production (`NODE_ENV === "production"`), test-runner markers and local test opt-in flags
 *      are strictly ignored and can NEVER weaken production safeguards or authorize insecure fallbacks.
 * 2. Unconditional Production on Deployed Platforms:
 *    - If running on Vercel or any managed cloud deployment platform, production safeguards
 *      are strictly enforced regardless of any environment variables.
 * 3. Never Weaken Production Based on URLs:
 *    - Application URLs pointing to localhost (`NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_URL`)
 *      must NEVER cause the application to infer non-production mode or permit insecure fallbacks.
 * 4. Strict Production Override:
 *    - `SYNCSPACE_STRICT_PRODUCTION === "true"` unconditionally enforces production mode.
 * 5. Isolated Local Test Environment:
 *    - An environment is ONLY recognized as a local test environment (`isLocalTestEnvironment(env)`)
 *      when `NODE_ENV !== "production"`, `!isDeployedPlatform(env)`, `SYNCSPACE_STRICT_PRODUCTION !== "true"`,
 *      and both a test-runner marker and a local test opt-in flag are present.
 */

/**
 * Detects whether the current environment is running on a managed cloud deployment platform.
 *
 * Platforms recognized:
 * - Vercel (primary recommended deployment target): VERCEL === "1", VERCEL_ENV
 * - AWS (ECS, Lambda, Amplify): AWS_EXECUTION_ENV, AWS_LAMBDA_FUNCTION_NAME
 * - Cloud container platforms: RENDER, FLY_APP_NAME, RAILWAY_ENVIRONMENT, DYNO (Heroku),
 *   KUBERNETES_SERVICE_HOST, NETLIFY
 */
export function isDeployedPlatform(
  env: Record<string, string | undefined> = process.env
): boolean {
  return Boolean(
    env.VERCEL === "1" ||
      env.VERCEL_ENV === "production" ||
      env.VERCEL_ENV === "preview" ||
      env.AWS_EXECUTION_ENV ||
      env.AWS_LAMBDA_FUNCTION_NAME ||
      env.RENDER === "true" ||
      env.FLY_APP_NAME ||
      env.RAILWAY_ENVIRONMENT ||
      env.DYNO ||
      env.KUBERNETES_SERVICE_HOST ||
      env.NETLIFY === "true"
  );
}

/**
 * Detects whether the current environment is a verified, isolated local test runner.
 *
 * Test overrides are only permissible when running under a recognized local test harness
 * (Playwright E2E or Vitest unit/integration tests) with NODE_ENV !== "production"
 * and NEVER on a deployed platform or production host.
 */
export function isLocalTestEnvironment(
  env: Record<string, string | undefined> = process.env
): boolean {
  // Deployed cloud platforms are NEVER local test environments
  if (isDeployedPlatform(env)) {
    return false;
  }

  // Explicit strict production overrides any test environment claims
  if (env.SYNCSPACE_STRICT_PRODUCTION === "true") {
    return false;
  }

  // Production runtime (NODE_ENV === "production") is NEVER a local test environment,
  // even if test flags were accidentally configured on a bare server or self-hosted Docker/VPS.
  if (env.NODE_ENV === "production") {
    return false;
  }

  const hasTestRunnerMarker = Boolean(
    env.SYNCSPACE_LOCAL_TEST_RUNNER === "true" ||
      env.PLAYWRIGHT === "1" ||
      env.PLAYWRIGHT_TEST === "1" ||
      env.VITEST === "true"
  );

  const hasTestOptInFlag = Boolean(
    env.SYNCSPACE_TEST_LOCAL_MODE === "true" ||
      env.ALLOW_LOCAL_STORAGE_IN_TEST === "true"
  );

  return hasTestRunnerMarker && hasTestOptInFlag;
}

/**
 * Evaluates whether the application is operating under strict production readiness requirements.
 */
export function isProductionEnvironment(
  env: Record<string, string | undefined> = process.env
): boolean {
  // 1. Strict production flag unconditionally enforces production
  if (env.SYNCSPACE_STRICT_PRODUCTION === "true") {
    return true;
  }

  // 2. Any deployed platform unconditionally enforces production safeguards
  if (isDeployedPlatform(env)) {
    return true;
  }

  // 3. NODE_ENV === "production" strictly enforces production across all hosts
  // (including bare VPS, self-hosted Docker, and unrecognized platforms).
  // Accidental test flags can NEVER weaken or bypass production safeguards.
  if (env.NODE_ENV === "production") {
    return true;
  }

  // 4. Default for non-production environments (test/development)
  return false;
}
