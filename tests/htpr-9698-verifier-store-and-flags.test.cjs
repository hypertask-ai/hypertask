const test = require("node:test");
const assert = require("node:assert/strict");
const { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const jobScript = path.join(root, "scripts/pstack-verifier-job.sh");
const flagKeysModule = path.join(root, "scripts/lib/verifier-flag-keys.mjs");
const smokeFlagsModule = path.join(root, "scripts/lib/core-smoke-flags.mjs");
const loadFlagKeys = () => import(pathToFileURL(flagKeysModule).href);
const loadSmokeFlags = () => import(pathToFileURL(smokeFlagsModule).href);

function writeCandidate(candidate, { files = {}, flags = [] } = {}) {
  for (const [key, identifier] of flags) {
    const definitions = path.join(candidate, "src/lib/flags/definitions");
    mkdirSync(definitions, { recursive: true });
    writeFileSync(path.join(definitions, `${key}.ts`), `export const ${identifier} = "${key}";\n`);
  }
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(candidate, file)), { recursive: true });
    writeFileSync(path.join(candidate, file), text);
  }
}

function workspace(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "htpr-9698-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("the plan selects the flags the diff and the changed files name, and nothing else", async (t) => {
  const { flagKeysForPlan } = await loadFlagKeys();
  const candidate = path.join(workspace(t), "candidate");
  writeCandidate(candidate, {
    flags: [["htpr-100-alpha", "ALPHA_FLAG"], ["htpr-200-beta", "BETA_FLAG"], ["htpr-400-delta", "DELTA_FLAG"]],
    files: {
      "src/app/changed/page.ts": 'readFeatureFlag("htpr-100-alpha"); readFeatureFlag("htpr-999-unknown");\n',
      "src/app/untouched/page.ts": 'readFeatureFlag("htpr-400-delta");\n',
    },
  });
  const plan = { files: ["src/app/changed/page.ts", "../../etc/passwd", "src/app/untouched/page.ts.orig"] };
  plan.claim = { diff: '+readFeatureFlag("htpr-200-beta");' };
  assert.deepEqual(flagKeysForPlan(plan, { root: candidate }), ["htpr-100-alpha", "htpr-200-beta"]);
});

test("a flag imported as a constant from the flag keys module resolves to its key", async (t) => {
  const { flagKeysForPlan } = await loadFlagKeys();
  const candidate = path.join(workspace(t), "candidate");
  writeCandidate(candidate, {
    flags: [["htpr-7627-ticket-first-screen", "HTPR_7627_TICKET_FIRST_SCREEN_FLAG"]],
    files: {
      "src/app/layout.tsx": [
        'import { HTPR_7627_TICKET_FIRST_SCREEN_FLAG } from "@/lib/flags/keys";',
        "export default async function layout() {",
        "  return isFeatureEnabled(HTPR_7627_TICKET_FIRST_SCREEN_FLAG);",
        "}",
        "",
      ].join("\n"),
      "src/lib/flags/keys.ts": 'export const AGENT_CHAT_ADHD_REPLY_GUIDANCE = "Lead with the next action.";\n',
    },
  });
  const plan = { files: ["src/app/layout.tsx", "src/lib/flags/keys.ts"], claim: { diff: "+const a = 1;" } };
  assert.deepEqual(flagKeysForPlan(plan, { root: candidate }), ["htpr-7627-ticket-first-screen"]);
});

test("the helper prints the derived keys as the comma separated list the job hands to the stack", (t) => {
  const dir = workspace(t);
  const candidate = path.join(dir, "candidate");
  writeCandidate(candidate, {
    flags: [["htpr-810-kappa", "KAPPA_FLAG"], ["htpr-811-lambda", "LAMBDA_FLAG"]],
    files: { "src/app/page.ts": 'readFeatureFlag("htpr-810-kappa"); readFeatureFlag("htpr-811-lambda");\n' },
  });
  const planFile = path.join(dir, "plan.json");
  writeFileSync(planFile, JSON.stringify({ files: ["src/app/page.ts"], claim: { diff: "" } }));
  const result = spawnSync(process.execPath, [flagKeysModule, "--plan", planFile, "--candidate", candidate], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "htpr-810-kappa,htpr-811-lambda");
});

function runJob(t, { basePlanFile } = {}) {
  const dir = workspace(t);
  const trusted = path.join(dir, "trusted");
  const candidate = path.join(dir, "candidate");
  const work = path.join(dir, "work");
  mkdirSync(path.join(trusted, "scripts/lib"), { recursive: true });
  mkdirSync(path.join(work, "plan"), { recursive: true });
  writeFileSync(path.join(trusted, "scripts/lib/verifier-flag-keys.mjs"), readFileSync(flagKeysModule));
  writeCandidate(candidate, {
    flags: [["htpr-812-mu", "MU_FLAG"]],
    files: { "src/app/page.ts": 'readFeatureFlag("htpr-812-mu");\n' },
  });
  writeFileSync(
    path.join(work, "plan", "plan.json"),
    JSON.stringify({ files: ["src/app/page.ts"], claim: { diff: "+const a = 1;" } }),
  );
  const captured = path.join(dir, "captured");
  const smoke = path.join(trusted, "scripts/run-app-smoke-isolated.sh");
  writeFileSync(
    smoke,
    `#!/bin/bash\nprintf '%s' "\${CORE_SMOKE_FLAG_KEYS-unset}" > "${captured}"\nprintf 'url=http://127.0.0.1:3100\\nenv=${path.join(dir, "smoke.env")}\\n' > "$PSTACK_VERIFIER_READY"\n`,
    { mode: 0o755 },
  );
  chmodSync(smoke, 0o755);
  writeFileSync(path.join(trusted, "scripts/pstack-verifier-drive.mjs"), "", { mode: 0o644 });
  const env = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: process.env.HOME, TMPDIR: dir };
  if (basePlanFile !== undefined) env.PSTACK_PLAN_FILE = basePlanFile;
  const result = spawnSync("bash", [jobScript, trusted, candidate, work], { encoding: "utf8", env, timeout: 20000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return readFileSync(captured, "utf8");
}

test("the head job hands the derived flag keys to the smoke stack", (t) => {
  assert.equal(runJob(t), "htpr-812-mu");
});

test("the base job seeds the flags base defines, not the pull request's", (t) => {
  assert.equal(runJob(t, { basePlanFile: path.join("plan", "base-plan.json") }), "");
});

test("the seed turns every handed key on inside one flag cache invalidation, and nothing for none", async () => {
  const { seedFlagKeys } = await loadSmokeFlags();
  const upserts = [];
  let invalidations = 0;
  const prisma = { featureFlag: { upsert: async (args) => upserts.push(args) } };
  const withFlagModeInvalidation = async (work) => {
    invalidations += 1;
    await work();
  };
  assert.equal(await seedFlagKeys({ keys: ["htpr-1-one", "htpr-2-two"], prisma, withFlagModeInvalidation }), 2);
  assert.equal(invalidations, 1);
  assert.deepEqual(upserts, [
    { where: { key: "htpr-1-one" }, create: { key: "htpr-1-one", mode: "EVERYONE" }, update: { mode: "EVERYONE" } },
    { where: { key: "htpr-2-two" }, create: { key: "htpr-2-two", mode: "EVERYONE" }, update: { mode: "EVERYONE" } },
  ]);
  assert.equal(await seedFlagKeys({ keys: [], prisma, withFlagModeInvalidation }), 0);
  assert.equal(invalidations, 1);
});

test("handed keys are trimmed, deduplicated, and refused unless they are flag slugs", async () => {
  const { parseFlagKeys } = await loadSmokeFlags();
  assert.deepEqual(parseFlagKeys(" htpr-1-one ,htpr-2-two,,htpr-1-one "), ["htpr-1-one", "htpr-2-two"]);
  assert.deepEqual(parseFlagKeys(undefined), []);
  assert.throws(() => parseFlagKeys("htpr-1-one,../etc/passwd"), /Invalid core smoke flag key: \.\.\/etc\/passwd/);
});
