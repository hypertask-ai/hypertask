import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";

// HTPR-7076: idempotent migrations that may be left failed by an earlier build.
export const RETRY_FAILED_MIGRATIONS = [
  "20261011010000_htpr_7076_ai_usage_cache_tokens",
];

export function shouldRunProductionMigrations(env) {
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "production") {
    return false;
  }

  const productionBranch = env.PRODUCTION_BRANCH?.trim() || "production";
  if (env.VERCEL_GIT_COMMIT_REF !== productionBranch) {
    throw new Error(
      `Refusing a Vercel production build outside the ${productionBranch} branch.`,
    );
  }

  return true;
}

export function runProductionMigrations({
  env = process.env,
  spawnSyncImpl = spawnSync,
  cwd = process.cwd(),
} = {}) {
  if (!shouldRunProductionMigrations(env)) {
    console.log("Skipping database migrations outside a Vercel production build.");
    return { status: "skipped" };
  }

  const directUrl = env.DIRECT_URL?.trim();
  if (!directUrl) {
    throw new Error(
      "DIRECT_URL is required for database migrations in production builds.",
    );
  }

  const prismaCli = path.join(cwd, "node_modules", "prisma", "build", "index.js");
  const options = { cwd, env: { ...env, DATABASE_URL: directUrl }, stdio: "inherit" };

  // A migration that failed in an earlier build blocks every deploy (P3009). These
  // names are safe to re-run, so mark them rolled back and let deploy apply them again.
  // Prisma refuses this for a migration that is not in a failed state; that is fine.
  for (const name of RETRY_FAILED_MIGRATIONS) {
    const resolved = spawnSyncImpl(
      process.execPath,
      [prismaCli, "migrate", "resolve", "--rolled-back", name],
      options,
    );
    if (resolved.error) throw resolved.error;
    if (resolved.status === 0) console.log(`Marked failed migration ${name} as rolled back; deploy will retry it.`);
  }

  const result = spawnSyncImpl(
    process.execPath,
    [prismaCli, "migrate", "deploy"],
    options,
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy exited with status ${result.status}.`);
  }

  return { status: "deployed" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runProductionMigrations();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
