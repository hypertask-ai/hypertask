import { createRequire } from "node:module";
import path from "node:path";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const positiveInteger = (name) => {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`Invalid ${name}`);
  return value;
};

const trustedRoot = required("CORE_SMOKE_TRUSTED_ROOT");
const appRoot = required("CORE_SMOKE_APP_ROOT");
const jiti = createRequire(path.join(appRoot, "package.json"))("jiti")(
  import.meta.url,
  {
    interopDefault: true,
    alias: { "@": path.join(trustedRoot, "src") },
  },
);
const { runCoreActionsSmoke } = jiti(
  path.join(trustedRoot, "src/lib/productionSmoke/coreActions.ts"),
);

const result = await runCoreActionsSmoke({
  baseUrl: required("CORE_SMOKE_BASE_URL"),
  cookieHeader: required("CORE_SMOKE_COOKIE"),
  runId: required("CORE_SMOKE_RUN_ID"),
  persistOwnership: false,
  fixture: {
    projectId: positiveInteger("CORE_SMOKE_PROJECT_ID"),
    taskId: positiveInteger("CORE_SMOKE_TASK_ID"),
    baseSectionId: positiveInteger("CORE_SMOKE_BASE_SECTION_ID"),
    altSectionId: positiveInteger("CORE_SMOKE_ALT_SECTION_ID"),
    userId: positiveInteger("CORE_SMOKE_USER_ID"),
    userDisplayName: required("CORE_SMOKE_USER_NAME"),
    agentId: required("CORE_SMOKE_AGENT_ID"),
    agentDisplayName: required("CORE_SMOKE_AGENT_NAME"),
  },
});

if (!result.ok) {
  throw new Error(`${result.action}: ${result.detail}`);
}
console.log(
  `Core actions smoke passed: ${result.steps.length} actions returned 2xx and persisted correctly.`,
);
