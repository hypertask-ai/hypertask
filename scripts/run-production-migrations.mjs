import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";

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
  const result = spawnSyncImpl(
    process.execPath,
    [prismaCli, "migrate", "deploy"],
    {
      cwd,
      env: { ...env, DATABASE_URL: directUrl },
      stdio: "inherit",
    },
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
