const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const policy = load("../src/lib/aiAllowancePolicy.ts");
const flagKey = "htpr-7988-allowance-error-report";

function reporter({ enabled = true, captured = true } = {}) {
  const calls = { captures: [], tickets: [], flags: [] };
  const stubs = {
    "@/lib/prisma": { __esModule: true, default: {
      section: { findMany: async () => [{ id: 4389, section_title: "Bugs" }] },
      label: { findFirst: async () => null },
    } },
    "@/lib/redis": { getRedis: async () => ({ set: async () => "OK", incr: async () => 1, expire: async () => 1 }) },
    "@/lib/mcp/tasks/services": {
      validateProjectAccess: async () => ({ project: { uniqueIdentifier: "HTPR", teamId: "fixture" } }),
      createTask: async (task) => calls.tickets.push(task),
    },
    "./symbolicateStack": { symbolicateStack: async (stack) => ({ stack, resolvedFrames: 0 }) },
    "@/lib/telemetry/posthogErrorTracking": { capturePostHogException: async (report) => {
      calls.captures.push(report);
      return captured;
    } },
    "@/lib/flags": {
      HTPR_7988_ALLOWANCE_ERROR_REPORT_FLAG: flagKey,
      isFeatureEnabled: async (...args) => { calls.flags.push(args); return enabled; },
    },
  };
  const filename = path.join(root, "src/lib/errors/reportError.ts");
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code, {
    module: loadedModule, exports: loadedModule.exports,
    require: (id) => stubs[id] ?? load(id.startsWith("@/") ? path.join(root, "src", id.slice(2)) : id.startsWith("./") ? path.resolve(path.dirname(filename), id) : id),
    process: { env: { NODE_ENV: "production", VERCEL_ENV: "production", ERROR_BOARD_PROJECT_ID: "15" } },
    console: { log() {}, error() {} }, Date, Math, Number,
  }, { filename });
  return { reportError: loadedModule.exports.reportError, calls };
}

for (const message of [policy.SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE, policy.DAILY_AI_ALLOWANCE_EXCEEDED_MESSAGE]) {
  test(`expected allowance refusal never enters either error sink: ${message}`, async () => {
    for (const source of ["handled", "server"]) {
      const { reportError, calls } = reporter({ captured: false });
      await reportError({ message, source, url: "/api/ai/task-questions" });
      assert.equal(calls.captures.length, 0);
      assert.equal(calls.tickets.length, 0);
      assert.equal(calls.flags[0][0], flagKey);
    }
  });
}

test("switching Off restores allowance error reporting", async () => {
  const { reportError, calls } = reporter({ enabled: false, captured: false });
  await reportError({ message: policy.SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE, source: "handled" });
  assert.equal(calls.captures.length, 1);
  assert.equal(calls.tickets.length, 1);
});

test("real failures and near matches still reach PostHog or the fallback ticket", async () => {
  for (const captured of [true, false]) {
    for (const message of ["Provider unavailable", `${policy.SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE} Unexpected database failure`]) {
      const { reportError, calls } = reporter({ captured });
      await reportError({ message, source: "handled" });
      assert.equal(calls.captures[0].message, message);
      assert.equal(calls.tickets.length, captured ? 0 : 1);
      assert.equal(calls.flags.length, 0);
    }
  }
});

test("allowance reporting flag defaults to Everyone with small release risk", () => {
  const definition = load("../src/lib/flags/definitions/htpr-7988-allowance-error-report.ts").default;
  assert.equal(definition.key, flagKey);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason.length > 0);
});
