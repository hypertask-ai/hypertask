process.env.FEATURE_FLAG_TYPESCRIPT_PATH = require.resolve("typescript");
const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const scriptUrl = pathToFileURL(path.join(root, ".github/scripts/feature-flag-gate.mjs")).href;
const { RELEASE_RISK_REQUIRED_FROM } = require("jiti").createJiti(__filename)(path.join(root, "src/lib/flags/releaseRisk.ts"));

function writeFile(dir, relative, content) {
  const full = path.join(dir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (relative === "src/lib/flags/releaseRisk.ts") {
    content = `export const RELEASE_RISK_REQUIRED_FROM = "${RELEASE_RISK_REQUIRED_FROM}";\n${content}`;
  }
  fs.writeFileSync(full, content);
}

function flagsSource(definitions = ["OTHER_FLAG"], mode = "OWNER_AND_QA", suffix = "") {
  const rows = definitions.map((key) => `  { key: ${key}, description: "fixture" },`).join("\n");
  return `import { OTHER_FLAG } from "@/lib/flags/keys";\nconst FEATURE_FLAG_DEFINITIONS = [\n${rows}\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "${mode}";\n${suffix}`;
}

function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flag-gate-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // Synthetic commits test gate semantics, not workstation Git configuration.
  const git = (args) => execFileSync("git", args, {
    cwd: dir, encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: os.devNull },
  });
  git(["init", "-q", "--initial-branch=main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  writeFile(dir, "src/lib/flags/keys.ts", 'export const OTHER_FLAG = "htpr-1-other";\n');
  writeFile(dir, "src/lib/flags.ts", flagsSource());
  writeFile(dir, "src/lib/flags/releaseRisk.ts", `export const FEATURE_FLAG_RELEASE_RISKS = {
    "htpr-5-widget": { risk: "new", reason: "Adds a widget." },
    "htpr-7038-test-cost": { risk: "small", reason: "Changes an existing screen." },
    "hyfa-5-widget": { risk: "new", reason: "Adds a widget." },
    "htpr-9-new": { risk: "small", reason: "Changes an existing screen." },
    "htpr-9-wrong": { risk: "small", reason: "Changes an existing screen." },
    "htpr-5-decoy": { risk: "small", reason: "Changes an existing screen." },
  };`);
  return { dir, git };
}

function commit(git, message) {
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message]);
  return git(["rev-parse", "HEAD"]).trim();
}

async function evaluate(title, baseSha, headSha, cwd, labels = []) {
  const original = process.cwd();
  process.chdir(cwd);
  try {
    const { evaluate: run } = await import(scriptUrl);
    return await run({ title, baseSha, headSha, labels });
  } finally {
    process.chdir(original);
  }
}

test("non-UI changes do not need a flag", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/lib/util.ts", "export const value = 1;\n");
  const head = commit(git, "backend");
  const result = await evaluate("HTPR-2 [FEATURE] backend", base, head, dir);
  assert.equal(result.pass, true);
  assert.equal(result.ownerReview, null);
});

test("loose JSX UI files require a feature flag", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/features/NewView.jsx", "export const NewView = () => <div />;\n");
  const head = commit(git, "jsx feature");
  assert.equal((await evaluate("HTPR-2 [FEATURE] add view", base, head, dir)).pass, false);
});

test("YPER4 UI changes are exempt regardless of tag or line count", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", Array.from({ length: 151 }, (_, i) => `export const Widget${i} = () => <div />;`).join("\n"));
  const head = commit(git, "infra ui");
  for (const tag of ["INFRA", "FEATURE", "REFACTOR"]) {
    const result = await evaluate(`YPER4-165 [${tag}] update widget`, base, head, dir);
    assert.equal(result.pass, true);
    assert.equal(result.ownerReview, "exempt-ui");
    assert.equal(result.reason, "Infra ticket: no flag required");
  }
  for (const prefix of ["HTPR", "HYFA"]) {
    const result = await evaluate(`${prefix}-165 [FEATURE] update widget`, base, head, dir);
    assert.equal(result.pass, false);
    assert.match(result.reason, /without a feature flag/);
  }
});

test("malformed YPER4 titles do not bypass the feature flag requirement", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "ui");
  for (const title of ["YPER4-x [INFRA] widget", "YPER4-165 [] widget", "YPER4-165 [INFRA] ", "YPER4-165 widget", "YPER4X-165 [INFRA] widget"]) {
    assert.equal((await evaluate(title, base, head, dir)).pass, false, title);
  }
});

test("JavaScript UI paths and server helpers enforce their respective scopes", async (t) => {
  const jsUi = makeRepo(t);
  const jsUiBase = commit(jsUi.git, "base");
  writeFile(jsUi.dir, "src/features/NewView.js", "export const NewView = () => <div />;\n");
  const jsUiHead = commit(jsUi.git, "js feature");
  assert.equal((await evaluate("HTPR-2 [FEATURE] add view", jsUiBase, jsUiHead, jsUi.dir)).pass, false);

  const componentJs = makeRepo(t);
  const componentJsBase = commit(componentJs.git, "base");
  writeFile(componentJs.dir, "src/components/Widget.js", "export const Widget = () => <div />;\n");
  const componentJsHead = commit(componentJs.git, "component js");
  assert.equal((await evaluate("HTPR-2 [FEATURE] add widget", componentJsBase, componentJsHead, componentJs.dir)).pass, false);

  const apiHelper = makeRepo(t);
  const apiHelperBase = commit(apiHelper.git, "base");
  writeFile(apiHelper.dir, "src/app/api/widget/service.ts", "export function buildWidget() { return { ok: true }; }\n");
  const apiHelperHead = commit(apiHelper.git, "api helper");
  assert.equal((await evaluate("HTPR-2 [FEATURE] backend", apiHelperBase, apiHelperHead, apiHelper.dir)).pass, false);

  const utilJs = makeRepo(t);
  const utilJsBase = commit(utilJs.git, "base");
  writeFile(utilJs.dir, "src/utils/format.js", "export function formatName(value) { return String(value); }\n");
  const utilJsHead = commit(utilJs.git, "util js");
  assert.equal((await evaluate("HTPR-2 [FEATURE] backend", utilJsBase, utilJsHead, utilJs.dir)).pass, true);
});

test("server-only changes require a changed ticket-specific server gate", async (t) => {
  for (const file of [
    "src/lib/mcp/operations/tasks/waiting-on.ts",
    "src/lib/mcp-server/section.service.ts",
    "src/app/api/widget/route.ts",
    "src/pages/api/widget.ts",
    "src/lib/api/task-writes/create.ts",
    "src/utils/controllers/tasks.ts",
  ]) {
    const { dir, git } = makeRepo(t);
    const base = commit(git, "base");
    writeFile(dir, file, 'export async function execute(userId) { return "new"; }\n');
    const ungated = commit(git, "server feature");
    for (const tag of ["FEATURE", "IMPROVE"]) {
      const result = await evaluate(`HTPR-1 [${tag}] server behavior`, base, ungated, dir);
      assert.equal(result.pass, false, `${tag}: ${file}`);
      assert.match(result.reason, /isFeatureEnabled/);
      assert.match(result.reason, /src\/lib\/flags\/definitions\/htpr-1-/);
    }
    writeFile(dir, file, 'import { isFeatureEnabled } from "@/lib/flags";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport async function execute(userId) { return await isFeatureEnabled(OTHER_FLAG, userId) ? "new" : "old"; }\n');
    const gated = commit(git, "server flag");
    const allowed = await evaluate("HTPR-1 [FEATURE] server behavior", base, gated, dir);
    assert.equal(allowed.pass, true, file);
    assert.equal(allowed.ownerReview, "feature-gated-ui");
    const decision = path.join(dir, "decision.txt");
    execFileSync(process.execPath, [path.join(root, ".github/scripts/feature-flag-gate.mjs"),
      "HTPR-1 [FEATURE] server behavior", base, gated, decision], { cwd: dir });
    assert.equal(fs.readFileSync(decision, "utf8"), "feature-gated-ui\n");
  }
});

test("server gates reject client hooks, dead calls, unrelated flags and unchanged reads", async (t) => {
  for (const source of [
    'import { useFlag } from "@/hooks/useFlag";\nexport function execute() { return useFlag("htpr-1-other") ? "new" : "old"; }\n',
    'import { isFeatureEnabled } from "@/lib/flags";\nfunction dead() { return isFeatureEnabled("htpr-1-other", 6); }\nexport function execute() { return "new"; }\n',
    'import { isFeatureEnabled } from "@/lib/flags";\nexport async function execute() {\n  const enabled = await isFeatureEnabled("htpr-1-other", 6);\n  return enabled ? "new" : "old";\n}\n',
  ]) {
    const { dir, git } = makeRepo(t);
    writeFile(dir, "src/app/api/widget/route.ts", source);
    const base = commit(git, "existing server behavior");
    writeFile(dir, "src/app/api/widget/route.ts", source.replace('"new"', '"changed"'));
    const head = commit(git, "changed behavior without changed server gate");
    for (const number of [1, 2]) {
      assert.equal((await evaluate(`HTPR-${number} [FEATURE] behavior`, base, head, dir)).pass, false);
    }
  }
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/app/api/widget/route.ts", 'import { useFlag } from "@/hooks/useFlag";\nexport function execute() { return useFlag("htpr-1-other") ? "new" : "old"; }\n');
  const head = commit(git, "client-only gate");
  assert.equal((await evaluate("HTPR-1 [FEATURE] behavior", base, head, dir)).pass, false);
});

test("server coverage cannot excuse unrelated UI or use a client gate", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/app/api/widget/route.ts", 'import { isFeatureEnabled } from "@/lib/flags";\nexport async function GET() { return await isFeatureEnabled("htpr-1-other", 6) ? "new" : "old"; }\n');
  writeFile(dir, "src/components/Unrelated.tsx", 'export const Unrelated = () => <div />;\n');
  let head = commit(git, "unrelated ungated UI");
  assert.equal((await evaluate("HTPR-1 [FEATURE] behavior", base, head, dir)).pass, false);
  fs.rmSync(path.join(dir, "src/components/Unrelated.tsx"));
  writeFile(dir, "src/app/api/other/route.ts", 'export { GET } from "../widget/route";\n');
  head = commit(git, "delegating route");
  assert.equal((await evaluate("HTPR-1 [FEATURE] behavior", base, head, dir)).pass, true);
  writeFile(dir, "src/app/api/other/route.ts", 'import { GET as executeGET } from "../widget/route";\nexport const GET = executeGET;\n');
  head = commit(git, "imported handler alias");
  assert.equal((await evaluate("HTPR-1 [FEATURE] behavior", base, head, dir)).pass, true);
  writeFile(dir, "src/app/api/widget/route.ts", 'export async function GET() { return "ungated"; }\n');
  writeFile(dir, "src/components/Unrelated.tsx", 'import { useFlag } from "@/hooks/useFlag";\nexport function Widget() { return useFlag("htpr-1-other") ? <div /> : null; }\n');
  head = commit(git, "UI gate does not cover server");
  assert.equal((await evaluate("HTPR-1 [FEATURE] behavior", base, head, dir)).pass, false);
});

test("server flags in invoked MCP route wrappers count, but discarded and shadowed wrappers do not", async (t) => {
  for (const [source, expected] of [
    ['import { wrapMcpRoute as wrap } from "@/lib/mcp/routeWrapper";\nexport async function POST(request) { return wrap(async (request) => { if (!(await isFeatureEnabled("htpr-1-other", request.userId))) return "off"; return "on"; })(request); }\n', true],
    ['import { wrapMcpRoute as wrap } from "@/lib/mcp/routeWrapper";\nexport async function POST(request) { wrap(async () => { return await isFeatureEnabled("htpr-1-other", 6) ? "on" : "off"; }); return "ungated"; }\n', false],
    ['function wrap(callback) { return () => "ungated"; }\nexport async function POST(request) { return wrap(async () => { return await isFeatureEnabled("htpr-1-other", 6) ? "on" : "off"; })(request); }\n', false],
    ['import { wrapMcpRoute as wrap } from "@/lib/mcp/routeWrapper";\nexport async function POST(request) { return wrap(async function* () { if (await isFeatureEnabled("htpr-1-other", 6)) yield "on"; })(request); }\n', false],
  ]) {
    const { dir, git } = makeRepo(t);
    const base = commit(git, "base");
    writeFile(dir, "src/lib/mcp/operations/widget.ts", 'import { isFeatureEnabled } from "@/lib/flags";\n' + source);
    const head = commit(git, "wrapped server handler");
    assert.equal((await evaluate("HTPR-1 [FEATURE] wrapped operation", base, head, dir)).pass, expected);
  }
});

test("server-only changes preserve existing exemptions and deletion behavior", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/lib/mcp/operation.ts", 'export const oldValue = "old";\n');
  const base = commit(git, "base");
  writeFile(dir, "src/lib/mcp/operation.ts", 'export const value = "new";\n');
  const head = commit(git, "server behavior");
  for (const title of ["YPER4-1 [FEATURE] infra", "HTPR-1 [INFRA] infra", "HTPR-1 [BUGFIX] repair", "HTPR-1 [REFACTOR] cleanup"]) {
    assert.equal((await evaluate(title, base, head, dir)).pass, true, title);
  }
  assert.equal((await evaluate("HTPR-1 [FEATURE] AI chat", base, head, dir, ["AI CHAT 💬"])).pass, true);
  fs.rmSync(path.join(dir, "src/lib/mcp/operation.ts"));
  const deleted = commit(git, "remove old code");
  assert.equal((await evaluate("HTPR-1 [FEATURE] remove code", base, deleted, dir)).pass, true);
});

test("memo-wrapped exported JSX entries still require a ticket gate", async (t) => {
  const ungated = makeRepo(t);
  const ungatedBase = commit(ungated.git, "base");
  writeFile(
    ungated.dir,
    "src/components/Widget.tsx",
    'import { memo } from "react";\nimport { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Gated = () => useFlag(OTHER_FLAG) ? <div /> : null;\nexport const NewView = memo(() => <div />);\n',
  );
  const ungatedHead = commit(ungated.git, "memo ungated");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", ungatedBase, ungatedHead, ungated.dir)).pass, false);

  const gated = makeRepo(t);
  const gatedBase = commit(gated.git, "base");
  writeFile(
    gated.dir,
    "src/components/Widget.tsx",
    'import { memo } from "react";\nimport { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const NewView = memo(() => useFlag(OTHER_FLAG) ? <div /> : null);\n',
  );
  const gatedHead = commit(gated.git, "memo gated");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", gatedBase, gatedHead, gated.dir)).pass, true);

  const asserted = makeRepo(t);
  const assertedBase = commit(asserted.git, "base");
  writeFile(
    asserted.dir,
    "src/components/Widget.tsx",
    'import { memo } from "react";\nexport const NewView = memo(((() => <div />) as any));\n',
  );
  const assertedHead = commit(asserted.git, "memo asserted");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", assertedBase, assertedHead, asserted.dir)).pass, false);

  const nested = makeRepo(t);
  const nestedBase = commit(nested.git, "base");
  writeFile(
    nested.dir,
    "src/components/Widget.tsx",
    'import { memo, forwardRef } from "react";\nimport { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Gated = () => useFlag(OTHER_FLAG) ? <div /> : null;\nexport const NewView = memo(forwardRef(() => <div />));\n',
  );
  const nestedHead = commit(nested.git, "nested hoc");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", nestedBase, nestedHead, nested.dir)).pass, false);

  const nestedGated = makeRepo(t);
  const nestedGatedBase = commit(nestedGated.git, "base");
  writeFile(
    nestedGated.dir,
    "src/components/Widget.tsx",
    'import { memo, forwardRef } from "react";\nimport { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const NewView = memo(forwardRef(() => useFlag(OTHER_FLAG) ? <div /> : null));\n',
  );
  const nestedGatedHead = commit(nestedGated.git, "nested hoc gated");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", nestedGatedBase, nestedGatedHead, nestedGated.dir)).pass, true);

  const parenWrapped = makeRepo(t);
  const parenWrappedBase = commit(parenWrapped.git, "base");
  writeFile(
    parenWrapped.dir,
    "src/components/Widget.tsx",
    'import { memo, forwardRef } from "react";\nexport const NewView = (memo(forwardRef(() => <div />)));\n',
  );
  const parenWrappedHead = commit(parenWrapped.git, "paren nested hoc");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", parenWrappedBase, parenWrappedHead, parenWrapped.dir)).pass, false);
});

test("App Router API changes require a server flag", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/app/api/example/route.ts", "export function GET() { return new Response(); }\n");
  const head = commit(git, "backend");
  assert.equal((await evaluate("HTPR-2 [FEATURE] backend", base, head, dir)).pass, false);
});

test("server-side ticket gates cover related UI changes", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", 'export async function loadWidget() { return fetch("/api/widget"); }\nexport const Widget = () => <div />;\n');
  writeFile(dir, "src/app/api/widget/route.ts", 'import { isFeatureEnabled } from "@/lib/flags";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport async function GET() { if (await isFeatureEnabled(OTHER_FLAG, 6)) return new Response("on"); return new Response("off"); }\n');
  const head = commit(git, "server-gated UI");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", base, head, dir)).pass, true);

  const unrelated = makeRepo(t);
  const unrelatedBase = commit(unrelated.git, "base");
  writeFile(unrelated.dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  writeFile(unrelated.dir, "src/app/api/unrelated/route.ts", 'import { isFeatureEnabled } from "@/lib/flags";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport async function GET() { if (await isFeatureEnabled(OTHER_FLAG, 6)) return new Response("on"); return new Response("off"); }\n');
  const unrelatedHead = commit(unrelated.git, "unrelated server gate");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", unrelatedBase, unrelatedHead, unrelated.dir)).pass, false);

  const parallel = makeRepo(t);
  const parallelBase = commit(parallel.git, "base");
  writeFile(parallel.dir, "src/components/Widget.tsx", 'export async function loadWidget() { return fetch("/api/widget"); }\nexport const Widget = () => <div />;\n');
  writeFile(parallel.dir, "src/app/api/widget/route.ts", 'import { isFeatureEnabled } from "@/lib/flags";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport async function GET() { const [enabled] = await Promise.all([isFeatureEnabled(OTHER_FLAG, 6)]); return Response.json({ ...(enabled ? { widget: "on" } : {}) }); }\n');
  const parallelHead = commit(parallel.git, "parallel server gate");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", parallelBase, parallelHead, parallel.dir)).pass, true);

  const shadowedPromise = makeRepo(t);
  const shadowedPromiseBase = commit(shadowedPromise.git, "base");
  writeFile(shadowedPromise.dir, "src/components/Widget.tsx", 'export async function loadWidget() { return fetch("/api/widget"); }\nexport const Widget = () => <div />;\n');
  writeFile(shadowedPromise.dir, "src/app/api/widget/route.ts", 'import { isFeatureEnabled } from "@/lib/flags";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nconst Promise = { all: async () => [true] };\nexport async function GET() { const [enabled] = await Promise.all([isFeatureEnabled(OTHER_FLAG, 6)]); if (enabled) return new Response("on"); return new Response("off"); }\n');
  const shadowedPromiseHead = commit(shadowedPromise.git, "shadowed Promise wrapper");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", shadowedPromiseBase, shadowedPromiseHead, shadowedPromise.dir)).pass, false);

  const pagesIndex = makeRepo(t);
  const pagesIndexBase = commit(pagesIndex.git, "base");
  writeFile(pagesIndex.dir, "src/components/loadWidget.ts", 'export async function loadWidget() { return fetch("/api/widget"); }\n');
  writeFile(pagesIndex.dir, "src/components/Widget.tsx", 'import { loadWidget } from "./loadWidget";\nexport const Widget = () => <button onClick={loadWidget} />;\n');
  writeFile(pagesIndex.dir, "src/pages/api/widget/index.ts", 'import { isFeatureEnabled } from "@/lib/flags";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport async function handler() { if (await isFeatureEnabled(OTHER_FLAG, 6)) return "on"; return "off"; }\n');
  const pagesIndexHead = commit(pagesIndex.git, "Pages index gate");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", pagesIndexBase, pagesIndexHead, pagesIndex.dir)).pass, true);

  const rootRoute = makeRepo(t);
  const rootRouteBase = commit(rootRoute.git, "base");
  writeFile(rootRoute.dir, "src/components/Widget.tsx", 'export async function loadWidget() { return fetch("/api"); }\nexport const Widget = () => <div />;\n');
  writeFile(rootRoute.dir, "src/app/api/route.ts", 'import { isFeatureEnabled } from "@/lib/flags";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport async function GET() { if (await isFeatureEnabled(OTHER_FLAG, 6)) return new Response("on"); return new Response("off"); }\n');
  const rootRouteHead = commit(rootRoute.git, "root API gate");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", rootRouteBase, rootRouteHead, rootRoute.dir)).pass, true);

  const dynamicRoute = makeRepo(t);
  const dynamicRouteBase = commit(dynamicRoute.git, "base");
  writeFile(dynamicRoute.dir, "src/components/Widget.tsx", 'export async function loadWidget(id) { return fetch(`/api/widget/${id}`); }\nexport const Widget = () => <div />;\n');
  writeFile(dynamicRoute.dir, "src/app/api/widget/[id]/route.ts", 'import { isFeatureEnabled } from "@/lib/flags";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport async function GET() { if (await isFeatureEnabled(OTHER_FLAG, 6)) return new Response("on"); return new Response("off"); }\n');
  const dynamicRouteHead = commit(dynamicRoute.git, "dynamic API gate");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", dynamicRouteBase, dynamicRouteHead, dynamicRoute.dir)).pass, true);

  const dynamicSibling = makeRepo(t);
  const dynamicSiblingBase = commit(dynamicSibling.git, "base");
  writeFile(dynamicSibling.dir, "src/components/Widget.tsx", 'export async function loadWidget() { return fetch("/api/widget/static"); }\nexport const Widget = () => <div />;\n');
  writeFile(dynamicSibling.dir, "src/app/api/widget/[id]/route.ts", 'import { isFeatureEnabled } from "@/lib/flags";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport async function GET() { if (await isFeatureEnabled(OTHER_FLAG, 6)) return new Response("on"); return new Response("off"); }\n');
  const dynamicSiblingHead = commit(dynamicSibling.git, "static sibling");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", dynamicSiblingBase, dynamicSiblingHead, dynamicSibling.dir)).pass, false);

  for (const [name, source] of [
    ["nested endpoint", 'export async function loadWidget() { return fetch("/api/widget/details"); }\nexport const Widget = () => <div />;\n'],
    ["inert text", 'export const Widget = () => <div data-path="/api/widget" />;\n'],
    ["shadowed fetch", 'function fetch() { return null; }\nexport function Widget() { fetch("/api/widget"); return <div />; }\n'],
  ]) {
    const spoofed = makeRepo(t);
    const spoofedBase = commit(spoofed.git, "base");
    writeFile(spoofed.dir, "src/components/Widget.tsx", source);
    writeFile(spoofed.dir, "src/app/api/widget/route.ts", 'import { isFeatureEnabled } from "@/lib/flags";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport async function GET() { if (await isFeatureEnabled(OTHER_FLAG, 6)) return new Response("on"); return new Response("off"); }\n');
    const spoofedHead = commit(spoofed.git, name);
    assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", spoofedBase, spoofedHead, spoofed.dir)).pass, false, name);
  }
});

test("App Router route handlers and spec files do not need a flag", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/app/webhooks/route.ts", "export function POST() { return new Response(); }\n");
  writeFile(dir, "src/components/Widget.spec.tsx", "export const fixture = <div />;\n");
  const head = commit(git, "non-ui files");
  assert.equal((await evaluate("HTPR-2 [FEATURE] non-ui files", base, head, dir)).pass, true);
});

test("small BUGFIX and INFRA changes are exempt", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => null;\n");
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "fix");
  for (const tag of ["BUGFIX", "INFRA"]) {
    const result = await evaluate(`HTPR-2 [${tag}] fix widget`, base, head, dir);
    assert.equal(result.pass, true);
    assert.equal(result.ownerReview, "exempt-ui");
  }
});

test("REFACTOR moves over 400 JSX lines without using the new UI budget", async (t) => {
  const { dir, git } = makeRepo(t);
  const source = `export const Widget = () => (\n  <>\n${Array.from({ length: 420 }, (_, i) => `    <div>Row ${i}</div>`).join("\n")}\n  </>\n);\n`;
  writeFile(dir, "src/components/Widget.tsx", source);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Extracted.tsx", source);
  const copy = commit(git, "copy widget without removing it");
  const copied = await evaluate("HTPR-2 [REFACTOR] copy widget", base, copy, dir);
  assert.equal(copied.pass, false);
  assert.match(copied.reason, /adds 420 new UI lines that are not moved code/);
  writeFile(dir, "src/components/Widget.tsx", 'export { Widget } from "./Extracted";\n');
  const head = commit(git, "extract widget");
  const result = await evaluate("HTPR-2 [REFACTOR] extract widget", base, head, dir);
  assert.equal(result.pass, true);
  assert.equal(result.ownerReview, "exempt-ui");
  assert.equal(result.reason, "[REFACTOR] is exempt (425 UI lines added, 421 moved, 0 new, 0 risky new).");
  for (const tag of ["BUGFIX", "INFRA"]) {
    const existingExemption = await evaluate(`HTPR-2 [${tag}] extract widget`, base, head, dir);
    assert.equal(existingExemption.pass, false);
    assert.match(existingExemption.reason, /425 lines to UI files.*over the 150-line budget/);
  }
});

test("REFACTOR rejects 200 new JSX lines rather than trusting the title", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", `export const Widget = () => (\n  <>\n${Array.from({ length: 200 }, (_, i) => `    <div>New row ${i}</div>`).join("\n")}\n  </>\n);\n`);
  const head = commit(git, "new widget");
  const result = await evaluate("HTPR-2 [REFACTOR] add widget", base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.reason, /adds 200 new UI lines that are not moved code.*over the 150-line budget/);
  assert.match(result.reason, /Retitle it as \[FEATURE\] with a feature flag or split it/);
});

test("REFACTOR counts new UI on export lines", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", `${Array.from({ length: 151 }, (_, i) => `export const Row${i} = () => <div>Row ${i}</div>;`).join("\n")}\n`);
  const head = commit(git, "exported widgets");
  const result = await evaluate("HTPR-2 [REFACTOR] add exports", base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.reason, /adds 151 new UI lines/);
});

test("REFACTOR credits each removed line to only one added line", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => (\n  <div>Same</div>\n);\n");
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", 'export { Widget } from "./Many";\n');
  writeFile(dir, "src/components/Many.tsx", `export const Widget = () => (\n  <>\n${Array.from({ length: 152 }, () => "  <div>Same</div>").join("\n")}\n  </>\n);\n`);
  const head = commit(git, "duplicate one removed line");
  const result = await evaluate("HTPR-2 [REFACTOR] duplicate rows", base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.reason, /adds 151 new UI lines/);
});

test("REFACTOR treats lone quoted words as strings unless they are union members", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Labels.tsx", `export const labels = [\n${Array.from({ length: 151 }, (_, i) => `  "Label${i}",`).join("\n")}\n];\n`);
  const head = commit(git, "lone strings");
  const result = await evaluate("HTPR-2 [REFACTOR] add labels", base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.reason, /adds 151 new UI lines/);
});

test("REFACTOR budgets new strings inclusively, not all new logic lines", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  const strings = Array.from({ length: 150 }, (_, i) => {
    const quote = ['"', "'", "`"][i % 3];
    return `const label${i} = ${quote}Label ${i}${quote};`;
  });
  const logic = Array.from({ length: 151 }, (_, i) => `const value${i} = ${i};`);
  writeFile(dir, "src/components/Widget.tsx", `${[...strings.slice(0, 149), ...logic].join("\n")}\n`);
  const head = commit(git, "small new strings");
  const result = await evaluate("HTPR-2 [REFACTOR] reorganize labels", base, head, dir);
  assert.equal(result.pass, true);
  assert.equal(result.ownerReview, "exempt-ui");
  assert.equal(result.reason, "[REFACTOR] is exempt (300 UI lines added, 0 moved, 300 new, 149 risky new).");
  fs.appendFileSync(path.join(dir, "src/components/Widget.tsx"), `${strings[149]}\n`);
  const atBudget = commit(git, "exactly at string budget");
  const boundary = await evaluate("HTPR-2 [REFACTOR] reorganize labels", base, atBudget, dir);
  assert.equal(boundary.pass, true);
  assert.equal(boundary.reason, "[REFACTOR] is exempt (301 UI lines added, 0 moved, 301 new, 150 risky new).");
  fs.appendFileSync(path.join(dir, "src/components/Widget.tsx"), 'const extra = "Over budget";\n');
  const overBudget = commit(git, "one more string");
  const failed = await evaluate("HTPR-2 [REFACTOR] reorganize labels", base, overBudget, dir);
  assert.equal(failed.pass, false);
  assert.match(failed.reason, /adds 151 new UI lines that are not moved code/);
});

test("REFACTOR matches normalized removals from non-UI files and retains the UI filter", async (t) => {
  const { dir, git } = makeRepo(t);
  const removed = Array.from({ length: 200 }, (_, i) => `  const label${i}  =  "Label ${i}";`).join("\n");
  writeFile(dir, "src/utils/labels.ts", `${removed}\n`);
  const base = commit(git, "base");
  fs.rmSync(path.join(dir, "src/utils/labels.ts"));
  const moved = Array.from({ length: 200 }, (_, i) => `\tconst label${i} = "Label ${i}",`).join("\n");
  writeFile(dir, "src/pages/Widget.tsx", `${moved}\n`);
  for (const file of ["src/app/api/widget/route.ts", "src/app/webhooks/route.ts", "src/components/Widget.test.tsx"]) {
    writeFile(dir, file, `${removed.replaceAll("Label", "Not moved")}\n`);
  }
  const head = commit(git, "move labels");
  const result = await evaluate("HYFA-2 [REFACTOR] move labels", base, head, dir);
  assert.equal(result.pass, true);
  assert.equal(result.ownerReview, "exempt-ui");
  assert.equal(result.reason, "[REFACTOR] is exempt (200 UI lines added, 200 moved, 0 new, 0 risky new).");
});

test("REFACTOR ignores trivial lines and Pick-key union members", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  const lines = [
    "", "{}", "[]", "();", "<>/", 'import Widget from "./Widget";',
    'export { Widget } from "./Widget";', '// "Comment"', '/* "Comment" */',
    '* "Comment"', '"use client";', "'use client';", "Widget,",
    ...Array.from({ length: 200 }, (_, i) => `| "key${i}"`),
  ];
  writeFile(dir, "src/components/Widget.tsx", `${lines.join("\n")}\n`);
  const head = commit(git, "type plumbing");
  const result = await evaluate("HTPR-2 [REFACTOR] type plumbing", base, head, dir);
  assert.equal(result.pass, true);
  assert.equal(result.reason, "[REFACTOR] is exempt (213 UI lines added, 0 moved, 200 new, 0 risky new).");
});

test("REFACTOR requires the same valid ticket title as other exemptions", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "const Widget = () => <div />;\n");
  const head = commit(git, "widget");
  for (const title of ["[REFACTOR] widget", "OTHER-2 [REFACTOR] widget", "HTPR-2 [REFACTOR] "]) {
    const result = await evaluate(title, base, head, dir);
    assert.equal(result.pass, false);
    assert.match(result.reason, /no valid HTPR or HYFA ticket and tag/);
  }
});

test("small AI CHAT title tags are exempt", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => null;\n");
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "chat ui");
  const result = await evaluate("HTPR-2 [AI CHAT] chat widget", base, head, dir);
  assert.equal(result.pass, true);
  assert.equal(result.ownerReview, "exempt-ui");
  assert.match(result.reason, /AI CHAT/);
});

test("AI CHAT emoji title tags are exempt", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => null;\n");
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "chat emoji");
  const result = await evaluate("HTPR-2 [AI CHAT 💬] chat widget", base, head, dir);
  assert.equal(result.pass, true);
  assert.equal(result.ownerReview, "exempt-ui");
});

test("AI CHAT labels exempt FEATURE UI changes", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => null;\n");
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "labeled chat");
  const result = await evaluate("HTPR-2 [FEATURE] chat widget", base, head, dir, ["AI CHAT 💬"]);
  assert.equal(result.pass, true);
  assert.equal(result.ownerReview, "exempt-ui");
  assert.match(result.reason, /AI CHAT label/);
});

test("ordinary FEATURE UI still requires a flag without AI CHAT", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => null;\n");
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "feature ui");
  assert.equal((await evaluate("HTPR-2 [FEATURE] add widget", base, head, dir, ["enhancement"])).pass, false);
});

test("large BUGFIX UI additions fail the cross-check", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", Array.from({ length: 151 }, (_, i) => `const line${i} = ${i};`).join("\n"));
  const head = commit(git, "large fix");
  const result = await evaluate("HTPR-3 [BUGFIX] fix widget", base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.reason, /over the 150-line budget/);

  const infra = await evaluate("HTPR-3 [INFRA] update widget", base, head, dir);
  assert.equal(infra.pass, false);
  assert.match(infra.reason, /over the 150-line budget/);
});

test("a BUGFIX tag without a valid title is not exempt", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "widget");
  assert.equal((await evaluate("[BUGFIX] fix widget", base, head, dir)).pass, false);
});

test("moving a large file into UI paths cannot evade the exemption budget", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/lib/Old.ts", Array.from({ length: 200 }, (_, i) => `export const old${i} = ${i};`).join("\n"));
  const base = commit(git, "base");
  fs.mkdirSync(path.join(dir, "src/components"), { recursive: true });
  git(["mv", "src/lib/Old.ts", "src/components/Widget.tsx"]);
  fs.appendFileSync(
    path.join(dir, "src/components/Widget.tsx"),
    `\n${Array.from({ length: 151 }, (_, i) => `export const added${i} = ${i};`).join("\n")}\n`,
  );
  const head = commit(git, "move and expand UI");
  const result = await evaluate("HTPR-3 [INFRA] move widget", base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.reason, /over the 150-line budget/);
});

test("undocumented title tags are not exempt", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "ui");
  assert.equal((await evaluate("HTPR-4 [CI] add widget", base, head, dir)).pass, false);
});

test("a forged auto-revert title is not exempt", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "ordinary commit");
  const result = await evaluate('Revert "HTPR-4 [FEATURE] add widget"', base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.reason, /no valid HTPR or HYFA ticket and tag/);
});

test("a forged revert footer with an unrelated patch is not exempt", async (t) => {
  const { dir, git } = makeRepo(t);
  commit(git, "initial");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const base = commit(git, "HTPR-4 [FEATURE] add widget");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <aside />;\n");
  git(["add", "-A"]);
  const title = 'Revert "HTPR-4 [FEATURE] add widget"';
  git(["commit", "-q", "-m", title, "-m", `This reverts commit ${base}.`]);
  const head = git(["rev-parse", "HEAD"]).trim();
  assert.equal((await evaluate(title, base, head, dir)).pass, false);
});

test("a one-commit git revert of production is exempt", async (t) => {
  const { dir, git } = makeRepo(t);
  commit(git, "initial");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const base = commit(git, "HTPR-4 [FEATURE] add widget");
  git(["revert", "--no-edit", base]);
  const head = git(["rev-parse", "HEAD"]).trim();
  const result = await evaluate('Revert "HTPR-4 [FEATURE] add widget"', base, head, dir);
  assert.equal(result.pass, true);
  assert.match(result.reason, /Verified auto-revert/);
});

test("a one-commit Auto-revert-of production commit is exempt", async (t) => {
  const { dir, git } = makeRepo(t);
  commit(git, "initial");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const base = commit(git, "HTPR-4 [FEATURE] add widget");
  git(["revert", "--no-commit", base]);
  const title = 'Revert "HTPR-4 [FEATURE] add widget"';
  git(["commit", "-q", "-m", title, "-m", `Auto-revert-of: ${base}`]);
  const head = git(["rev-parse", "HEAD"]).trim();
  const result = await evaluate(title, base, head, dir);
  assert.equal(result.pass, true);
  assert.match(result.reason, /Verified auto-revert/);
});

test("FEATURE UI changes without a flag fail", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir)).pass, false);
});

test("unrelated key text outside FEATURE_FLAG_DEFINITIONS does not pass", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/lib/flags.ts", flagsSource(undefined, undefined, 'const unrelated = { key: "htpr-5-widget" };\n'));
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir)).pass, false);
});

test("conditional and spread definitions cannot spoof a ticket flag", async (t) => {
  const conditional = makeRepo(t);
  const conditionalBase = commit(conditional.git, "base");
  writeFile(
    conditional.dir,
    "src/lib/flags.ts",
    'import { OTHER_FLAG } from "@/lib/flags/keys";\nconst enabled = false;\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: OTHER_FLAG },\n  enabled ? { key: "htpr-5-decoy" } : { key: OTHER_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n',
  );
  writeFile(conditional.dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const conditionalHead = commit(conditional.git, "conditional decoy");
  const conditionalResult = await evaluate("HTPR-5 [FEATURE] add widget", conditionalBase, conditionalHead, conditional.dir);
  assert.equal(conditionalResult.pass, false);
  assert.match(conditionalResult.reason, /direct object literals/);

  const spread = makeRepo(t);
  const spreadBase = commit(spread.git, "base");
  writeFile(
    spread.dir,
    "src/lib/flags.ts",
    'import { OTHER_FLAG } from "@/lib/flags/keys";\nconst existing = { key: OTHER_FLAG };\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: "htpr-5-decoy", ...existing },\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n',
  );
  writeFile(spread.dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const spreadHead = commit(spread.git, "spread decoy");
  const spreadResult = await evaluate("HTPR-5 [FEATURE] add widget", spreadBase, spreadHead, spread.dir);
  assert.equal(spreadResult.pass, false);
  assert.match(spreadResult.reason, /cannot contain object spreads/);
});

test("compound exported constants cannot spoof their runtime flag value", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(
    dir,
    "src/lib/flags/keys.ts",
    'export const OTHER_FLAG = "htpr-1-other";\nexport const DECOY_FLAG = "htpr-5-decoy".replace("decoy", "actual");\n',
  );
  writeFile(
    dir,
    "src/lib/flags.ts",
    'import { OTHER_FLAG, DECOY_FLAG } from "@/lib/flags/keys";\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: OTHER_FLAG },\n  { key: DECOY_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n',
  );
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "compound decoy");
  const result = await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.reason, /not an exported string constant/);
});

test("definition identifiers resolve their imports instead of matching registry names", async (t) => {
  const local = makeRepo(t);
  const localBase = commit(local.git, "base");
  writeFile(
    local.dir,
    "src/lib/flags.ts",
    'const OTHER_FLAG = "htpr-5-decoy";\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: OTHER_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n',
  );
  writeFile(local.dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const localHead = commit(local.git, "local decoy");
  const localResult = await evaluate("HTPR-5 [FEATURE] add widget", localBase, localHead, local.dir);
  assert.equal(localResult.pass, false);
  assert.match(localResult.reason, /unknown feature flag key constant/);

  const aliased = makeRepo(t);
  writeFile(aliased.dir, "src/lib/external-flags.ts", 'export const WRONG_FLAG = "htpr-9-wrong";\n');
  const aliasedBase = commit(aliased.git, "base");
  writeFile(
    aliased.dir,
    "src/lib/flags.ts",
    'import { WRONG_FLAG as OTHER_FLAG } from "@/lib/external-flags";\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: "htpr-1-other" },\n  { key: OTHER_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n',
  );
  writeFile(aliased.dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const aliasedHead = commit(aliased.git, "aliased decoy");
  const aliasedResult = await evaluate("HTPR-5 [FEATURE] add widget", aliasedBase, aliasedHead, aliased.dir);
  assert.equal(aliasedResult.pass, false);
  assert.match(aliasedResult.reason, /match this pull request/);
});

test("definitions resolve string constants imported from local modules", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/lib/external-flags.ts", 'export const EXTERNAL_FLAG =\n  "htpr-1-external";\n');
  writeFile(
    dir,
    "src/lib/flags.ts",
    'import { OTHER_FLAG } from "@/lib/flags/keys";\nimport { EXTERNAL_FLAG } from "@/lib/external-flags";\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: OTHER_FLAG },\n  { key: EXTERNAL_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE: FeatureFlagMode = "OWNER_AND_QA";\n',
  );
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "feature");
  const result = await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.reason, /without a feature flag/);
  assert.doesNotMatch(result.reason, /could not be parsed/);
});

test("flags added to production after a PR branches are not treated as PR removals", async (t) => {
  const { dir, git } = makeRepo(t);
  commit(git, "common base");
  const productionBranch = git(["branch", "--show-current"]).trim();
  git(["checkout", "-q", "-b", "pr"]);
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div /> : null;\n');
  const head = commit(git, "feature");
  git(["checkout", "-q", productionBranch]);
  writeFile(dir, "src/lib/flags/keys.ts", 'export const OTHER_FLAG = "htpr-1-other";\nexport const NEW_PRODUCTION_FLAG = "htpr-9-new";\n');
  writeFile(dir, "src/lib/flags.ts", 'import { OTHER_FLAG, NEW_PRODUCTION_FLAG } from "@/lib/flags/keys";\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: OTHER_FLAG },\n  { key: NEW_PRODUCTION_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n');
  const base = commit(git, "production advances");
  assert.equal((await evaluate("HTPR-1 [FEATURE] update widget", base, head, dir)).pass, true);
});

test("a ticket-specific definition without runtime use fails", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/lib/flags.ts", flagsSource(["OTHER_FLAG", '"htpr-5-widget"']));
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "feature");
  const result = await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.reason, /call useFlag\/isFeatureEnabled/);
});

test("a registered ticket-specific definition used in changed UI passes", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/lib/flags/keys.ts", 'export const OTHER_FLAG = "htpr-1-other";\nexport const WIDGET_FLAG = "htpr-5-widget";\n');
  writeFile(dir, "src/lib/flags.ts", 'import { OTHER_FLAG, WIDGET_FLAG } from "@/lib/flags/keys";\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: OTHER_FLAG },\n  { key: WIDGET_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n');
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { WIDGET_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(WIDGET_FLAG) ? <div /> : null;\n');
  const head = commit(git, "feature");
  const result = await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir);
  assert.equal(result.pass, true);
  assert.equal(result.ownerReview, "feature-gated-ui");
  assert.match(result.reason, /ticket-specific feature gate htpr-5-widget/);

  const partial = makeRepo(t);
  const partialBase = commit(partial.git, "base");
  writeFile(partial.dir, "src/components/Gated.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Gated = () => useFlag(OTHER_FLAG) ? <div /> : null;\n');
  writeFile(partial.dir, "src/components/Ungated.tsx", "export const Ungated = () => <div />;\n");
  const partialHead = commit(partial.git, "partially gated UI");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widgets", partialBase, partialHead, partial.dir)).pass, false);
});

test("an unused ticket-specific runtime call does not satisfy the gate", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/lib/flags/keys.ts", 'export const OTHER_FLAG = "htpr-1-other";\nexport const WIDGET_FLAG = "htpr-5-widget";\n');
  writeFile(dir, "src/lib/flags.ts", 'import { OTHER_FLAG, WIDGET_FLAG } from "@/lib/flags/keys";\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: OTHER_FLAG },\n  { key: WIDGET_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n');
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { WIDGET_FLAG } from "@/lib/flags/keys";\nexport function Widget() { useFlag(WIDGET_FLAG); return <div />; }\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir)).pass, false);

  const emptyBranch = makeRepo(t);
  const emptyBranchBase = commit(emptyBranch.git, "base");
  writeFile(emptyBranch.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport function Widget() { if (useFlag(OTHER_FLAG)) {} return <div />; }\n');
  const emptyBranchHead = commit(emptyBranch.git, "empty gate");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", emptyBranchBase, emptyBranchHead, emptyBranch.dir)).pass, false);

  const inertBranch = makeRepo(t);
  const inertBranchBase = commit(inertBranch.git, "base");
  writeFile(inertBranch.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport function Widget() { if (useFlag(OTHER_FLAG)) { const ignored = 1; } return <div />; }\n');
  const inertBranchHead = commit(inertBranch.git, "inert gate");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", inertBranchBase, inertBranchHead, inertBranch.dir)).pass, false);
});

test("a definition for another ticket or a changed default fails", async (t) => {
  const wrongTicket = makeRepo(t);
  const wrongTicketBase = commit(wrongTicket.git, "base");
  writeFile(wrongTicket.dir, "src/lib/flags.ts", flagsSource(["OTHER_FLAG", '"htpr-9-widget"']));
  writeFile(wrongTicket.dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const wrongTicketHead = commit(wrongTicket.git, "feature");
  assert.equal((await evaluate("HTPR-5 [FEATURE] add widget", wrongTicketBase, wrongTicketHead, wrongTicket.dir)).pass, false);

  const wrongDefault = makeRepo(t);
  const wrongDefaultBase = commit(wrongDefault.git, "base");
  writeFile(wrongDefault.dir, "src/lib/flags.ts", flagsSource(["OTHER_FLAG", '"htpr-5-widget"'], "EVERYONE"));
  writeFile(wrongDefault.dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const wrongDefaultHead = commit(wrongDefault.git, "feature");
  assert.equal((await evaluate("HTPR-5 [FEATURE] add widget", wrongDefaultBase, wrongDefaultHead, wrongDefault.dir)).pass, false);

  const changedDefault = makeRepo(t);
  const changedDefaultBase = commit(changedDefault.git, "base");
  writeFile(changedDefault.dir, "src/lib/flags.ts", flagsSource(["OTHER_FLAG"], "EVERYONE"));
  writeFile(changedDefault.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div /> : null;\n');
  const changedDefaultHead = commit(changedDefault.git, "change default");
  assert.equal((await evaluate("HTPR-1 [FEATURE] update widget", changedDefaultBase, changedDefaultHead, changedDefault.dir)).pass, false);
});

test("mutable feature flag policy declarations fail closed", async (t) => {
  const cases = [
    ["let definitions", flagsSource().replace("const FEATURE_FLAG_DEFINITIONS", "let FEATURE_FLAG_DEFINITIONS")],
    ["let default", flagsSource().replace("const DEFAULT_FEATURE_FLAG_MODE", "let DEFAULT_FEATURE_FLAG_MODE")],
    ["reassigned definitions", flagsSource(["OTHER_FLAG"], "OWNER_AND_QA", "FEATURE_FLAG_DEFINITIONS = [];\n")],
    ["mutated definitions", flagsSource(["OTHER_FLAG"], "OWNER_AND_QA", "FEATURE_FLAG_DEFINITIONS.push({ key: OTHER_FLAG });\n")],
    ["aliased definitions", flagsSource(["OTHER_FLAG"], "OWNER_AND_QA", "const escapedDefinitions = FEATURE_FLAG_DEFINITIONS;\n")],
    ["assignment alias", flagsSource(["OTHER_FLAG"], "OWNER_AND_QA", "let escapedDefinitions; escapedDefinitions = FEATURE_FLAG_DEFINITIONS;\n")],
    ["conditional alias", flagsSource(["OTHER_FLAG"], "OWNER_AND_QA", "const escapedDefinitions = true ? FEATURE_FLAG_DEFINITIONS : [];\n")],
    ["reassigned default", flagsSource(["OTHER_FLAG"], "OWNER_AND_QA", 'DEFAULT_FEATURE_FLAG_MODE = "EVERYONE";\n')],
    ["find result mutation", flagsSource(["OTHER_FLAG"], "OWNER_AND_QA", "const d = FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === OTHER_FLAG);\nd.key = \"evil\";\n")],
    ["find result re-alias mutation", flagsSource(["OTHER_FLAG"], "OWNER_AND_QA", "const d = FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === OTHER_FLAG);\nconst e = d;\ne.key = \"evil\";\n")],
    ["find result return escape", flagsSource(["OTHER_FLAG"], "OWNER_AND_QA", "export function leak() { return FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === OTHER_FLAG); }\n")],
    ["find result alias return escape", flagsSource(["OTHER_FLAG"], "OWNER_AND_QA", "const d = FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === OTHER_FLAG);\nexport function leak() { return d; }\n")],
    ["find result object literal escape", flagsSource(["OTHER_FLAG"], "OWNER_AND_QA", "const d = FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === OTHER_FLAG);\nexport const bag = { d };\n")],
    ["find result destructuring assignment", flagsSource(["OTHER_FLAG"], "OWNER_AND_QA", "const d = FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === OTHER_FLAG);\n({ value: d.key } = { value: \"evil\" });\n")],
    ["function expression callback", flagsSource(["OTHER_FLAG"], "OWNER_AND_QA", "FEATURE_FLAG_DEFINITIONS.map(function ({ key }) { return key; });\n")],
    ["block body callback", flagsSource(["OTHER_FLAG"], "OWNER_AND_QA", "FEATURE_FLAG_DEFINITIONS.map(({ key }) => { return key; });\n")],
    ["map callback element mutation", flagsSource(["OTHER_FLAG"], "OWNER_AND_QA", "FEATURE_FLAG_DEFINITIONS.map((row) => { row.key = \"evil\"; return row.key; });\n")],
    ["map rest alias", flagsSource(["OTHER_FLAG"], "OWNER_AND_QA", "FEATURE_FLAG_DEFINITIONS.map(({ key, ...rest }) => rest);\n")],
    ["non-key destructure", flagsSource(["OTHER_FLAG"], "OWNER_AND_QA", "FEATURE_FLAG_DEFINITIONS.map(({ description }) => description);\n")],
    ["find result method call", flagsSource(["OTHER_FLAG"], "OWNER_AND_QA", "const d = FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === OTHER_FLAG);\nd.toString();\n")],
    ["find result chained method call", flagsSource(["OTHER_FLAG"], "OWNER_AND_QA", "FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === OTHER_FLAG)?.toString();\n")],
    ["find result nested property write", flagsSource(["OTHER_FLAG"], "OWNER_AND_QA", "FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === OTHER_FLAG).meta.label = \"evil\";\n")],
  ];

  for (const [name, source] of cases) {
    const { dir, git } = makeRepo(t);
    const base = commit(git, "base");
    writeFile(dir, "src/lib/flags.ts", source);
    writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div /> : null;\n');
    const head = commit(git, name);
    const result = await evaluate("HTPR-1 [FEATURE] update widget", base, head, dir);
    assert.equal(result.pass, false, name);
    assert.match(result.reason, /declared const|must not be reassigned, aliased, or mutated/, name);
  }

  const allowed = makeRepo(t);
  const allowedBase = commit(allowed.git, "base");
  writeFile(
    allowed.dir,
    "src/lib/flags.ts",
    flagsSource(
      ["OTHER_FLAG"],
      "OWNER_AND_QA",
      "export const FEATURE_FLAG_KEYS = FEATURE_FLAG_DEFINITIONS.map(({ key }) => key);\nfunction describe(row) {\n  const definition = FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === row.key);\n  return definition?.description ?? \"missing\";\n}\n",
    ),
  );
  writeFile(allowed.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div /> : null;\n');
  const allowedHead = commit(allowed.git, "safe map find reads");
  assert.equal((await evaluate("HTPR-1 [FEATURE] update widget", allowedBase, allowedHead, allowed.dir)).pass, true);
});

test("the production per-flag default lookup passes but a mutated find alias fails", async (t) => {
  const source = fs.readFileSync(path.join(root, "src/lib/flags.ts"), "utf8");
  const lookup = source.match(/(?:export )?function defaultFeatureFlagMode\(key: string\): FeatureFlagMode \{[\s\S]*?\n\}/)?.[0];
  assert.ok(lookup, "test the actual production lookup");
  for (const mutate of [false, true]) {
    const { dir, git } = makeRepo(t);
    const base = commit(git, "base");
    writeFile(dir, "src/lib/flags.ts", flagsSource(["OTHER_FLAG"], "OWNER_AND_QA",
      `const DEFAULT_BUGFIX_FLAG_MODE = "EVERYONE";\n${lookup}\n` +
      (mutate ? 'const definition = FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === OTHER_FLAG);\nconst alias = definition;\nalias.defaultMode = "EVERYONE";\n' : "")));
    writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div /> : null;\n');
    const head = commit(git, "default lookup");
    const result = await evaluate("HTPR-1 [FEATURE] update widget", base, head, dir);
    assert.equal(result.pass, !mutate, result.reason);
    if (mutate) assert.match(result.reason, /must not be reassigned, aliased, or mutated/);
  }
});

test("an imported registered key used by useFlag passes", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div /> : null;\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", base, head, dir)).pass, true);

  const defaultImport = makeRepo(t);
  const defaultBase = commit(defaultImport.git, "base");
  writeFile(
    defaultImport.dir,
    "src/lib/flags.ts",
    'import flagsKeys, { OTHER_FLAG } from "@/lib/flags/keys";\nvoid flagsKeys;\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: OTHER_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n',
  );
  writeFile(defaultImport.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div /> : null;\n');
  const defaultHead = commit(defaultImport.git, "default plus named import");
  assert.equal(
    (await evaluate("HTPR-1 [FEATURE] add widget", defaultBase, defaultHead, defaultImport.dir)).pass,
    true,
  );
});

test("a multiline gate with a changed key argument passes", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/lib/flags/keys.ts", 'export const OTHER_FLAG = "htpr-1-other";\nexport const OLD_FLAG = "htpr-9-old";\n');
  writeFile(dir, "src/lib/flags.ts", 'import { OTHER_FLAG, OLD_FLAG } from "@/lib/flags/keys";\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: OTHER_FLAG },\n  { key: OLD_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n');
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG, OLD_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(\n  OLD_FLAG,\n) ? <div /> : null;\n');
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG, OLD_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(\n  OTHER_FLAG,\n) ? <div /> : null;\n');
  const head = commit(git, "change gate key");
  assert.equal((await evaluate("HTPR-1 [FEATURE] update widget", base, head, dir)).pass, true);
});

test("a changed ticket-specific hook assignment used as a condition passes", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport function Widget() { const enabled = useFlag(OTHER_FLAG); return enabled ? <div /> : null; }\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", base, head, dir)).pass, true);

  const mutable = makeRepo(t);
  const mutableBase = commit(mutable.git, "base");
  writeFile(mutable.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport function Widget() { let enabled = useFlag(OTHER_FLAG); enabled = true; return enabled ? <div /> : null; }\n');
  const mutableHead = commit(mutable.git, "overwritten gate");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", mutableBase, mutableHead, mutable.dir)).pass, false);

  const imported = makeRepo(t);
  const importedBase = commit(imported.git, "base");
  writeFile(imported.dir, "src/components/gateResult.ts", "export function showWidget(ready, enabled) { return ready && enabled; }\n");
  writeFile(imported.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nimport { showWidget } from "./gateResult";\nexport function Widget() { const enabled = useFlag(OTHER_FLAG); return showWidget(window.ready, enabled) ? <div /> : null; }\n');
  const importedHead = commit(imported.git, "imported gate");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", importedBase, importedHead, imported.dir)).pass, true);

  const invariant = makeRepo(t);
  const invariantBase = commit(invariant.git, "base");
  writeFile(invariant.dir, "src/components/gateResult.ts", 'export function showWidget(enabled) { if (enabled) console.log("on"); return true; }\n');
  writeFile(invariant.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nimport { showWidget } from "./gateResult";\nexport function Widget() { const enabled = useFlag(OTHER_FLAG); return showWidget(enabled) ? <div /> : null; }\n');
  const invariantHead = commit(invariant.git, "invariant imported wrapper");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", invariantBase, invariantHead, invariant.dir)).pass, false);
});

test("typed flag registries and definition arrays are parsed", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/lib/flags/keys.ts", 'export const OTHER_FLAG: FeatureFlagKey = `htpr-1-other`;\n');
  writeFile(dir, "src/lib/flags.ts", 'import { OTHER_FLAG } from "@/lib/flags/keys";\nconst FEATURE_FLAG_DEFINITIONS: FeatureFlagDefinition[] = [\n  { key: OTHER_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE: FeatureFlagMode = "OWNER_AND_QA";\n');
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div /> : null;\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", base, head, dir)).pass, true);
});

test("runtime gate calls inside template expressions are parsed", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => `${useFlag(OTHER_FLAG) ? "on" : "off"}`;\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", base, head, dir)).pass, true);
});

test("JSX apostrophes do not break runtime gate parsing", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", `import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <p>\nUsers' settings don't load\n</p> : null;\n`);
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", base, head, dir)).pass, true);
});

test("an unrelated existing runtime gate does not cover changed UI", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div>old</div> : null;\n');
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div>new</div> : null;\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-5 [FEATURE] update widget", base, head, dir)).pass, false);
});

test("a deleted UI file does not abort scanning another gated file", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/components/ADeleted.tsx", "export const Deleted = () => null;\n");
  writeFile(dir, "src/components/ZWidget.tsx", "export const Widget = () => null;\n");
  const base = commit(git, "base");
  fs.rmSync(path.join(dir, "src/components/ADeleted.tsx"));
  writeFile(dir, "src/components/ZWidget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div /> : null;\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-1 [FEATURE] update widget", base, head, dir)).pass, true);
});

test("CSS and other non-code UI files do not abort runtime-call scanning", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Theme.css", ".widget { color: red; }\n");
  writeFile(dir, "src/components/Widget.tsx", 'import "./Theme.css";\nimport { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div /> : null;\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", base, head, dir)).pass, true);
});

test("a key added only to the registry cannot count as an existing runtime gate", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/lib/flags/keys.ts", 'export const OTHER_FLAG = "htpr-1-other";\nexport const DECOY_FLAG = "htpr-5-decoy";\n');
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { DECOY_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(DECOY_FLAG) ? <div /> : null;\n');
  const head = commit(git, "registry-only decoy");
  assert.equal((await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir)).pass, false);
});

test("parenless new expressions near a gate do not crash the evaluator", async (t) => {
  const nested = makeRepo(t);
  const nestedBase = commit(nested.git, "base");
  writeFile(
    nested.dir,
    "src/components/Widget.tsx",
    'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nclass On {}\nclass Off {}\nexport function Widget() {\n  const enabled = useFlag(OTHER_FLAG);\n  const instance = new (enabled ? On : Off);\n  return instance ? <div /> : null;\n}\n',
  );
  const nestedHead = commit(nested.git, "parenless new nested");
  const nestedResult = await evaluate("HTPR-1 [FEATURE] add widget", nestedBase, nestedHead, nested.dir);
  assert.equal(typeof nestedResult.pass, "boolean");
  assert.doesNotMatch(nestedResult.reason || "", /Cannot read properties of undefined|could not be parsed/);

  const sibling = makeRepo(t);
  const siblingBase = commit(sibling.git, "base");
  writeFile(
    sibling.dir,
    "src/components/Widget.tsx",
    'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nclass Off {}\nexport function Widget() {\n  const enabled = useFlag(OTHER_FLAG);\n  void new Off;\n  return enabled ? <div /> : null;\n}\n',
  );
  const siblingHead = commit(sibling.git, "parenless new sibling");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", siblingBase, siblingHead, sibling.dir)).pass, true);
});

test("statically unreachable helper calls do not count as runtime gates", async (t) => {
  const shortCircuit = makeRepo(t);
  const shortCircuitBase = commit(shortCircuit.git, "base");
  writeFile(shortCircuit.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => false && useFlag(OTHER_FLAG) ? <div /> : null;\n');
  const shortCircuitHead = commit(shortCircuit.git, "dead short circuit");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", shortCircuitBase, shortCircuitHead, shortCircuit.dir)).pass, false);

  const returned = makeRepo(t);
  const returnedBase = commit(returned.git, "base");
  writeFile(returned.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport function Widget() { return <div />; useFlag(OTHER_FLAG); }\n');
  const returnedHead = commit(returned.git, "dead return");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", returnedBase, returnedHead, returned.dir)).pass, false);

  const deadReference = makeRepo(t);
  const deadReferenceBase = commit(deadReference.git, "base");
  writeFile(deadReference.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport function Widget() { const enabled = useFlag(OTHER_FLAG); if (false) { if (enabled) return <div />; } return <div />; }\n');
  const deadReferenceHead = commit(deadReference.git, "dead reference");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", deadReferenceBase, deadReferenceHead, deadReference.dir)).pass, false);

  const invariant = makeRepo(t);
  const invariantBase = commit(invariant.git, "base");
  writeFile(invariant.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) || true ? <div /> : null;\n');
  const invariantHead = commit(invariant.git, "invariant condition");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", invariantBase, invariantHead, invariant.dir)).pass, false);

  const nestedInvariant = makeRepo(t);
  const nestedInvariantBase = commit(nestedInvariant.git, "base");
  writeFile(nestedInvariant.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => (useFlag(OTHER_FLAG) && window.ready) || true ? <div /> : null;\n');
  const nestedInvariantHead = commit(nestedInvariant.git, "nested invariant condition");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", nestedInvariantBase, nestedInvariantHead, nestedInvariant.dir)).pass, false);

  const comma = makeRepo(t);
  const commaBase = commit(comma.git, "base");
  writeFile(comma.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport function Widget() { if ((useFlag(OTHER_FLAG), true)) return <div />; return null; }\n');
  const commaHead = commit(comma.git, "comma condition");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", commaBase, commaHead, comma.dir)).pass, false);

  const wrapped = makeRepo(t);
  const wrappedBase = commit(wrapped.git, "base");
  writeFile(wrapped.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nconst alwaysTrue = (_value) => true;\nexport function Widget() { if (alwaysTrue(useFlag(OTHER_FLAG))) return <div />; return null; }\n');
  const wrappedHead = commit(wrapped.git, "opaque condition");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", wrappedBase, wrappedHead, wrapped.dir)).pass, false);

  const callback = makeRepo(t);
  const callbackBase = commit(callback.git, "base");
  writeFile(callback.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\ndeclare function launchFeature();\nexport function Widget() { useFlag(OTHER_FLAG) && (() => launchFeature()); return <div />; }\n');
  const callbackHead = commit(callback.git, "uninvoked callback");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", callbackBase, callbackHead, callback.dir)).pass, false);

  const unusedHelper = makeRepo(t);
  const unusedHelperBase = commit(unusedHelper.git, "base");
  writeFile(unusedHelper.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nfunction gatedHelper() { if (useFlag(OTHER_FLAG)) return <div />; return null; }\nexport function Widget() { return <div />; }\n');
  const unusedHelperHead = commit(unusedHelper.git, "unused helper gate");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", unusedHelperBase, unusedHelperHead, unusedHelper.dir)).pass, false);

  const nestedUnused = makeRepo(t);
  const nestedUnusedBase = commit(nestedUnused.git, "base");
  writeFile(nestedUnused.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport function Widget() { function gatedHelper() { if (useFlag(OTHER_FLAG)) return <div />; return null; } return <div />; }\n');
  const nestedUnusedHead = commit(nestedUnused.git, "nested unused helper");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", nestedUnusedBase, nestedUnusedHead, nestedUnused.dir)).pass, false);

  const exportedUnused = makeRepo(t);
  const exportedUnusedBase = commit(exportedUnused.git, "base");
  writeFile(exportedUnused.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport function gatedHelper() { if (useFlag(OTHER_FLAG)) return <div />; return null; }\nexport function Widget() { return <div />; }\n');
  const exportedUnusedHead = commit(exportedUnused.git, "exported unused helper");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", exportedUnusedBase, exportedUnusedHead, exportedUnused.dir)).pass, false);

  const otherFlagCover = makeRepo(t);
  const otherFlagCoverBase = commit(otherFlagCover.git, "base");
  writeFile(otherFlagCover.dir, "src/lib/flags/keys.ts", 'export const OTHER_FLAG = "htpr-1-other";\nexport const OLD_FLAG = "htpr-9-old";\n');
  writeFile(otherFlagCover.dir, "src/lib/flags.ts", 'import { OTHER_FLAG, OLD_FLAG } from "@/lib/flags/keys";\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: OTHER_FLAG },\n  { key: OLD_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n');
  writeFile(otherFlagCover.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG, OLD_FLAG } from "@/lib/flags/keys";\nexport function Gated() { return useFlag(OTHER_FLAG) ? <div /> : null; }\nexport function Ungated() { return useFlag(OLD_FLAG) ? <span /> : null; }\n');
  const otherFlagCoverHead = commit(otherFlagCover.git, "other flag cover");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", otherFlagCoverBase, otherFlagCoverHead, otherFlagCover.dir)).pass, false);

  const nullishBranches = makeRepo(t);
  const nullishBranchesBase = commit(nullishBranches.git, "base");
  writeFile(nullishBranches.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport function Widget() { return useFlag(OTHER_FLAG) ? null : undefined; }\n');
  const nullishBranchesHead = commit(nullishBranches.git, "nullish branches");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", nullishBranchesBase, nullishBranchesHead, nullishBranches.dir)).pass, false);

  const emptyFragments = makeRepo(t);
  const emptyFragmentsBase = commit(emptyFragments.git, "base");
  writeFile(emptyFragments.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport function Widget() { return useFlag(OTHER_FLAG) ? null : <></>; }\n');
  const emptyFragmentsHead = commit(emptyFragments.git, "empty fragment branch");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", emptyFragmentsBase, emptyFragmentsHead, emptyFragments.dir)).pass, false);

  const falseNull = makeRepo(t);
  const falseNullBase = commit(falseNull.git, "base");
  writeFile(falseNull.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport function Widget() { return useFlag(OTHER_FLAG) ? false : null; }\n');
  const falseNullHead = commit(falseNull.git, "false null branch");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", falseNullBase, falseNullHead, falseNull.dir)).pass, false);

  const zeroGuard = makeRepo(t);
  const zeroGuardBase = commit(zeroGuard.git, "base");
  writeFile(zeroGuard.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport function Widget() { if (0) { if (useFlag(OTHER_FLAG)) return <div />; } return <div />; }\n');
  const zeroGuardHead = commit(zeroGuard.git, "zero guard");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", zeroGuardBase, zeroGuardHead, zeroGuard.dir)).pass, false);

  const deadSelfCall = makeRepo(t);
  const deadSelfCallBase = commit(deadSelfCall.git, "base");
  writeFile(deadSelfCall.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nfunction gatedHelper() { if (useFlag(OTHER_FLAG)) return <div />; gatedHelper(); return null; }\nexport function Widget() { return <div />; }\n');
  const deadSelfCallHead = commit(deadSelfCall.git, "self call helper");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", deadSelfCallBase, deadSelfCallHead, deadSelfCall.dir)).pass, false);

  const identicalBranches = makeRepo(t);
  const identicalBranchesBase = commit(identicalBranches.git, "base");
  writeFile(identicalBranches.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport function Widget() { return useFlag(OTHER_FLAG) ? null : null; }\n');
  const identicalBranchesHead = commit(identicalBranches.git, "identical branches");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", identicalBranchesBase, identicalBranchesHead, identicalBranches.dir)).pass, false);

  const identicalReturns = makeRepo(t);
  const identicalReturnsBase = commit(identicalReturns.git, "base");
  writeFile(identicalReturns.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport function Widget() { if (useFlag(OTHER_FLAG)) return null; else return null; }\n');
  const identicalReturnsHead = commit(identicalReturns.git, "identical returns");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", identicalReturnsBase, identicalReturnsHead, identicalReturns.dir)).pass, false);
});

test("comments, strings, JSX text, regexes, and shadowed helpers do not count as gate calls", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\n// useFlag(OTHER_FLAG)\nconst note = "useFlag(OTHER_FLAG)";\nconst pattern = /useFlag(OTHER_FLAG)/;\nconst OTHER_FLAG_SUFFIX = true;\nfunction fake(useFlag) { return useFlag(OTHER_FLAG); }\nexport const Widget = () => <p>useFlag(OTHER_FLAG)</p>;\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", base, head, dir)).pass, false);
});

test("a registered literal passed to isFeatureEnabled counts", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/app/page.tsx", 'import { isFeatureEnabled } from "@/lib/flags";\nexport async function Page() { return await isFeatureEnabled("htpr-1-other", 6) ? <div /> : null; }\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", base, head, dir)).pass, true);
});

test("missing tags produce a useful failure instead of [null]", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "feature");
  const result = await evaluate("add widget", base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.reason, /no valid HTPR or HYFA ticket and tag/);
  assert.doesNotMatch(result.reason, /\[null\]/);
});

test("workflow covers metadata changes, uses trusted code, and reconciles old PRs", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/feature-flag-gate.yml"), "utf8");
  assert.match(workflow, /pull_request_target:/);
  assert.doesNotMatch(workflow, /^  pull_request\s*:/m);
  assert.match(workflow, /types: \[opened, synchronize, reopened, edited, ready_for_review, labeled, unlabeled, closed\]/);
  assert.doesNotMatch(workflow, /pull_request_target:\s+branches: \[production\]/);
  assert.match(workflow, /github\.event\.pull_request\.base\.ref == 'production'/);
  assert.doesNotMatch(workflow, /push:/);
  assert.match(workflow, /cron: "\*\/15 \* \* \* \*"/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.event\.action != 'closed'/);
  assert.match(workflow, /if: github\.event_name == 'schedule'/);
  assert.match(workflow, /timeout-minutes: 5/);
  assert.ok(workflow.includes("group: feature-flag-gate-production"));
  assert.match(workflow, /cancel-in-progress: false/);
  assert.equal((workflow.match(/cache: npm/g) || []).length, 2);
  assert.equal((workflow.match(/cache-dependency-path: \.github\/scripts\/feature-flag-parser\/package-lock\.json/g) || []).length, 2);
  assert.equal((workflow.match(/npm ci --prefix "\$parser_dir" --ignore-scripts --no-audit --no-fund/g) || []).length, 2);
  assert.equal((workflow.match(/FEATURE_FLAG_TYPESCRIPT_PATH/g) || []).length, 2);
  const parserLock = JSON.parse(fs.readFileSync(path.join(root, ".github/scripts/feature-flag-parser/package-lock.json"), "utf8"));
  assert.equal(parserLock.packages["node_modules/typescript"].version, "6.0.3");
  assert.match(parserLock.packages["node_modules/typescript"].integrity, /^sha512-/);
  assert.equal((workflow.match(/ref: production/g) || []).length, 2);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /gh_api "repos\/\$REPO\/pulls\/\$PR_NUMBER"/);
  assert.match(workflow, /git fetch --no-tags origin \+refs\/heads\/production:refs\/remotes\/origin\/production "refs\/pull\/\$PR_NUMBER\/head"/);
  assert.equal((workflow.match(/git fetch --no-tags origin \+refs\/heads\/production:refs\/remotes\/origin\/production/g) || []).length, 2);
  assert.match(workflow, /--argjson labels "\$FEATURE_FLAG_PR_LABELS"/);
  assert.equal((workflow.match(/--argjson labels "\$FEATURE_FLAG_PR_LABELS"/g) || []).length, 2);
  assert.equal((workflow.match(/git rev-parse HEAD\)" != "\$\(git rev-parse origin\/production\)/g) || []).length, 2);
  assert.match(workflow, /Trusted production checkout drifted/);
  assert.doesNotMatch(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(workflow, /types: \[opened, synchronize, reopened, edited, ready_for_review, labeled, unlabeled, closed\]/);
  assert.match(workflow, /FEATURE_FLAG_PR_LABELS/);
  assert.match(workflow, /EVENT_HEAD_SHA/);
  assert.match(workflow, /statuses: write/);
  assert.equal((workflow.match(/state: "pending"/g) || []).length, 1);
  assert.equal((workflow.match(/mark feature-flag-gate pending/g) || []).length, 1);
  assert.match(workflow, /publish_error_status/);
  assert.match(workflow, /publish_reconciliation_error/);
  assert.match(workflow, /publish_status_if_changed/);
  assert.match(workflow, /commits\/\$head_sha\/statuses\?per_page=100/);
  assert.match(workflow, /publishing without deduplication/);
  assert.match(workflow, /\$current\.state == \$state and \$current\.description == \$description/);
  assert.doesNotMatch(workflow, /feature-flag-gate is reconciling this pull request/);
  assert.match(workflow, /could not refresh pull-request heads/);
  assert.ok(workflow.indexOf('state: "pending"') < workflow.indexOf('gh_api "repos/$REPO/pulls/$PR_NUMBER"'));
  assert.ok(workflow.indexOf("open-heads.txt") < workflow.lastIndexOf('npm ci --prefix "$parser_dir"'));
  assert.ok(workflow.indexOf('state: "pending"') < workflow.indexOf("elif node .github/scripts/feature-flag-gate.mjs"));
  assert.match(workflow, /statuses\/\$head_sha/);
  assert.match(workflow, /gh_api --paginate --slurp/);
  assert.equal((workflow.match(/elif node \.github\/scripts\/feature-flag-gate\.mjs/g) || []).length, 2);
  assert.doesNotMatch(workflow, /^\s+node \.github\/scripts\/feature-flag-gate\.mjs/m);
  assert.match(workflow, /head_pr_count.*flatten\[\].*\.head\.sha == \$sha/);
  assert.match(workflow, /fresh_head_pr_count/);
  assert.match(workflow, /shared by multiple open production pull requests/);
  assert.match(workflow, /jq -c 'flatten\[\]' \"\$pages\"/);
  assert.doesNotMatch(workflow, /jq -ce 'flatten\[\]'/);
  assert.match(workflow, /changed during evaluation/);
  assert.doesNotMatch(workflow, /pull-requests: write/);
});

test("Factory ticket flags retain exact prefix and owner-only preview requirements", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/lib/flags/keys.ts", 'export const OTHER_FLAG = "htpr-1-other";\nexport const WIDGET_FLAG = "hyfa-5-widget";\n');
  writeFile(dir, "src/lib/flags.ts", 'import { OTHER_FLAG, WIDGET_FLAG } from "@/lib/flags/keys";\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: OTHER_FLAG },\n  { key: WIDGET_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n');
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { WIDGET_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(WIDGET_FLAG) ? <div /> : null;\n');
  const head = commit(git, "feature");
  const result = await evaluate("HYFA-5 [FEATURE] add widget", base, head, dir);
  assert.equal(result.pass, true);
  assert.equal(result.ownerReview, "feature-gated-ui");
  assert.match(result.reason, /ticket-specific feature gate hyfa-5-widget/);

  for (const title of ['HTPR-5 [FEATURE] wrong board', 'HYFA-6 [FEATURE] wrong ticket', 'OTHER-5 [FEATURE] foreign', 'HYFAA-5 [FEATURE] lookalike']) {
    assert.equal((await evaluate(title,base,head,dir)).pass,false,title);
  }
  writeFile(dir, 'src/components/Ungated.tsx', 'export const Ungated = () => <div />;\n');
  const ungated=commit(git,'ungated addition');
  assert.equal((await evaluate('HYFA-5 [FEATURE] add widget',base,ungated,dir)).pass,false);
});

test("literal default mode permits production reads but still rejects binding writes", async (t) => {
  const {dir,git}=makeRepo(t);
  writeFile(dir, "src/lib/flags.ts", flagsSource(["OTHER_FLAG"], "OWNER_AND_QA", `
export function resolve(row) { const mode = row?.mode ?? DEFAULT_FEATURE_FLAG_MODE; return mode; }
export function create() { return { mode: DEFAULT_FEATURE_FLAG_MODE }; }
const copy = DEFAULT_FEATURE_FLAG_MODE;
consume(DEFAULT_FEATURE_FLAG_MODE);
const bag = { mode: DEFAULT_FEATURE_FLAG_MODE }; bag.mode = "EVERYONE";
`));
  const base=commit(git,"production-style reads");
  writeFile(dir,"src/components/Widget.tsx",'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div /> : null;\n');
  const head=commit(git,"gated UI");
  const result=await evaluate("HTPR-1 [FEATURE] widget",base,head,dir);
  assert.equal(result.pass,true,result.reason);
  for (const mutation of ['DEFAULT_FEATURE_FLAG_MODE = "EVERYONE";', 'DEFAULT_FEATURE_FLAG_MODE += "EVERYONE";', 'DEFAULT_FEATURE_FLAG_MODE++;', '({mode: DEFAULT_FEATURE_FLAG_MODE} = {mode: "EVERYONE"});']) {
    writeFile(dir,"src/lib/flags.ts",flagsSource(["OTHER_FLAG"],"OWNER_AND_QA",mutation));
    const changed=commit(git,"binding mutation");
    const rejected=await evaluate("HTPR-1 [FEATURE] widget",base,changed,dir);
    assert.equal(rejected.pass,false,mutation);assert.match(rejected.reason,/must not be reassigned/);
  }
});

test('identifier default exports are live and retain ungated sibling protection', async (t) => {
  const cases = [
    ['arrow default', 'const Widget=()=>{const enabled=useFlag(OTHER_FLAG);return enabled?<div/>:null;};export default Widget;', true],
    ['function default', 'function Widget(){const enabled=useFlag(OTHER_FLAG);return enabled?<div/>:null;}export default Widget;', true],
    ['unused gated sibling', 'export function Gated(){return useFlag(OTHER_FLAG)?<span/>:null;}const Widget=()=> <div/>;export default Widget;', false],
    ['shadowed gate value', 'const Widget=()=>{const enabled=useFlag(OTHER_FLAG);{const enabled=true;return enabled?<div/>:null;}};export default Widget;', false],
    ['dead gate', 'const Widget=()=>{if(false){return useFlag(OTHER_FLAG)?<div/>:null;}return <div/>;};export default Widget;', false],
  ];
  for (const [name, body, expected] of cases) {
    const fixture=makeRepo(t),base=commit(fixture.git,'base');
    writeFile(fixture.dir,'src/components/Widget.tsx','import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\n'+body+'\n');
    const head=commit(fixture.git,name);
    assert.equal((await evaluate('HTPR-1 [FEATURE] preview widget',base,head,fixture.dir)).pass,expected,name);
  }
});

test('live hooks expose only reachable returned callbacks with matching symbols', async (t) => {
  const cases = [
    ['shorthand callback', 'const onSave=()=>{if(enabled)doWork();};return {onSave};', true],
    ['named callback property', 'const onSave=()=>{if(enabled)doWork();};return {save:onSave};', true],
    ['omitted callback', 'const onSave=()=>{if(enabled)doWork();};return {};', false],
    ['dead callback return', 'const onSave=()=>{if(enabled)doWork();};if(false)return {onSave};return {};', false],
    ['shadowed returned callback', 'const onSave=()=>{if(enabled)doWork();};{const onSave=()=>doWork();return {onSave};}', false],
    ['unused nested return', 'const onSave=()=>{if(enabled)doWork();};const unused=()=>({onSave});return {};', false],
    ['overwritten callback', 'const onSave=()=>{if(enabled)doWork();};const ungated=()=>doWork();return {handler:onSave,handler:ungated};', false],
    ['spread override', 'const onSave=()=>{if(enabled)doWork();};const override={handler:()=>doWork()};return {handler:onSave,...override};', false],
    ['computed key override', 'const onSave=()=>{if(enabled)doWork();};const key="handler";return {handler:onSave,[key]:()=>doWork()};', false],
    ['quoted duplicate key', 'const onSave=()=>{if(enabled)doWork();};return {handler:onSave,"handler":()=>doWork()};', false],
  ];
  for (const [name,body,expected] of cases) {
    const fixture=makeRepo(t),base=commit(fixture.git,'base');
    writeFile(fixture.dir,'src/hooks/usePreview.ts','import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\ndeclare function doWork();\nexport function usePreview(){const enabled=useFlag(OTHER_FLAG);'+body+'}\n');
    const head=commit(fixture.git,name);
    assert.equal((await evaluate('HTPR-1 [FEATURE] preview widget',base,head,fixture.dir)).pass,expected,name);
  }
});

test('rebound default exports cannot certify their earlier gated initializer', async (t) => {
  const cases = [
    ['direct write', 'Widget=()=> <div/>;', false],
    ['compound write', 'Widget&&=()=> <div/>;', false],
    ['object destructuring', '({replacement:Widget}={replacement:()=> <div/>});', false],
    ['shorthand destructuring', '({Widget}={Widget:()=> <div/>});', false],
    ['array destructuring', '[Widget]=[()=> <div/>];', false],
    ['array rest destructuring', '[...Widget]=[()=> <div/>];', false],
    ['loop write', 'for(Widget of [()=> <div/>]){}', false],
    ['of object target','for({replacement:Widget} of values){}',false],
    ['of shorthand target','for({Widget} of values){}',false],
    ['of array target','for([Widget] of values){}',false],
    ['of nested target','for({items:[{handler:Widget}]} of values){}',false],
    ['of rest target','for([...Widget] of values){}',false],
    ['in object target','for({replacement:Widget} in values){}',false],
    ['in shorthand target','for({Widget} in values){}',false],
    ['in array target','for([Widget] in values){}',false],
    ['in nested target','for({items:[{handler:Widget}]} in values){}',false],
    ['in rest target','for([...Widget] in values){}',false],
    ['shadowed loop target','{let Widget;for({Widget} of values){}}',true],
    ['shadowed write', '{let Widget=()=> <span/>;Widget=()=> <div/>;}', true],
  ];
  for(const [name,write,expected] of cases){
    const fixture=makeRepo(t),base=commit(fixture.git,'base');
    writeFile(fixture.dir,'src/components/Widget.tsx','import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\nlet Widget=()=>useFlag(OTHER_FLAG)?<div/>:null;\n'+write+'\nexport default Widget;\n');
    assert.equal((await evaluate('HTPR-1 [FEATURE] preview widget',base,commit(fixture.git,name),fixture.dir)).pass,expected,name);
  }
  for(const exported of ['', 'export ']){
    const fixture=makeRepo(t),base=commit(fixture.git,'base');
    writeFile(fixture.dir,'src/components/Widget.tsx','import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\n'+exported+'function Widget(){return useFlag(OTHER_FLAG)?<div/>:null;}\nWidget=()=> <div/>;\nexport function Helper(){return useFlag(OTHER_FLAG)?<span/>:null;}\nexport default Widget;\n');
    assert.equal((await evaluate('HTPR-1 [FEATURE] preview widget',base,commit(fixture.git,'rebound function and gated sibling'),fixture.dir)).pass,false);
  }
});

test('returned callback liveness rejects rebinding without confusing shadowed symbols', async (t) => {
  const cases = [
    ['direct write','onSave=()=>doWork();',false],
    ['compound write','onSave&&=()=>doWork();',false],
    ['object destructuring','({handler:onSave}={handler:()=>doWork()});',false],
    ['shorthand destructuring','({onSave}={onSave:()=>doWork()});',false],
    ['array destructuring','[onSave]=[()=>doWork()];',false],
    ['array rest destructuring','[...onSave]=[()=>doWork()];',false],
    ['of object target','for({replacement:onSave} of values){}',false],
    ['of shorthand target','for({onSave} of values){}',false],
    ['of array target','for([onSave] of values){}',false],
    ['of nested target','for({items:[{handler:onSave}]} of values){}',false],
    ['of rest target','for([...onSave] of values){}',false],
    ['in object target','for({replacement:onSave} in values){}',false],
    ['in shorthand target','for({onSave} in values){}',false],
    ['in array target','for([onSave] in values){}',false],
    ['in nested target','for({items:[{handler:onSave}]} in values){}',false],
    ['in rest target','for([...onSave] in values){}',false],
    ['shadowed loop target','{let onSave;for({onSave} of values){}}',true],
    ['shadowed write','{let onSave=()=>doWork();onSave=()=>doWork();}',true],
  ];
  for(const [name,write,expected] of cases){
    const fixture=makeRepo(t),base=commit(fixture.git,'base');
    writeFile(fixture.dir,'src/hooks/usePreview.ts','import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\ndeclare function doWork();\nexport function usePreview(){const enabled=useFlag(OTHER_FLAG);let onSave=()=>{if(enabled)doWork();};'+write+'return {onSave};}\n');
    assert.equal((await evaluate('HTPR-1 [FEATURE] preview widget',base,commit(fixture.git,name),fixture.dir)).pass,expected,name);
  }
  const fixture=makeRepo(t),base=commit(fixture.git,'base');
  writeFile(fixture.dir,'src/hooks/usePreview.ts','import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\ndeclare function doWork();\nexport function usePreview(){const enabled=useFlag(OTHER_FLAG);function onSave(){if(enabled)doWork();}onSave=()=>doWork();return {onSave};}\n');
  assert.equal((await evaluate('HTPR-1 [FEATURE] preview widget',base,commit(fixture.git,'rebound function callback'),fixture.dir)).pass,false);
});

test("bugfix registry kind permits Everyone while feature and improvement defaults stay restricted", async (t) => {
  for (const kind of [undefined, "feature", "improvement", "bugfix"]) {
    const { dir, git } = makeRepo(t);
    const base = commit(git, "base");
    const source = flagsSource(["OTHER_FLAG"])
      .replace('description: "fixture"', `description: "fixture"${kind ? `, kind: "${kind}"` : ""}`) +
      'const DEFAULT_BUGFIX_FLAG_MODE = "EVERYONE";\n';
    writeFile(dir, "src/lib/flags.ts", source);
    writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div /> : null;\n');
    const head = commit(git, "kind defaults");
    assert.equal((await evaluate("HTPR-1 [FEATURE] gated widget", base, head, dir)).pass, true, kind);
    // Neither a feature nor an exempt bugfix title may widen the feature default.
    writeFile(dir, "src/lib/flags.ts", source.replace('DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA"', 'DEFAULT_FEATURE_FLAG_MODE = "EVERYONE"'));
    const widened = commit(git, "invalid feature default");
    for (const tag of ["FEATURE", "BUGFIX", "INFRA"]) {
      const result = await evaluate(`HTPR-1 [${tag}] gated widget`, base, widened, dir);
      assert.equal(result.pass, false, `${kind}: ${tag}`);
      assert.match(result.reason, /Feature flags must default to Owner \+ QA/);
    }
  }
});

test("bugfix kind and default must be immutable literal declarations", async (t) => {
  for (const suffix of [
    'const DEFAULT_BUGFIX_FLAG_MODE = "OWNER_AND_QA";',
    'let DEFAULT_BUGFIX_FLAG_MODE = "EVERYONE";',
    'const DEFAULT_BUGFIX_FLAG_MODE = "EVERYONE"; DEFAULT_BUGFIX_FLAG_MODE = "OFF";',
    '',
  ]) {
    const { dir, git } = makeRepo(t);
    const base = commit(git, "base");
    writeFile(dir, "src/lib/flags.ts", flagsSource().replace('description: "fixture"', 'description: "fixture", kind: "bugfix"') + suffix);
    writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
    const head = commit(git, "invalid bugfix default");
    assert.equal((await evaluate("HTPR-1 [BUGFIX] widget", base, head, dir)).pass, false, suffix);
  }
  for (const kind of ['"bug"', 'someKind', '"bugfix", kind: "feature"']) {
    const { dir, git } = makeRepo(t);
    const base = commit(git, "base");
    writeFile(dir, "src/lib/flags.ts", flagsSource().replace('description: "fixture"', `description: "fixture", kind: ${kind}`) + 'const DEFAULT_BUGFIX_FLAG_MODE = "EVERYONE";');
    writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
    const head = commit(git, "invalid kind");
    assert.equal((await evaluate("HTPR-1 [BUGFIX] widget", base, head, dir)).pass, false, kind);
  }
});

test("extracted definitions accept new flags for COST UI PRs and legacy rebases", async (t) => {
  for (const legacyBase of [false, true]) {
    const { dir, git } = makeRepo(t);
    const move = (source) => {
      writeFile(dir, "src/lib/flags/definitions.ts", source.replace(/const DEFAULT_FEATURE_FLAG_MODE[^\n]*\n/, ""));
      writeFile(dir, "src/lib/flags.ts", 'import { FEATURE_FLAG_DEFINITIONS } from "@/lib/flags/definitions";\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\nexport const FEATURE_FLAG_KEYS = FEATURE_FLAG_DEFINITIONS.map(({ key }) => key);\n');
    };
    if (!legacyBase) move(flagsSource());
    const base = commit(git, "base registry");
    writeFile(dir, "src/lib/flags/keys.ts", 'export const OTHER_FLAG = "htpr-1-other";\nexport const COST_FLAG = "htpr-7038-test-cost";\n');
    move(flagsSource(["OTHER_FLAG", "COST_FLAG"]).replace("{ OTHER_FLAG }", "{ OTHER_FLAG, COST_FLAG }"));
    writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { COST_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(COST_FLAG) ? <div /> : null;\n');
    const head = commit(git, "flagged cost UI");
    const result = await evaluate("HTPR-7038 [COST] change widget", base, head, dir);
    assert.equal(result.pass, true, result.reason);
    // Resolve a rebase by keeping the definitions in the legacy location instead.
    writeFile(dir, "src/lib/flags/definitions.ts", 'export type FeatureFlagKind = "feature";\n');
    writeFile(dir, "src/lib/flags.ts", flagsSource(["OTHER_FLAG", "COST_FLAG"]).replace("{ OTHER_FLAG }", "{ OTHER_FLAG, COST_FLAG }"));
    const rebased = commit(git, "legacy conflict resolution");
    const legacyResult = await evaluate("HTPR-7038 [COST] change widget", base, rebased, dir);
    assert.equal(legacyResult.pass, true, legacyResult.reason);
  }
});

test("extracted definition policy rejects mutations and unsafe defaults before title exemptions", async (t) => {
  for (const mutation of ["definition", "imported", "imported-alias", "feature-default", "bugfix-default"]) {
    const { dir, git } = makeRepo(t);
    const definitions = flagsSource().replace(/const DEFAULT_FEATURE_FLAG_MODE[^\n]*\n/, "");
    const runtime = 'import { FEATURE_FLAG_DEFINITIONS } from "@/lib/flags/definitions";\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\nconst DEFAULT_BUGFIX_FLAG_MODE = "EVERYONE";\n';
    writeFile(dir, "src/lib/flags/definitions.ts", definitions);
    writeFile(dir, "src/lib/flags.ts", runtime);
    const base = commit(git, "split registry");
    if (mutation === "definition") {
      writeFile(dir, "src/lib/flags/definitions.ts", definitions + 'FEATURE_FLAG_DEFINITIONS.push({ key: OTHER_FLAG });\n');
    } else if (mutation === "imported") {
      writeFile(dir, "src/lib/flags.ts", runtime + 'FEATURE_FLAG_DEFINITIONS.push({ key: OTHER_FLAG });\n');
    } else if (mutation === "imported-alias") {
      writeFile(dir, "src/lib/flags.ts", runtime.replace("{ FEATURE_FLAG_DEFINITIONS }", "{ FEATURE_FLAG_DEFINITIONS as escaped }") + 'escaped.push({ key: "htpr-1-other" });\n');
    } else {
      writeFile(dir, "src/lib/flags/definitions.ts", definitions.replace('description: "fixture"', 'description: "fixture", kind: "bugfix"'));
      writeFile(dir, "src/lib/flags.ts", mutation === "feature-default" ? runtime.replace('"OWNER_AND_QA"', '"EVERYONE"') : runtime.replace('"EVERYONE"', '"OFF"'));
    }
    writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
    const head = commit(git, "invalid split policy");
    const result = await evaluate("YPER4-234 [INFRA] change widget", base, head, dir);
    assert.equal(result.pass, false, mutation);
    assert.match(result.reason, /parsed safely/);
  }
});

for (const { date, entry, pass } of [
  { date: "2026-10-09", entry: false, pass: true },
  { date: "2026-10-10", entry: false, pass: true },
  { date: "2026-10-11", entry: false, pass: false },
  { date: "2026-10-11", entry: true, pass: true },
]) {
  test(`added flag shipped ${date} ${entry ? "with" : "without"} risk metadata ${pass ? "passes" : "fails"}`, async (t) => {
    for (const extracted of [false, true]) {
      const { dir, git } = makeRepo(t);
      const base = commit(git, "base");
      const definitions = flagsSource(["OTHER_FLAG", '"htpr-2-new"'])
        .replace('key: "htpr-2-new",', `key: "htpr-2-new", shippedOn: "${date}",`);
      writeFile(dir, extracted ? "src/lib/flags/definitions.ts" : "src/lib/flags.ts", extracted
        ? definitions.replace(/const DEFAULT_FEATURE_FLAG_MODE[^\n]*\n/, "") : definitions);
      if (extracted) {
        writeFile(dir, "src/lib/flags.ts", 'import { FEATURE_FLAG_DEFINITIONS } from "@/lib/flags/definitions";\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n');
      }
      writeFile(dir, "src/lib/flags/releaseRisk.ts", `export const FEATURE_FLAG_RELEASE_RISKS = {${entry
        ? '"htpr-2-new": { risk: "small", reason: "Changes an existing screen." }' : ""}};`);
      const head = commit(git, "dated flag");
      for (const title of ["HTPR-2 [FEATURE] backend", "HTPR-2 [BUGFIX] fix", "YPER4-2 [INFRA] backend"]) {
        const result = await evaluate(title, base, head, dir);
        assert.equal(result.pass, pass, result.reason);
        if (!pass) assert.match(result.reason, /Add htpr-2-new to FEATURE_FLAG_RELEASE_RISKS/);
      }
    }
  });
}

test("added flags with unparseable shippedOn require risk metadata", async (t) => {
  for (const field of ["", 'shippedOn: "not-a-date",', 'shippedOn: "2026-02-30",',
    "shippedOn: getDate(),", 'shippedOn: "2026-10-09", shippedOn: "2026-10-10",']) {
    const { dir, git } = makeRepo(t);
    const base = commit(git, "base");
    writeFile(dir, "src/lib/flags.ts", flagsSource(["OTHER_FLAG", '"htpr-2-new"'])
      .replace('key: "htpr-2-new",', `key: "htpr-2-new", ${field}`));
    const head = commit(git, "flag without parsable date");
    const result = await evaluate("HTPR-2 [FEATURE] backend", base, head, dir);
    assert.equal(result.pass, false, field);
    assert.match(result.reason, /Add htpr-2-new to FEATURE_FLAG_RELEASE_RISKS/);
  }
});

test("new flag keys require a release-risk entry, including API-only and exempt PRs", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/lib/flags/keys.ts", 'export const OTHER_FLAG = "htpr-1-other";\nexport const NEW_FLAG = "htpr-2-new";\n');
  writeFile(dir, "src/lib/flags/releaseRisk.ts", 'export const FEATURE_FLAG_RELEASE_RISKS = {};\n');
  const missing = commit(git, "new flag without risk");
  for (const title of ["HTPR-2 [FEATURE] backend", "HTPR-2 [BUGFIX] fix", "YPER4-2 [INFRA] backend"]) {
    const result = await evaluate(title, base, missing, dir);
    assert.equal(result.pass, false);
    assert.match(result.reason, /Add htpr-2-new to FEATURE_FLAG_RELEASE_RISKS/);
  }
  for (const risk of ["none", "small", "new"]) {
    writeFile(dir, "src/lib/flags/releaseRisk.ts", `export const FEATURE_FLAG_RELEASE_RISKS = { "htpr-2-new": { risk: "${risk}", reason: "Explains the change." } };`);
    const valid = commit(git, `valid ${risk}`);
    assert.equal((await evaluate("HTPR-2 [FEATURE] backend", base, valid, dir)).pass, true);
  }
});

test("risk metadata must be exported and cannot be mutated after its declaration", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/lib/flags/keys.ts", 'export const OTHER_FLAG = "htpr-1-other";\nexport const NEW_FLAG = "htpr-2-new";\n');
  const metadata = 'export const FEATURE_FLAG_RELEASE_RISKS = { "htpr-2-new": { risk: "none", reason: "Records an event." } };';
  for (const source of [metadata.replace("export ", ""), metadata.replace("const ", "let "), `${metadata}\ndelete FEATURE_FLAG_RELEASE_RISKS["htpr-2-new"];`]) {
    writeFile(dir, "src/lib/flags/releaseRisk.ts", source);
    const head = commit(git, "invalid risk binding");
    assert.equal((await evaluate("HTPR-2 [FEATURE] backend", base, head, dir)).pass, false);
  }
});

test("literal definition additions also require risk entries without keys.ts changes", async (t) => {
  for (const extracted of [false, true]) {
    const { dir, git } = makeRepo(t);
    const definitionsPath = extracted ? "src/lib/flags/definitions.ts" : "src/lib/flags.ts";
    const definitions = (keys) => extracted
      ? flagsSource(keys).replace(/const DEFAULT_FEATURE_FLAG_MODE[^\n]*\n/, "")
      : flagsSource(keys);
    if (extracted) {
      writeFile(dir, definitionsPath, definitions());
      writeFile(dir, "src/lib/flags.ts", 'import { FEATURE_FLAG_DEFINITIONS } from "@/lib/flags/definitions";\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n');
    }
    const base = commit(git, "base");
    writeFile(dir, definitionsPath, definitions(["OTHER_FLAG", '"htpr-2-new"']));
    const missing = commit(git, "new literal flag without risk");
    for (const title of ["HTPR-2 [FEATURE] backend", "HTPR-2 [BUGFIX] fix", "YPER4-2 [INFRA] backend"]) {
      const result = await evaluate(title, base, missing, dir);
      assert.equal(result.pass, false);
      assert.match(result.reason, /Add htpr-2-new to FEATURE_FLAG_RELEASE_RISKS/);
    }
    writeFile(dir, "src/lib/flags/releaseRisk.ts", 'export const FEATURE_FLAG_RELEASE_RISKS = { "htpr-2-new": { risk: "none", reason: "Records events without changing screens." } };');
    const valid = commit(git, "literal flag with risk");
    assert.equal((await evaluate("HTPR-2 [FEATURE] backend", base, valid, dir)).pass, true);
  }
});

test("new flag risk entries reject invalid labels, blank reasons and unsafe objects", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/lib/flags/keys.ts", 'export const OTHER_FLAG = "htpr-1-other";\nexport const NEW_FLAG = "htpr-2-new";\n');
  for (const entry of [
    '{ risk: "safe", reason: "A change." }',
    '{ risk: "none", reason: " " }',
    '{ risk: "none", reason: getReason() }',
    '{ ...metadata }',
    '{ risk: "none", reason: "A change.", extra: true }',
    '{ risk: "none", reason: "Two\\nlines." }',
    '{ risk: "none", reason: "Bad\\u2014punctuation." }',
  ]) {
    writeFile(dir, "src/lib/flags/releaseRisk.ts", `export const FEATURE_FLAG_RELEASE_RISKS = { "htpr-2-new": ${entry} };`);
    const head = commit(git, "invalid risk");
    assert.equal((await evaluate("HTPR-2 [FEATURE] backend", base, head, dir)).pass, false, entry);
  }
});

function perFlagLayout(dir) {
  writeFile(dir, "src/lib/flags/keys.ts", 'export * from "./definitions/index.generated";\n');
  writeFile(dir, "src/lib/flags/definitions.ts", 'import { FLAG_DEFINITIONS } from "./definitions/index.generated";\nexport const FEATURE_FLAG_DEFINITIONS = FLAG_DEFINITIONS;\n');
  writeFile(dir, "src/lib/flags.ts", 'import { FEATURE_FLAG_DEFINITIONS } from "@/lib/flags/definitions";\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\nconst DEFAULT_BUGFIX_FLAG_MODE = "EVERYONE";\nexport const FEATURE_FLAG_KEYS = FEATURE_FLAG_DEFINITIONS.map(({ key }) => key);\n');
  writeFile(dir, "src/lib/flags/definitions/htpr-1-other.ts", 'export const OTHER_FLAG = "htpr-1-other";\nexport default { key: OTHER_FLAG, description: "Fixture", shippedOn: "2026-10-09" } as const;\n');
}

test("runtime flag keys must come from their own registered definition or a supported barrel", async (t) => {
  const { dir, git } = makeRepo(t);
  perFlagLayout(dir);
  writeFile(dir, "src/lib/flags/definitions/htpr-2-new.ts", 'export const NEW_FLAG = "htpr-2-new";\nexport default { key: NEW_FLAG, description: "Another flag", shippedOn: "2026-10-10" } as const;\n');
  for (const filename of ["src/lib/flagsx.ts", "src/lib/flags/definitions-fake/htpr-1-other.ts", "src/components/flag-key.ts"]) {
    writeFile(dir, filename, 'export const OTHER_FLAG = "htpr-1-other";\n');
  }
  const base = commit(git, "registered flags and look-alike modules");
  for (const [moduleName, pass] of [
    ["@/lib/flags/definitions/htpr-1-other", true],
    ["@/lib/flags/definitions/htpr-1-other.ts", true],
    ["../lib/flags/definitions/htpr-1-other", true],
    ["../lib/flags/definitions/htpr-1-other.ts", true],
    ["@/lib/flags/keys", true],
    ["@/lib/flags", true],
    ["@/lib/flagsx", false],
    ["@/lib/flags/definitions-fake/htpr-1-other", false],
    ["./flag-key", false],
    ["../lib/flagsx", false],
    ["@/lib/flags/definitions/htpr-2-new", false],
    ["../lib/flags/definitions/htpr-2-new", false],
    ["@/lib/flags/definitions/htpr-1-missing", false],
    ["../lib/flags/definitions/htpr-1-missing", false],
  ]) {
    writeFile(dir, "src/components/Widget.tsx", `import { OTHER_FLAG as ticketFlag } from "${moduleName}";\nimport { useFlag } from "@/hooks/useFlag";\nexport const Widget = () => useFlag(ticketFlag) ? <div>Widget</div> : null;\n`);
    const head = commit(git, `import from ${moduleName}`);
    const result = await evaluate("HTPR-1 [FEATURE] Widget", base, head, dir);
    assert.equal(result.pass, pass, `${moduleName}: ${result.reason}`);
    if (pass) assert.equal(result.ownerReview, "feature-gated-ui");
    else assert.match(result.reason, /without a feature flag/);
  }
});

test("per-flag registry handles legacy inline and extracted base refs without a generated index", async (t) => {
  for (const extracted of [false, true]) {
    const { dir, git } = makeRepo(t);
    if (extracted) {
      writeFile(dir, "src/lib/flags/definitions.ts", flagsSource().replace(/const DEFAULT_FEATURE_FLAG_MODE[^\n]*\n/, ""));
      writeFile(dir, "src/lib/flags.ts", 'const DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n');
    }
    const base = commit(git, "old layout");
    perFlagLayout(dir);
    const existingFile = "src/lib/flags/definitions/htpr-1-other.ts";
    writeFile(dir, existingFile, fs.readFileSync(path.join(dir, existingFile), "utf8").replace("key: OTHER_FLAG", 'key: OTHER_FLAG, defaultMode: "EVERYONE"'));
    writeFile(dir, "src/lib/flags/definitions/htpr-5-widget.ts", `export const WIDGET_FLAG = "htpr-5-widget";\nexport default { key: WIDGET_FLAG, defaultMode: "EVERYONE", description: "Widget", shippedOn: "${RELEASE_RISK_REQUIRED_FROM}", releaseRisk: { risk: "new", reason: "Adds a widget." } } as const;\n`);
    writeFile(dir, "src/components/Widget.tsx", 'import { WIDGET_FLAG } from "@/lib/flags/keys";\nimport { useFlag } from "@/hooks/useFlag";\nexport const Widget = () => useFlag(WIDGET_FLAG) ? <div>Widget</div> : null;\n');
    const head = commit(git, "new layout and widget");
    const result = await evaluate("HTPR-5 [FEATURE] Widget", base, head, dir);
    assert.equal(result.pass, true, result.reason);
  }
});

test("per-flag additions enforce the release-risk cutoff and registry defaults even on infra PRs", async (t) => {
  const { dir, git } = makeRepo(t);
  perFlagLayout(dir);
  const base = commit(git, "per flag base");
  const filename = "src/lib/flags/definitions/htpr-2-new.ts";
  const source = `export const NEW_FLAG = "htpr-2-new";\nexport default { key: NEW_FLAG, shippedOn: "${RELEASE_RISK_REQUIRED_FROM}", description: "New flag" EXTRA } as const;`;
  for (const [extra, pass] of [["", false], [', releaseRisk: { risk: "none", reason: "Records events." }', false], [', defaultMode: "EVERYONE", releaseRisk: { risk: "none", reason: "Records events." }', true], [', defaultMode: "EVERYONE"', false], [', releaseRisk: { risk: "large", reason: "Invalid." }', false]]) {
    writeFile(dir, filename, source.replace(" EXTRA", extra));
    const head = commit(git, "add flag " + extra);
    const result = await evaluate("YPER4-2 [INFRA] Fixture", base, head, dir);
    assert.equal(result.pass, pass, result.reason);
  }
  writeFile(dir, filename, source.replace(RELEASE_RISK_REQUIRED_FROM, "2026-10-10").replace(" EXTRA", ', defaultMode: "EVERYONE"'));
  assert.equal((await evaluate("YPER4-2 [INFRA] Fixture", base, commit(git, "pre cutoff"), dir)).pass, true);
});

test("registry parser reads sorted per-flag keys and dates and rejects policy mutation or committed generated indexes", async (t) => {
  const { dir, git } = makeRepo(t);
  perFlagLayout(dir);
  writeFile(dir, "src/lib/flags/definitions/htpr-2-new.ts", 'export const NEW_FLAG = "htpr-2-new";\nexport default { key: NEW_FLAG, description: "New flag", shippedOn: "2026-10-10" } as const;\n');
  const ref = commit(git, "registry");
  const previous = process.cwd();
  process.chdir(dir);
  try {
    const { parseFlagRegistry, parseDefinitions } = await import("../.github/scripts/feature-flag-registry.mjs");
    assert.deepEqual([...parseFlagRegistry(ref).byIdentifier], [["OTHER_FLAG", "htpr-1-other"], ["NEW_FLAG", "htpr-2-new"]]);
    assert.deepEqual([...parseDefinitions(ref).shippedOn], [["htpr-1-other", "2026-10-09"], ["htpr-2-new", "2026-10-10"]]);
    fs.appendFileSync(path.join(dir, "src/lib/flags/definitions.ts"), 'FEATURE_FLAG_DEFINITIONS.push({ key: "htpr-2-new" });\n');
    assert.throws(() => parseDefinitions(commit(git, "mutation")), /must not be/);
    writeFile(dir, "src/lib/flags/definitions/index.generated.ts", 'export const FAKE_FLAG = "htpr-3-fake";');
    assert.throws(() => parseFlagRegistry(commit(git, "bad generated index")), /invalid .*index.generated.ts/);
  } finally { process.chdir(previous); }
});


test("per-flag wrapper cannot mutate generated data through imports or aliases", async (t) => {
  const { dir, git } = makeRepo(t);
  perFlagLayout(dir);
  const base = commit(git, "data-only base");
  const wrapper = fs.readFileSync(path.join(dir, "src/lib/flags/definitions.ts"), "utf8");
  for (const extra of [
    'FLAG_DEFINITIONS[0].defaultMode = "EVERYONE";',
    'const alias = FLAG_DEFINITIONS; alias.push({ key: "htpr-2-new" });',
    'import flag from "./definitions/htpr-1-other"; flag.kind = "bugfix";',
  ]) {
    writeFile(dir, "src/lib/flags/definitions.ts", wrapper + extra + "\n");
    const result = await evaluate("YPER4-2 [INFRA] Fixture", base, commit(git, "unsafe wrapper " + extra), dir);
    assert.equal(result.pass, false, extra);
    assert.match(result.reason, /data-only generated registry wrapper/);
  }
});

test('flags read inside JSX attribute callbacks gate only when the callback is referenced', async (t) => {
  const cases = [
    ['onSubmit={send}', 'const send=()=>{if(enabled)doWork();};return <form onSubmit={send}/>;', true],
    ['inline arrow calls send', 'const send=()=>{if(enabled)doWork();};return <button onClick={()=>send()}/>;', true],
    ['inline arrow reads flag', 'return <button onClick={()=>{if(enabled)doWork();}}/>;', true],
    ['useCallback result in attribute', 'const send=useCallback(()=>{if(enabled)doWork();},[enabled]);return <form onSubmit={send}/>;', true],
    ['defined but never referenced', 'const send=()=>{if(enabled)doWork();};return <form/>;', false],
    ['useCallback never referenced', 'const send=useCallback(()=>{if(enabled)doWork();},[enabled]);return <form/>;', false],
    ['inline arrow never calls send', 'const send=()=>{if(enabled)doWork();};return <button onClick={()=>doWork()}/>;', false],
  ];
  for (const [name, body, expected] of cases) {
    const fixture = makeRepo(t), base = commit(fixture.git, 'base');
    writeFile(fixture.dir, 'src/components/Widget.tsx', 'import {useCallback} from "react";\nimport {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\ndeclare function doWork(): void;\nexport function Widget(){const enabled=useFlag(OTHER_FLAG);' + body + '}\n');
    const head = commit(fixture.git, name);
    assert.equal((await evaluate('HTPR-1 [FEATURE] preview widget', base, head, fixture.dir)).pass, expected, name);
  }
});

test('JSX attribute callbacks gate only when their JSX is consumed', async (t) => {
  const send = 'const send=()=>{if(enabled)doWork();};';
  const cases = [
    ['discarded const, identifier', send + 'const unused=<button onClick={send}/>;return <div/>;', false],
    ['discarded const, inline arrow', send + 'const unused=<button onClick={()=>send()}/>;return <div/>;', false],
    ['discarded expression statement', send + '<button onClick={send}/>;return <div/>;', false],
    ['const returned', send + 'const el=<button onClick={send}/>;return <div>{el}</div>;', true],
    ['const returned directly, inline arrow', send + 'const el=<button onClick={()=>send()}/>;return el;', true],
    ['const passed as call argument', send + 'const el=<button onClick={send}/>;render(el);return <div/>;', true],
    ['conditional in return', send + 'return cond?<button onClick={send}/>:null;', true],
    ['unused function returns the element', send + 'const el=<button onClick={send}/>;function unused(){return el;} return <div/>;', false],
    ['unused arrow returns the element', send + 'const el=<button onClick={send}/>;const unused=()=>el;return <div/>;', false],
    ['unreachable return of the element', send + 'const el=<button onClick={send}/>;function helper(){return null;return el;} helper();return <div/>;', false],
    ['unreachable return in render', send + 'const el=<button onClick={send}/>;return <div/>;return el;', false],
    ['false && element', send + 'const el=<button onClick={send}/>;return <div>{false && el}</div>;', false],
    ['0 && element', send + 'const el=<button onClick={send}/>;return <div>{0 && el}</div>;', false],
    ['null && element', send + 'const el=<button onClick={send}/>;return <div>{null && el}</div>;', false],
    ['true || element', send + 'const el=<button onClick={send}/>;return <div>{true || el}</div>;', false],
    ['untaken ternary, false ? el : y', send + 'const el=<button onClick={send}/>;return <div>{false ? el : null}</div>;', false],
    ['untaken ternary, true ? y : el', send + 'const el=<button onClick={send}/>;return <div>{true ? null : el}</div>;', false],
    ['if (false) block returns element', send + 'const el=<button onClick={send}/>;if(false){return el;}return <div/>;', false],
    ['inline element in false &&', send + 'return <div>{false && <button onClick={send}/>}</div>;', false],
    ['cond && element, non-literal', send + 'const el=<button onClick={send}/>;return <div>{cond && el}</div>;', true],
    ['true ? el : y', send + 'const el=<button onClick={send}/>;return <div>{true ? el : null}</div>;', true],
    ['live helper returns the element', send + 'const el=<button onClick={send}/>;function helper(){return el;} return <div>{helper()}</div>;', true],
    ['live arrow helper returns the element', send + 'const el=<button onClick={send}/>;const helper=()=>el;return <div>{helper()}</div>;', true],
  ];
  for (const [name, body, expected] of cases) {
    const fixture = makeRepo(t), base = commit(fixture.git, 'base');
    writeFile(fixture.dir, 'src/components/Widget.tsx', 'import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\ndeclare function doWork(): void;\ndeclare function render(x: unknown): void;\ndeclare const cond: boolean;\nexport function Widget(){const enabled=useFlag(OTHER_FLAG);' + body + '}\n');
    const head = commit(fixture.git, name);
    assert.equal((await evaluate('HTPR-1 [FEATURE] preview widget', base, head, fixture.dir)).pass, expected, name);
  }
});

test('only the real React useCallback binds a callback', async (t) => {
  const body = 'const send=useCallback(()=>{if(enabled)doWork();},[enabled]);return <form onSubmit={send}/>;';
  const head = 'import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\ndeclare function doWork(): void;\n';
  const component = (extra = '') => 'export function Widget(){const enabled=useFlag(OTHER_FLAG);' + extra + body + '}\n';
  const cases = [
    ['named import', 'import {useCallback} from "react";\n' + component(), true],
    ['aliased import', 'import {useCallback as uc} from "react";\n' + component().replace('useCallback(', 'uc('), true],
    ['default import', 'import React from "react";\n' + component().replace('useCallback(', 'React.useCallback('), true],
    ['namespace import', 'import * as R from "react";\n' + component().replace('useCallback(', 'R.useCallback('), true],
    ['local function', 'function useCallback<T>(fn: T, deps: unknown[]): T { return fn; }\n' + component(), false],
    ['import from another module', 'import {useCallback} from "./other";\n' + component(), false],
    ['unrelated object method', 'declare const lib: {useCallback<T>(fn: T, deps: unknown[]): T};\n' + component().replace('useCallback(', 'lib.useCallback('), false],
    ['namespace from another module', 'import * as R from "./other";\n' + component().replace('useCallback(', 'R.useCallback('), false],
    ['shadowed by local wrapper', 'import {useCallback} from "react";\n' + 'export function Widget(){const enabled=useFlag(OTHER_FLAG);const useCallback=<T,>(fn: T, deps: unknown[])=>fn;' + body + '}\n', false],
  ];
  for (const [name, source, expected] of cases) {
    const fixture = makeRepo(t), base = commit(fixture.git, 'base');
    writeFile(fixture.dir, 'src/components/Widget.tsx', head + source);
    const sha = commit(fixture.git, name);
    assert.equal((await evaluate('HTPR-1 [FEATURE] preview widget', base, sha, fixture.dir)).pass, expected, name);
  }
});

test("new catch-all route files do not parse Git revision output as source", async (t) => {
  for (const folder of ["[...slug]", "[[...slug]]"]) {
    const { dir, git } = makeRepo(t);
    const base = commit(git, "base");
    const file = `src/app/detail/${folder}/Restorer.tsx`;
    writeFile(dir, file, 'export const Restorer = () => <div>Restored</div>;\n');
    const head = commit(git, "add route restorer");
    const result = await evaluate("HTPR-7680 [BUGFIX] restore inbox", base, head, dir);
    assert.equal(result.pass, true, result.reason);
    assert.equal(result.ownerReview, "exempt-ui");
  }
});

test("deleted catch-all route files do not parse Git revision output as source", async (t) => {
  for (const folder of ["[...slug]", "[[...slug]]"]) {
    const { dir, git } = makeRepo(t);
    const file = `src/app/detail/${folder}/Restorer.tsx`;
    writeFile(dir, file, 'export const Restorer = () => <div>Restored</div>;\n');
    const base = commit(git, "base route restorer");
    fs.unlinkSync(path.join(dir, file));
    const head = commit(git, "delete route restorer");
    const result = await evaluate("HTPR-7680 [BUGFIX] remove restorer", base, head, dir);
    assert.equal(result.pass, true, result.reason);
    assert.equal(result.ownerReview, "exempt-ui");
  }
});

test("catch-all route files still reject wider exposure and invalid syntax", async (t) => {
  const { dir, git } = makeRepo(t);
  const file = "src/app/detail/[...slug]/Providers.tsx";
  writeFile(dir, "src/components/Banner.tsx", "export const Banner = () => <div>Consent</div>;\n");
  writeFile(dir, file, 'import { Banner } from "@/components/Banner";\nexport const Providers = () => <>{!currentUser && <Banner />}</>;\n');
  const base = commit(git, "guest banner in catch-all route");
  writeFile(dir, file, 'import { Banner } from "@/components/Banner";\nexport const Providers = () => <Banner />;\n');
  const widened = await evaluate("HTPR-7680 [BUGFIX] restore inbox", base, commit(git, "widen banner"), dir);
  assert.equal(widened.pass, false);
  assert.match(widened.reason, /Banner condition removed\) without a flag/);
  writeFile(dir, file, "export const Providers = () => <;\n");
  const malformed = await evaluate("HTPR-7680 [BUGFIX] restore inbox", base, commit(git, "invalid route source"), dir);
  assert.equal(malformed.pass, false);
  assert.match(malformed.reason, /UI exposure could not be parsed safely: invalid/);
});

test("BUGFIX and INFRA cannot drop an existing banner condition (PR 1580)", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/components/Global/Banner.tsx", "export const Banner = () => <div>Consent</div>;\n");
  writeFile(dir, "src/components/Providers.tsx", 'import { Banner } from "./Global/Banner";\nexport const Providers = () => <>{!currentUser && <Banner />}</>;\n');
  const base = commit(git, "guest banner");
  writeFile(dir, "src/components/Providers.tsx", 'import { Banner } from "./Global/Banner";\nexport const Providers = () => <Banner />;\n');
  const head = commit(git, "banner for everyone");
  for (const tag of ["BUGFIX", "INFRA"]) {
    const result = await evaluate(`HTPR-7274 [${tag}] consent`, base, head, dir);
    assert.equal(result.pass, false);
    assert.match(result.reason, /Providers.tsx:Banner condition removed\) without a flag/);
    assert.match(result.reason, /Legal, privacy, compliance and urgent work still need a flag/);
    assert.match(result.reason, /definitions\/htpr-7274-<name>\.ts/);
  }
  assert.equal((await evaluate("HTPR-7274 [FEATURE] consent", base, head, dir)).pass, false);
  for (const title of ["YPER4-418 [INFRA] consent", "HTPR-7274 [AI CHAT] consent"]) {
    assert.equal((await evaluate(title, base, head, dir)).pass, true);
  }
  assert.equal((await evaluate("HTPR-7274 [BUGFIX] consent", base, head, dir, ["AI CHAT 💬"])).pass, true);
});

test("ticket flag gates widened banner exposure through the shared feature check", async (t) => {
  const { dir, git } = makeRepo(t);
  perFlagLayout(dir);
  writeFile(dir, "src/components/Global/Banner.tsx", "export const Banner = () => <div>Consent</div>;\n");
  writeFile(dir, "src/components/Providers.tsx", 'import { Banner } from "./Global/Banner";\nexport const Providers = () => <>{!currentUser && <Banner />}</>;\n');
  const base = commit(git, "guest banner");
  writeFile(dir, "src/lib/flags/definitions/htpr-7274-banner.ts", `export const HTPR_7274_BANNER_FLAG = "htpr-7274-banner";\nexport default { key: HTPR_7274_BANNER_FLAG, kind: "bugfix", shippedOn: "${RELEASE_RISK_REQUIRED_FROM}", description: "Consent banner", releaseRisk: { risk: "small", reason: "Shows the banner to signed-in users." } } as const;\n`);
  writeFile(dir, "src/components/Providers.tsx", 'import { Banner } from "./Global/Banner";\nimport { useFlag } from "@/hooks/useFlag";\nimport { HTPR_7274_BANNER_FLAG } from "@/lib/flags/keys";\nexport const Providers = () => <>{useFlag(HTPR_7274_BANNER_FLAG) && <aside><Banner /></aside>}{!currentUser && <Banner />}</>;\n');
  const head = commit(git, "gate wider banner");
  for (const tag of ["BUGFIX", "INFRA", "FEATURE"]) {
    const result = await evaluate(`HTPR-7274 [${tag}] consent`, base, head, dir);
    assert.equal(result.pass, true, result.reason);
    assert.equal(result.ownerReview, "feature-gated-ui");
  }
  writeFile(dir, "src/components/Unrelated.tsx", 'export const Unrelated = () => <div>Ungated</div>;\n');
  const uncovered = await evaluate("HTPR-7274 [BUGFIX] consent", base, commit(git, "ungated sibling file"), dir);
  assert.equal(uncovered.pass, false);
  assert.match(uncovered.reason, /without a flag/);
});

test("removing a named JSX function's nullish early return widens exposure", async (t) => {
  for (const binding of ["function Banner()", "const Banner = () =>"]) {
    const { dir, git } = makeRepo(t);
    writeFile(dir, "src/components/Banner.tsx", `export ${binding} { if ((user)) { return null; } return <div>Consent</div>; }\n`);
    const base = commit(git, "guarded banner");
    writeFile(dir, "src/components/Banner.tsx", `export ${binding} { return <div>Consent</div>; }\n`);
    const result = await evaluate("HTPR-7274 [BUGFIX] consent", base, commit(git, "remove return"), dir);
    assert.equal(result.pass, false);
    assert.match(result.reason, /Banner.tsx:Banner early return removed/);
  }
});

test("broadening a nullish early return narrows exposure and stays exempt", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/components/Banner.tsx", "export function Banner() { if (guest) return null; return <div>Consent</div>; }\n");
  const base = commit(git, "guarded banner");
  writeFile(dir, "src/components/Banner.tsx", "export function Banner() { if (guest || loading) return null; return <div>Consent</div>; }\n");
  const narrowed = await evaluate("HTPR-7274 [BUGFIX] consent", base, commit(git, "hide while loading"), dir);
  assert.equal(narrowed.pass, true, narrowed.reason);
  writeFile(dir, "src/components/Banner.tsx", "export function Banner() { if (loading) return null; return <div>Consent</div>; }\n");
  const swapped = await evaluate("HTPR-7274 [BUGFIX] consent", base, commit(git, "drop guest guard"), dir);
  assert.equal(swapped.pass, false);
  assert.match(swapped.reason, /Banner.tsx:Banner early return removed/);
  for (const rewrite of [
    "export function Banner() { return guest ? null : <div>Consent</div>; }\n",
    "export const Banner = () => (guest ? null : <div>Consent</div>);\n",
  ]) {
    writeFile(dir, "src/components/Banner.tsx", rewrite);
    const ternary = await evaluate("HTPR-7274 [BUGFIX] consent", base, commit(git, "ternary rewrite"), dir);
    assert.equal(ternary.pass, true, ternary.reason);
  }
  for (const rewrite of [
    "export function Banner() { return !guest && <div>Consent</div>; }\n",
    "export function Banner() { return !guest ? <div>Consent</div> : null; }\n",
  ]) {
    writeFile(dir, "src/components/Banner.tsx", rewrite);
    const shortCircuit = await evaluate("HTPR-7274 [BUGFIX] consent", base, commit(git, "short-circuit rewrite"), dir);
    assert.equal(shortCircuit.pass, true, shortCircuit.reason);
  }
});

test("mutually exclusive branches of one placement do not count as extra renders", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/components/Banner.tsx", "export const Banner = (props) => <div>{props.title}</div>;\n");
  writeFile(dir, "src/components/Page.tsx", 'import { Banner } from "./Banner";\nexport const Page = () => <Banner />;\n');
  const base = commit(git, "one banner");
  writeFile(dir, "src/components/Page.tsx", 'import { Banner } from "./Banner";\nexport const Page = () => (wide ? <Banner title="A" /> : <Banner title="B" />);\n');
  const exclusive = await evaluate("HTPR-7274 [BUGFIX] consent", base, commit(git, "conditional props"), dir);
  assert.equal(exclusive.pass, true, exclusive.reason);
  writeFile(dir, "src/components/Page.tsx", 'import { Banner } from "./Banner";\nexport const Page = () => (<><Banner title="A" /><Banner title="B" /></>);\n');
  const doubled = await evaluate("HTPR-7274 [BUGFIX] consent", base, commit(git, "two banners"), dir);
  assert.equal(doubled.pass, false);
  assert.match(doubled.reason, /Banner rendered 1 more times/);
});

test("branch order and positive if-returns keep the same exposure", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/components/Banner.tsx", "export const Banner = () => <div />;\n");
  writeFile(dir, "src/components/Page.tsx", 'import { Banner } from "./Banner";\nexport const Page = () => (wide ? <Banner /> : <><Banner /><Banner /></>);\n');
  writeFile(dir, "src/components/Card.tsx", "export function Card() { return ready && <div>Card</div>; }\n");
  const base = commit(git, "base");
  writeFile(dir, "src/components/Page.tsx", 'import { Banner } from "./Banner";\nexport const Page = () => (!wide ? <><Banner /><Banner /></> : <Banner />);\n');
  writeFile(dir, "src/components/Card.tsx", "export function Card() { if (ready) return <div>Card</div>; return null; }\n");
  const rewritten = await evaluate("HTPR-7274 [BUGFIX] consent", base, commit(git, "equivalent rewrites"), dir);
  assert.equal(rewritten.pass, true, rewritten.reason);
  for (const elseForm of ["else return null;", "else { return null; }"]) {
    writeFile(dir, "src/components/Card.tsx", `export function Card() { if (ready) return <div>Card</div>; ${elseForm} }\n`);
    const withElse = await evaluate("HTPR-7274 [BUGFIX] consent", base, commit(git, "else form"), dir);
    assert.equal(withElse.pass, true, withElse.reason);
  }
  writeFile(dir, "src/components/Page.tsx", 'import { Banner } from "./Banner";\nexport const Page = () => (wide ? <Banner /> : <Banner />);\n');
  const split = commit(git, "same banner in both branches");
  writeFile(dir, "src/components/Page.tsx", 'import { Banner } from "./Banner";\nexport const Page = () => <Banner />;\n');
  const collapsed = await evaluate("HTPR-7274 [BUGFIX] consent", split, commit(git, "collapse branches"), dir);
  assert.equal(collapsed.pass, true, collapsed.reason);
  writeFile(dir, "src/components/Card.tsx", "export function Card() { return <div>Card</div>; }\n");
  const dropped = await evaluate("HTPR-7274 [BUGFIX] consent", base, commit(git, "drop ready"), dir);
  assert.equal(dropped.pass, false);
  assert.match(dropped.reason, /Card.tsx:Card early return removed/);
});

test("existing banner added in another file fails, but moving it between files passes", async (t) => {
  for (const moving of [false, true]) {
    const { dir, git } = makeRepo(t);
    writeFile(dir, "src/components/A.tsx", 'export const A = () => <Banner />;\n');
    writeFile(dir, "src/components/B.tsx", 'export const B = () => <div />;\n');
    const base = commit(git, "first placement");
    writeFile(dir, "src/components/A.tsx", moving ? 'export const A = () => <div />;\n' : 'export const A = () => <Banner title="Consent" />;\n');
    writeFile(dir, "src/components/B.tsx", 'export const B = () => <Banner />;\n');
    const result = await evaluate("HTPR-7274 [BUGFIX] consent", base, commit(git, "second placement"), dir);
    assert.equal(result.pass, moving, result.reason);
    assert.match(result.reason, moving ? /is exempt/ : /Banner rendered 1 more times/);
  }
});

test("new placements recognize unchanged imported UI but not brand-new components", async (t) => {
  for (const moduleName of ["@/components/Global/Banner", "./Global/Banner", "./Global", "../../ui/Banner"]) {
    for (const existing of [false, true]) {
      const { dir, git } = makeRepo(t);
      const bannerPath = moduleName === "../../ui/Banner" ? "ui/Banner.jsx" :
        moduleName === "./Global" ? "src/components/Global/index.tsx" : "src/components/Global/Banner.tsx";
      if (existing) writeFile(dir, bannerPath, 'export default () => <div>Consent</div>;\n');
      const base = commit(git, "base");
      if (!existing) writeFile(dir, bannerPath, 'export default () => <div>Consent</div>;\n');
      writeFile(dir, "src/components/Providers.tsx", `import Banner from "${moduleName}";\nexport const Providers = () => <Banner />;\n`);
      const result = await evaluate("HTPR-7274 [BUGFIX] consent", base, commit(git, "placement"), dir);
      assert.equal(result.pass, !existing, result.reason);
      if (existing) assert.match(result.reason, /Providers.tsx:Banner rendered 1 more times/);
    }
  }
});

test("guard removal handles conjuncts, ternaries, if branches and member tags", async (t) => {
  for (const [before, after] of [
    ['return <>{((guest) && (consent)) && <Banner />}</>;', 'return <>{guest && <Banner />}</>;'],
    ['return guest ? <Banner /> : null;', 'return <Banner />;'],
    ['return guest ? null : <Banner />;', 'return <Banner />;'],
    ['if (guest) { return <Banner />; } return null;', 'return <Banner />;'],
    ['if (guest) { return null; } else { return <Banner />; }', 'return <Banner />;'],
    ['return <>{guest && <UI.Banner />}</>;', 'return <UI.Banner />;'],
  ]) {
    const { dir, git } = makeRepo(t);
    writeFile(dir, "src/components/Providers.jsx", `export function Providers() { ${before} }\n`);
    const base = commit(git, "guarded");
    writeFile(dir, "src/components/Providers.jsx", `export function Providers() { ${after} }\n`);
    const result = await evaluate("HTPR-7274 [BUGFIX] consent", base, commit(git, "widened"), dir);
    assert.equal(result.pass, false, before);
    assert.match(result.reason, /condition removed/);
  }
});

test("text edits, narrowed or normalized guards, and matched multiset occurrences stay exempt", async (t) => {
  for (const [before, after] of [
    ['return <div className="old">Old</div>;', 'return <div className="new">New</div>;'],
    ['return <>{guest && <Banner />}</>;', 'return <>{guest && isGuest && <Banner />}</>;'],
    ['return <>{(guest && consent) && <Banner />}</>;', 'return <>{guest && (consent && <Banner />)}</>;'],
    ['return <>{guest ? <Banner /> : null}</>;', 'return <>{((guest)) ? <Banner /> : null}</>;'],
    ['return <><Banner />{guest && <Banner />}</>;', 'return <Banner />;'],
    ['if (guest) {} return <Banner />;', 'return <Banner />;'],
    ['if (guest) return "wait"; return <Banner />;', 'return <Banner />;'],
    ['if ((guest)) return null; return <Banner />;', 'if (guest) { return null; } return <Banner title="Consent" />;'],
    ['return <>{guest && <div />}</>;', 'return <div />;'],
  ]) {
    const { dir, git } = makeRepo(t);
    writeFile(dir, "src/components/Providers.tsx", `export function Providers() { ${before} }\n`);
    const base = commit(git, "base");
    writeFile(dir, "src/components/Providers.tsx", `export function Providers() { ${after} }\n`);
    const result = await evaluate("HTPR-7274 [BUGFIX] consent", base, commit(git, "edit"), dir);
    assert.equal(result.pass, true, `${before}: ${result.reason}`);
    assert.equal(result.ownerReview, "exempt-ui");
  }
});

test("widening still hits the exempt line budget before ticket gates", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/components/Providers.tsx", 'export const Providers = () => <>{guest && <Banner />}</>;\n');
  const base = commit(git, "guarded");
  writeFile(dir, "src/components/Providers.tsx", 'export const Providers = () => <Banner />;\n' + Array.from({ length: 151 }, (_, index) => `const value${index} = ${index};`).join("\n"));
  const result = await evaluate("HTPR-7274 [BUGFIX] consent", base, commit(git, "large widening"), dir);
  assert.equal(result.pass, false);
  assert.match(result.reason, /over the 150-line budget/);
});

test("verified auto-reverts remain exempt when restoring wider exposure", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/components/Providers.tsx", 'export const Providers = () => <Banner />;\n');
  commit(git, "unrestricted banner");
  writeFile(dir, "src/components/Providers.tsx", 'export const Providers = () => <>{guest && <Banner />}</>;\n');
  const base = commit(git, "HTPR-7274 [BUGFIX] narrow banner");
  git(["revert", "--no-edit", base]);
  const head = git(["rev-parse", "HEAD"]).trim();
  const result = await evaluate('Revert "HTPR-7274 [BUGFIX] narrow banner"', base, head, dir);
  assert.equal(result.pass, true);
  assert.match(result.reason, /Verified auto-revert/);
});

test("first placement of an existing local component needs a flag", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/components/Providers.tsx", 'const Banner = () => <div>Consent</div>;\nexport const Providers = () => <div />;\n');
  const base = commit(git, "existing local banner");
  writeFile(dir, "src/components/Providers.tsx", 'const Banner = () => <div>Consent</div>;\nexport const Providers = () => <Banner />;\n');
  const result = await evaluate("HTPR-7274 [BUGFIX] consent", base, commit(git, "place local banner"), dir);
  assert.equal(result.pass, false);
  assert.match(result.reason, /Providers.tsx:Banner rendered 1 more times/);
});


test("added-file default policy preserves existing flags and requires explicit Everyone only for new eligible definitions", async (t) => {
  const risk = 'releaseRisk: { risk: "new", reason: "Fixture" }';
  const sensitive = 'releaseRisk: { risk: "new", reason: "Fixture", highRisk: "access" }';
  const ownerRequest = 'ownerRequest: { quote: "Keep this Owner only for now.", ticketUrl: "https://app.hypertask.ai/detail/project-15/2" }';
  const requested = `releaseRisk: { risk: "new", reason: "Fixture", ${ownerRequest} }`;
  for (const [extra, pass, message] of [
    [risk, false, /new flag htpr-2-new must set defaultMode: "EVERYONE"/],
    [`kind: "feature", ${risk}`, false],
    [`kind: "improvement", ${risk}`, false],
    [`kind: "feature", defaultMode: "EVERYONE", ${risk}`, true],
    [`kind: "improvement", defaultMode: "EVERYONE", ${risk}`, true],
    [`defaultMode: "OWNER_ONLY", ${requested}`, true],
    [`kind: "feature", defaultMode: "OWNER_ONLY", ${requested}`, true],
    [`kind: "improvement", defaultMode: "OWNER_ONLY", ${requested}`, true],
    [`defaultMode: "OWNER_ONLY", ${risk}`, false, /OWNER_ONLY.*releaseRisk\.ownerRequest.*quote.*ticketUrl/],
    [`defaultMode: "OWNER_ONLY", ${requested.replace('"Keep this Owner only for now."', '""')}`, false, /ownerRequest\.quote must be a non-blank string literal/],
    [`defaultMode: "OWNER_ONLY", ${requested.replace('"Keep this Owner only for now."', '"   "')}`, false, /ownerRequest\.quote must be a non-blank string literal/],
    [`defaultMode: "OWNER_ONLY", ${requested.replace("app.hypertask.ai", "hypertask.ai")}`, false, /ownerRequest\.ticketUrl must be a string literal like https:\/\/app\.hypertask\.ai\/detail\/project-15\/123/],
    [`defaultMode: "OWNER_AND_QA", ${requested}`, false, /must set defaultMode: "EVERYONE"/],
    [`defaultMode: "OFF", ${requested}`, false, /must set defaultMode: "EVERYONE"/],
    [requested, false, /must set defaultMode: "EVERYONE"/],
    [`defaultMode: "EVERYONE", ${requested}`, true],
    [`defaultMode: "OWNER_AND_QA", releaseRisk: { risk: "new", reason: "Fixture", highRisk: "access", ${ownerRequest} }`, true],
    [`defaultMode: "EVERYONE", releaseRisk: { risk: "new", reason: "Fixture", highRisk: "access", ${ownerRequest} }`, false, /releaseRisk\.highRisk may not default to Everyone/],
    [`kind: "bugfix", ${risk}`, true],
    [`kind: "feature", defaultMode: "OWNER_AND_QA", ${sensitive}`, true],
    [`kind: "feature", defaultMode: "EVERYONE", ${sensitive}`, false],
    [`kind: "bugfix", ${sensitive}`, false],
    [`kind: "bugfix", defaultMode: "OWNER_AND_QA", ${sensitive}`, true],
    [`kind: "internal", ${risk}`, true],
    [`kind: "internal", defaultMode: "EVERYONE", ${risk}`, false],
  ]) {
    const { dir, git } = makeRepo(t);
    perFlagLayout(dir);
    const base = commit(git, "existing feature without defaultMode");
    writeFile(dir, "src/lib/flags/definitions/htpr-2-new.ts", `export const NEW_FLAG = "htpr-2-new";
export default { key: NEW_FLAG, shippedOn: "2026-10-20", description: "Fixture", ${extra} } as const;`);
    const result = await evaluate("YPER4-2 [INFRA] Fixture", base, commit(git, "added definition"), dir);
    assert.equal(result.pass, pass, extra + ": " + result.reason);
    if (message) assert.match(result.reason, message);
  }
  const { dir, git } = makeRepo(t);
  perFlagLayout(dir);
  const base = commit(git, "existing feature without defaultMode");
  writeFile(dir, "src/components/Widget.tsx", 'import { OTHER_FLAG } from "@/lib/flags/keys";\nimport { useFlag } from "@/hooks/useFlag";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div /> : null;\n');
  const result = await evaluate("HTPR-1 [FEATURE] Existing flag", base, commit(git, "unchanged definition"), dir);
  assert.equal(result.pass, true, result.reason);
});

test("sidebar lazy-runtime gating is visible at the exported entry, not hidden inside an effect callback", async (t) => {
  const provider = fs.readFileSync(path.join(root, "src/components/ProviderGlobal/GloablProviders.tsx"), "utf8");
  const effect = provider.slice(provider.indexOf("  useEffect(agentSidebarChatsEnabled ?"), provider.indexOf("  const [chatRuntimeMounted"));
  assert.match(effect, /useEffect\(agentSidebarChatsEnabled \?/);
  for (const [name, source, expected] of [
    ["current provider effect", effect, true],
    ["old hidden effect branch", 'useEffect(() => { if (!agentSidebarChatsEnabled) return; setSidebarRequested(new URLSearchParams(window.location.search).has("agentSidebar")); }, [agentSidebarChatsEnabled]);', false],
  ]) {
    const fixture = makeRepo(t), base = commit(fixture.git, "base");
    writeFile(fixture.dir, "src/components/Provider.tsx", `import { useEffect } from "react";
import { useFlag } from "@/hooks/useFlag";
import { OTHER_FLAG } from "@/lib/flags/keys";
export function Provider() {
  const agentSidebarChatsEnabled = useFlag(OTHER_FLAG);
  ${source}
  return <div />;
}`);
    const result = await evaluate("HTPR-1 [FEATURE] sidebar startup", base, commit(fixture.git, name), fixture.dir);
    assert.equal(result.pass, expected, `${name}: ${result.reason}`);
  }
});

test("documented flag-gate shapes stay accepted and reject ungated variants", async (t) => {
  const reference = fs.readFileSync(path.join(root, ".claude/reference/flags.md"), "utf8");
  const examples = [...reference.matchAll(/```tsx flag-gate:(\w+)\n([\s\S]*?)\n```/g)];
  assert.deepEqual(examples.map(([, name]) => name), ["prop", "effect", "rows"]);
  for (const [, name, source] of examples) {
    const { dir, git } = makeRepo(t);
    const base = commit(git, "base");
    writeFile(dir, "src/components/Widget.tsx", source + "\n");
    const accepted = await evaluate("HTPR-1 [FEATURE] documented widget", base, commit(git, name), dir);
    assert.equal(accepted.pass, true, `${name}: ${accepted.reason}`);
    writeFile(dir, "src/components/Widget.tsx", source.replace("useFlag(OTHER_FLAG)", "true") + "\n");
    const ungated = await evaluate("HTPR-1 [FEATURE] documented widget", base, commit(git, `${name} ungated`), dir);
    assert.equal(ungated.pass, false, `${name} must refuse an unused flag import`);
  }
});

test("documented flag-gate shapes name unsupported prop, effect and map callbacks", async (t) => {
  for (const [name, body] of [
    ["mapped conditional prop", "return <>{items.map((item) => <button key={item.id} onClick={enabled ? doWork : undefined} />)}</>;"],
    ["hidden effect branch", "useEffect(() => { if (!enabled) return; doWork(); }, [enabled]); return <div />;"],
    ["map callback", "return <>{items.map((item) => <div key={item.id}>{enabled && <button onClick={doWork} />}</div>)}</>;"],
  ]) {
    const { dir, git } = makeRepo(t);
    const base = commit(git, "base");
    writeFile(dir, "src/components/Widget.tsx", `import { useEffect } from "react";
import { useFlag } from "@/hooks/useFlag";
import { OTHER_FLAG } from "@/lib/flags/keys";
declare function doWork(): void;
declare const items: { id: string }[];
export function Widget() { const enabled = useFlag(OTHER_FLAG); ${body} }
`);
    const result = await evaluate("HTPR-1 [FEATURE] documented widget", base, commit(git, name), dir);
    assert.equal(result.pass, false, `${name}: ${result.reason}`);
  }
});

test("documented flag-gate shapes follow imports from a gated consumer, not back from a hook", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/hooks/usePreview.ts", `import { useFlag } from "@/hooks/useFlag";
import { OTHER_FLAG } from "@/lib/flags/keys";
export function usePreview() { return useFlag(OTHER_FLAG) ? "new" : "old"; }
`);
  const imports = `import { usePreview } from "../hooks/usePreview";
import { useFlag } from "@/hooks/useFlag";
import { OTHER_FLAG } from "@/lib/flags/keys";
`;
  writeFile(dir, "src/components/Widget.tsx", imports + "export function Widget() { return <div>{usePreview()}</div>; }\n");
  const hookOnly = await evaluate("HTPR-1 [FEATURE] documented widget", base, commit(git, "hook gate only"), dir);
  assert.equal(hookOnly.pass, false, hookOnly.reason);
  writeFile(dir, "src/components/Widget.tsx", imports + `export function Widget() {
  const preview = usePreview();
  return useFlag(OTHER_FLAG) ? <div>{preview}</div> : <div />;
}
`);
  const consumer = await evaluate("HTPR-1 [FEATURE] documented widget", base, commit(git, "gated consumer"), dir);
  assert.equal(consumer.pass, true, consumer.reason);
});

test('render-child gates require a consumed custom component callback', async (t) => {
  const cases = [
    ['render child', 'return <Boundary>{() => <Row limit={enabled ? 3 : undefined} />}</Boundary>;', true],
    ['named render child', 'const render = () => <Row limit={enabled ? 3 : undefined} />; return <Boundary>{render}</Boundary>;', true],
    ['discarded named render child', 'const render = () => <Row limit={enabled ? 3 : undefined} />; const unused = <Boundary>{render}</Boundary>; return <Row />;', false],
    ['nested render children', 'return <Boundary>{() => <Boundary>{() => <Row limit={enabled ? 3 : undefined} />}</Boundary>}</Boundary>;', true],
    ['discarded render child', 'const unused = <Boundary>{() => <Row limit={enabled ? 3 : undefined} />}</Boundary>; return <Row />;', false],
    ['dead render child', 'return <>{false && <Boundary>{() => <Row limit={enabled ? 3 : undefined} />}</Boundary>}</>;', false],
    ['intrinsic function child', 'return <div>{() => <Row limit={enabled ? 3 : undefined} />}</div>;', false],
    ['shadowed render flag', 'return <Boundary>{(enabled) => <Row limit={enabled ? 3 : undefined} />}</Boundary>;', false],
    ['unrelated map callback', 'return <>{items.map(() => <Row limit={enabled ? 3 : undefined} />)}</>;', false],
  ];
  for (const [name, body, expected] of cases) {
    const { dir, git } = makeRepo(t), base = commit(git, 'base');
    writeFile(dir, 'src/components/Widget.tsx', 'import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\nexport function Widget() { const enabled = useFlag(OTHER_FLAG); ' + body + ' }\n');
    const result = await evaluate('HTPR-1 [FEATURE] render child', base, commit(git, name), dir);
    assert.equal(result.pass, expected, name);
  }
});

test('changed component paths accept private gates without trusting unchanged sibling exports', async (t) => {
  const imports = 'import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\n';
  const entry = 'export function Widget() { return <Private />; }\n';
  const unchanged = 'export function Title() { return <h1>Existing</h1>; }\n';
  const gated = 'function Private() { return useFlag(OTHER_FLAG) ? <span>New</span> : null; }\n';
  const cases = [
    ['private child behind unchanged entry', entry + gated + unchanged, true],
    ['changed entry reaches private child', entry.replace('<Private />', '<main><Private /></main>') + gated + unchanged, true],
    ['new unrelated ungated export', entry + gated + unchanged + 'export function Other() { return <aside>New</aside>; }\n', false],
    ['changed ungated sibling', entry + gated + unchanged.replace('Existing', 'New'), false],
    ['unused gated private component', entry.replace('<Private />', '<div>New</div>') + gated + unchanged, false],
    ['shadowed private component', 'export function Widget() { const Private = () => <div>New</div>; return <Private />; }\n' + gated + unchanged, false],
    ['discarded gated child', 'export function Widget() { const unused = <Private />; return <div>New</div>; }\n' + gated + unchanged, false],
    ['dead gated child', 'export function Widget() { return <>{false && <Private />}<div>New</div></>; }\n' + gated + unchanged, false],
  ];
  for (const [name, source, expected] of cases) {
    const { dir, git } = makeRepo(t);
    writeFile(dir, 'src/components/Widget.tsx', imports + entry + 'function Private() { return null; }\n' + unchanged);
    const base = commit(git, 'existing components');
    writeFile(dir, 'src/components/Widget.tsx', imports + source);
    const result = await evaluate('HTPR-1 [FEATURE] private child', base, commit(git, name), dir);
    assert.equal(result.pass, expected, name);
  }
});

test('deletion anchors never turn an unchanged flag read into a new ticket gate', async (t) => {
  const { dir, git } = makeRepo(t);
  const source = 'import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\nexport function Widget() {\n  const enabled = useFlag(OTHER_FLAG);\n  const unused = 0;\n  return enabled ? <div>Old</div> : null;\n}\n';
  writeFile(dir, 'src/components/Widget.tsx', source);
  const base = commit(git, 'existing gate');
  writeFile(dir, 'src/components/Widget.tsx', source.replace('  const unused = 0;\n', '').replace('Old', 'New'));
  assert.equal((await evaluate('HTPR-1 [FEATURE] existing gate', base, commit(git, 'delete next to flag'), dir)).pass, false);
});

test('deletion-only sibling changes still require their own reachable ticket gate', async (t) => {
  const { dir, git } = makeRepo(t);
  const source = 'import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\nexport function Widget() { return null; }\nexport function Other() {\n  if (!visible) return null;\n  return <aside>Existing</aside>;\n}\n';
  writeFile(dir, 'src/components/Widget.tsx', source);
  const base = commit(git, 'existing siblings');
  const gated = source.replace('return null; }', 'return useFlag(OTHER_FLAG) ? <div>New</div> : null; }');
  writeFile(dir, 'src/components/Widget.tsx', gated);
  assert.equal((await evaluate('HTPR-1 [FEATURE] sibling control', base, commit(git, 'still allowed'), dir)).pass, true);
  writeFile(dir, 'src/components/Widget.tsx', gated.replace('  if (!visible) return null;\n', ''));
  assert.equal((await evaluate('HTPR-1 [FEATURE] sibling control', base, commit(git, 'now refused'), dir)).pass, false);
});

test('changed module values and rebound exports cannot borrow a sibling gate', async (t) => {
  const imports = 'import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\n';
  const cases = [
    ['changed module constant', 'const title = "Old";\nexport function Title() { return <h1>{title}</h1>; }\n', 'const title = "New";\nexport function Title() { return <h1>{title}</h1>; }\n'],
    ['removed module assignment', 'let title = "Old";\ntitle = "New";\nexport function Title() { return <h1>{title}</h1>; }\n', 'let title = "Old";\nexport function Title() { return <h1>{title}</h1>; }\n'],
    ['same-line module constant', 'const title = "Old"; export function Title() { return <h1>{title}</h1>; }\n', 'const title = "New"; export function Title() { return <h1>{title}</h1>; }\n'],
    ['edited rebound entry', 'export let Other = () => <aside>Old</aside>;\nOther = () => <aside>Old</aside>;\n', 'export let Other = () => <aside>New</aside>;\nOther = () => <aside>New</aside>;\n'],
    ['only reassignment edited', 'export let Other = () => <aside>Old</aside>;\nOther = () => <aside>Old</aside>;\n', 'export let Other = () => <aside>Old</aside>;\nOther = () => <aside>New</aside>;\n'],
  ];
  for (const [name, before, after] of cases) {
    const { dir, git } = makeRepo(t);
    writeFile(dir, 'src/components/Widget.tsx', imports + before);
    const base = commit(git, 'existing UI');
    writeFile(dir, 'src/components/Widget.tsx', imports + after + 'export function Gated() { return useFlag(OTHER_FLAG) ? <div>Feature</div> : null; }\n');
    assert.equal((await evaluate('HTPR-1 [FEATURE] sibling gate', base, commit(git, name), dir)).pass, false, name);
  }
});

test('entry-scoped gates cannot come from unrelated module initializers', async (t) => {
  const cases = [
    ['module async call', 'async function load() { if (await isFeatureEnabled(OTHER_FLAG)) doWork(); }\nconst settings = load();\n'],
    ['module JSX callback', 'const unused = <Boundary>{() => <Row limit={useFlag(OTHER_FLAG) ? 3 : undefined}/>}</Boundary>;\n'],
    ['direct module gate', 'const enabled = useFlag(OTHER_FLAG);\nconst setting = enabled ? 1 : 2;\n'],
  ];
  for (const [name, decoy] of cases) {
    const { dir, git } = makeRepo(t), base = commit(git, 'base');
    writeFile(dir, 'src/components/Widget.tsx', 'import {useFlag} from "@/hooks/useFlag";\nimport {isFeatureEnabled} from "@/lib/flags";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\n' + decoy + 'export function Widget() { return <div>Ungated</div>; }\n');
    assert.equal((await evaluate('HTPR-1 [FEATURE] module decoy', base, commit(git, name), dir)).pass, false, name);
  }
});

test('runtime import replacements cannot borrow a sibling gate, while added flag bindings remain allowed', async (t) => {
  for (const [name, beforeImport, afterImport, content, expected] of [
    ['named source replacement', 'import { title } from "./old";', 'import { title } from "./new";', '<h1>{title}</h1>', false],
    ['default source replacement', 'import Title from "./old";', 'import Title from "./new";', '<Title />', false],
    ['namespace source replacement', 'import * as UI from "./old";', 'import * as UI from "./new";', '<UI.Title />', false],
    ['named binding replacement', 'import { oldTitle as title } from "./values";', 'import { newTitle as title } from "./values";', '<h1>{title}</h1>', false],
    ['new side effect', '', 'import "./global-theme";', '<h1>Existing</h1>', false],
    ['added flag binding', 'import { EXISTING_FLAG } from "@/lib/flags/keys";', 'import { EXISTING_FLAG, OTHER_FLAG } from "@/lib/flags/keys";', '<h1>Existing</h1>', true],
  ]) {
    const { dir, git } = makeRepo(t);
    const title = `export function TitleView() { return ${content}; }\n`;
    writeFile(dir, 'src/components/Widget.tsx', beforeImport + '\n' + title);
    const base = commit(git, 'existing imports');
    writeFile(dir, 'src/components/Widget.tsx', afterImport + '\nimport {useFlag} from "@/hooks/useFlag";\n' + (name === 'added flag binding' ? '' : 'import {OTHER_FLAG} from "@/lib/flags/keys";\n') + title + 'export function Gated() { return useFlag(OTHER_FLAG) ? <div>Feature</div> : null; }\n');
    assert.equal((await evaluate('HTPR-1 [FEATURE] import control', base, commit(git, name), dir)).pass, expected, name);
  }
});

test('aliased formatter parameters gate real output, not ignored or overwritten values', async (t) => {
  const cases = [
    ['relative return', './formatter', 'return enabled ? "Age" : null;', true],
    ['aliased return', '@/lib/formatter', 'return enabled ? "Age" : null;', true],
    ['early null return', '@/lib/formatter', 'if (!enabled) return null; return "Age";', true],
    ['compound early return', '@/lib/formatter', 'if ((!enabled && data.fresh) || data.missing) { return null; } const suffix = data.days; return `Age ${suffix}`;', true],
    ['constant default parameter', '@/lib/formatter', 'if (!enabled) return null; return "Age";', true, 'function', 'data, enabled = false'],
    ['if else return', '@/lib/formatter', 'if (enabled) { return "Age"; } else { return null; }', true],
    ['finally overrides early returns', '@/lib/formatter', 'try { if (!enabled) return null; return "Age"; } finally { return "Age"; }', false],
    ['finally overrides conditional return', '@/lib/formatter', 'try { return enabled ? "Age" : null; } finally { return "Age"; }', false],
    ['finally overrides nested block', '@/lib/formatter', 'try { { if (!enabled) return null; return "Age"; } } finally { return "Age"; }', false],
    ['exception control flow is unsupported', '@/lib/formatter', 'try { if (!enabled) return null; return "Age"; } catch { return "Age"; }', false],
    ['nested contradictory guard', '@/lib/formatter', 'if (enabled) { if (!enabled) return null; return "Age"; } return "Age";', false],
    ['nested loop guard', '@/lib/formatter', 'while (enabled) { if (!enabled) return null; return "Age"; } return "Age";', false],
    ['async formatter', '@/lib/formatter', 'if (!enabled) return null; return "Age";', false, 'async function'],
    ['generator formatter', '@/lib/formatter', 'if (!enabled) return null; return "Age";', false, 'function*'],
    ['async generator formatter', '@/lib/formatter', 'if (!enabled) return null; return "Age";', false, 'async function*'],
    ['contradictory compound guard', '@/lib/formatter', 'if (enabled && !enabled) return null; return "Age";', false],
    ['tautological compound guard', '@/lib/formatter', 'if (enabled || !enabled) return null; return "Age";', false],
    ['contradictory conditional', '@/lib/formatter', 'return enabled && !enabled ? null : "Age";', false],
    ['aliased contradiction', '@/lib/formatter', 'const inverse = !enabled; if (enabled && inverse) return null; return "Age";', false],
    ['aliased tautology', '@/lib/formatter', 'const inverse = !enabled; if (enabled || inverse) return null; return "Age";', false],
    ['transitive alias contradiction', '@/lib/formatter', 'const first = !enabled; const inverse = first; if (enabled && inverse) return null; return "Age";', false],
    ['destructured alias contradiction', '@/lib/formatter', 'const {inverse} = {inverse: !enabled}; if (enabled && inverse) return null; return "Age";', false],
    ['aliased conditional contradiction', '@/lib/formatter', 'const inverse = !enabled; return enabled && inverse ? null : "Age";', false],
    ...['1 === 1', '1 < 2', '(true ? true : false)', '(false || true)'].map(value => ['unsupported compound mask ' + value, '@/lib/formatter', `if (enabled || (${value})) return "Age"; return null;`, false]),
    ['ignored parameter', '@/lib/formatter', 'if (enabled) log(); return "Age";', false],
    ['invariant repeated guards', '@/lib/formatter', 'if (!enabled) return \"Age\"; if (enabled) return \"Age\"; return null;', false],
    ['invariant prior guard with else', '@/lib/formatter', 'if (!enabled) return \"Age\"; if (enabled) return \"Age\"; else return null;', false],
    ['same returned value', '@/lib/formatter', 'if (!enabled) return "Age"; return "Age";', false],
    ['same truthy result', '@/lib/formatter', 'if (!enabled) return "Old"; return "Age";', false],
    ['null and undefined results', '@/lib/formatter', 'if (!enabled) return null; return undefined;', false],
    ['constant condition', '@/lib/formatter', 'if (!enabled || true) return null; return "Age";', false],
    ['overwritten parameter', '@/lib/formatter', 'enabled = true; if (!enabled) return null; return "Age";', false],
    ['unused nested gate', '@/lib/formatter', 'function unused() { if (!enabled) return null; return "Age"; } return "Age";', false],
    ['external module', 'formatter', 'if (!enabled) return null; return "Age";', false],
    ['outside source alias', '@/../formatter', 'if (!enabled) return null; return "Age";', false],
  ];
  for (const [name, moduleName, body, expected, declaration = 'function', parameters = 'data, enabled'] of cases) {
    const { dir, git } = makeRepo(t), base = commit(git, 'base');
    const helper = `export ${declaration} format(${parameters}) { ${body} }\n`;
    const helperPath = moduleName === './formatter' ? 'src/components/formatter.ts' : 'src/lib/formatter.ts';
    writeFile(dir, helperPath, helper);
    writeFile(dir, 'src/components/Widget.tsx', `import {useFlag} from "@/hooks/useFlag";
import {OTHER_FLAG} from "@/lib/flags/keys";
import {format} from "${moduleName}";
export function Widget() {
  const enabled = useFlag(OTHER_FLAG);
  const label = format({fresh: true, missing: false, days: 2}, enabled);
  if (!label) return null;
  return <p>{label}</p>;
}
`);
    assert.equal((await evaluate('HTPR-1 [FEATURE] formatter output', base, commit(git, name), dir)).pass, expected, name);
  }
});

test('formatter gate proof requires an explicit live return branch', async (t) => {
  const cases = [
    ['unsupported direct JSX output', 'return <p>{format(enabled)}</p>;', false],
    ['unsupported assigned JSX output', 'const label = format(enabled); return <p>{label}</p>;', false],
    ['direct conditional output', 'return format(enabled) ? <p>Age</p> : null;', true],
    ['assigned conditional output', 'const label = format(enabled); return label ? <p>Age</p> : null;', true],
    ['inverted direct conditional output', 'return !format(enabled) ? null : <p>Age</p>;', true],
    ['empty conditional fragments', 'return format(enabled) ? <></> : null;', false],
    ['empty nested conditional fragments', 'return <div>{format(enabled) ? <></> : null}<p>Always</p></div>;', false],
    ['nested empty fragment children', 'return format(enabled) ? <><></>{null}</> : null;', false],
    ['boolean-only conditional output', 'return format(enabled) ? true : null;', false],
    ['nonempty fragment control', 'return format(enabled) ? <><p>Age</p></> : null;', true],
    ['empty logical fragment', 'return format(enabled) && <></>;', false],
    ['empty early-return fragment', 'const label = format(enabled); if (!label) return null; return <></>;', false],
    ['same truthy conditional branches', 'return format(enabled) ? <p>Age</p> : <p>Always</p>;', false],
    ['assigned early-return output', 'const label = format(enabled); if (!label) return null; return <p>Age</p>;', true],
    ['earlier rendering return', 'const always = true; if (always) return <p>Age</p>; const label = format(enabled); if (!label) return null; return <p>Age</p>;', false],
    ['contradictory consumer', 'const label = format(enabled); if (label && !label) return null; return <p>Age</p>;', false],
    ['undefined comparison never matches', 'const label = format(enabled); if (label === undefined) return null; return <p>Age</p>;', false],
    ['false comparison never matches', 'const label = format(enabled); if (label === false) return null; return <p>Age</p>;', false],
    ['inequality always matches', 'const label = format(enabled); if (label !== undefined) return <p>Age</p>; return null;', false],
    ['boolean negation preserves truthiness', 'const label = format(enabled); if (!!label) return <p>Age</p>; return null;', true],
    ['invariant consumer guards', 'const label = format(enabled); if (label) return <p>Age</p>; if (!label) return <p>Age</p>; return null;', false],
    ['masked direct output', 'return <p>{format(enabled) || \"Age\"}</p>;', false],
    ['masked assigned output', 'const label = format(enabled); return <p>{label || \"Age\"}</p>;', false],
    ['masked JSX element', 'return <p>{format(enabled)}</p> && false;', false],
    ['ignored call argument', 'const ignore = () => {}; ignore(format(enabled)); return <p>Always</p>;', false],
    ['ignored assigned argument', 'const ignore = () => {}; const label = format(enabled); ignore(label); return <p>Always</p>;', false],
    ['discarded JSX result', 'const unused = <p>{format(enabled)}</p>; return <p>Always</p>;', false],
    ['event handler JSX return', 'const label = format(enabled); const row = <div>{label && <p>Age</p>}</div>; const send = () => row; return <button onClick={send}/>;', false],
    ['rendered JSX binding control', 'const label = format(enabled); const row = <div>{label && <p>Age</p>}</div>; return row;', true],
    ['dead direct output', 'return <>{false && <p>{format(enabled)}</p>}</>;', false],
    ['discarded result', 'format(enabled); return <p>Always</p>;', false],
    ['unused assignment', 'const unused = format(enabled); return <p>Always</p>;', false],
    ['overwritten result', 'let label = format(enabled); label = "Always"; return <p>{label}</p>;', false],
    ['dead output', 'const label = format(enabled); return <>{false && <p>{label}</p>}</>;', false],
  ];
  for (const [name, body, expected] of cases) {
    const { dir, git } = makeRepo(t), base = commit(git, 'base');
    writeFile(dir, 'src/lib/formatter.ts', 'export function format(enabled) { if (!enabled) return null; return "Age"; }\n');
    writeFile(dir, 'src/components/Widget.tsx', 'import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\nimport {format} from "@/lib/formatter";\nexport function Widget() { const enabled = useFlag(OTHER_FLAG); ' + body + ' }\n');
    assert.equal((await evaluate('HTPR-1 [FEATURE] formatter consumer', base, commit(git, name), dir)).pass, expected, name);
  }
});

test('formatter return proof follows rendered components, never discarded hook or helper results', async (t) => {
  const label = 'const enabled = useFlag(OTHER_FLAG); const label = format(enabled);';
  const guarded = label + ' if (!label) return null; return <p>Age</p>;';
  const cases = [
    ['mounted component', `function Private() { ${guarded} } export function Widget() { return <Private/>; }`, true],
    ['returned JSX binding', `function Private() { ${guarded} } export function Widget() { const row = <Private/>; return row; }`, true],
    ['discarded inline hook guard', `function useLabel() { const enabled = useFlag(OTHER_FLAG); if (format(enabled)) return \"Age\"; return null; } export function Widget() { useLabel(); return <p>Always</p>; }`, false],
    ['live action handler', 'export function Widget() { const enabled = useFlag(OTHER_FLAG); const send = () => { if (format(enabled)) doWork(); }; return <button onClick={send}/>; }', true],
    ['dead action branch', 'export function Widget() { const enabled = useFlag(OTHER_FLAG); const send = () => { if (format(enabled)) { if (false) doWork(); } }; return <button onClick={send}/>; }', false],
    ['discarded hook result', `function useLabel() { ${label} return label; } export function Widget() { useLabel(); return <p>Always</p>; }`, false],
    ['discarded inverted string hook', `function useLabel() { ${label} if (label) return \"Age\"; return null; } export function Widget() { useLabel(); return <p>Always</p>; }`, false],
    ['discarded inverted JSX helper', `function Private() { ${label} if (label) return <p>Age</p>; return null; } export function Widget() { Private(); return <p>Always</p>; }`, false],
    ['mounted inverted guard', `function Private() { ${label} if (label) return <p>Age</p>; return null; } export function Widget() { return <Private/>; }`, true],
    ['discarded guarded string hook', `function useLabel() { ${label} if (!label) return null; return "Age"; } export function Widget() { useLabel(); return <p>Always</p>; }`, false],
    ['discarded JSX helper', `function Private() { ${guarded} } export function Widget() { Private(); return <p>Always</p>; }`, false],
    ['discarded exported JSX helper', `export function Private() { ${guarded} } export function Widget() { Private(); return <p>Always</p>; }`, false],
    ['ignored JSX argument', `function Private() { ${guarded} } export function Widget() { const ignore = () => {}; ignore(<Private/>); return <p>Always</p>; }`, false],
    ['masked JSX component', `function Private() { ${guarded} } export function Widget() { return <Private/> && false; }`, false],
    ['overwritten JSX binding', `function Private() { ${guarded} } export function Widget() { let row = <Private/>; row = <p>Always</p>; return row; }`, false],
  ];
  for (const [name, source, expected] of cases) {
    const { dir, git } = makeRepo(t), base = commit(git, 'base');
    writeFile(dir, 'src/lib/formatter.ts', 'export function format(enabled) { if (!enabled) return null; return "Age"; }\n');
    writeFile(dir, 'src/components/Widget.tsx', 'import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\nimport {format} from "@/lib/formatter";\n' + source);
    assert.equal((await evaluate('HTPR-1 [FEATURE] rendered formatter consumer', base, commit(git, name), dir)).pass, expected, name);
  }
});

test('early-return formatter truthiness refuses always-visible branches', async (t) => {
  const cases = [
    ['null versus text', 'null', '"Age"', true],
    ['null versus nonempty template', 'null', '`Age ${data.days}`', true],
    ['undefined versus text', 'undefined', '"Age"', true],
    ['false versus text', 'false', '"Age"', true],
    ['zero versus text', '0', '"Age"', true],
    ['empty text versus text', '""', '"Age"', true],
    ['object versus text', '{}', '"Age"', false],
    ['array versus text', '[]', '"Age"', false],
    ['arrow versus text', '() => {}', '"Age"', false],
    ['function versus text', 'function() {}', '"Age"', false],
    ['class versus text', 'class {}', '"Age"', false],
    ['regexp versus text', '/old/', '"Age"', false],
    ['constructed object versus text', 'new Boolean(false)', '"Age"', false],
    ['wrapped object versus text', '({} as unknown)', '"Age"', false],
    ['nonempty template versus text', '`Old ${data.days}`', '"Age"', false],
    ['unknown call versus text', 'data.value()', '"Age"', false],
    ['null versus unknown call', 'null', 'data.value()', false],
    ['unknown template versus text', '`${data.days}`', '"Age"', false],
  ];
  for (const [name, disabled, enabled, expected] of cases) {
    const { dir, git } = makeRepo(t), base = commit(git, 'base');
    writeFile(dir, 'src/lib/formatter.ts', `export function format(data, enabled) { if (!enabled) return ${disabled}; return ${enabled}; }\n`);
    writeFile(dir, 'src/components/Widget.tsx', 'import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\nimport {format} from "@/lib/formatter";\nexport function Widget() { const enabled = useFlag(OTHER_FLAG); const label = format({}, enabled); if (!label) return null; return <p>Age</p>; }\n');
    assert.equal((await evaluate('HTPR-1 [FEATURE] formatter truthiness', base, commit(git, name), dir)).pass, expected, name);
  }
});

test('invariant formatter guards cannot prove an early-return gate', async (t) => {
  const cases = [
    ['correlated parameter contradiction', 'enabled, inverse', 'if (enabled && inverse) return null; return "Age";', 'const label = format(enabled, !enabled); if (!label) return null; return <p>Age</p>;'],
    ['correlated parameter tautology', 'enabled, inverse', 'if (enabled || inverse) return "Age"; return null;', 'const label = format(enabled, !enabled); if (!label) return null; return <p>Age</p>;'],
    ...['undefined', 'null', '"yes"', '0'].map(value => ['impossible comparison ' + value, 'enabled', `if (enabled === ${value}) return null; return "Age";`, 'const label = format(enabled); if (!label) return null; return <p>Age</p>;']),
    ...['{}', '[]', '`Age ${enabled}`', '() => {}'].map(value => ['truthy mask ' + value, 'enabled', `if (enabled || ${value}) return "Age"; return null;`, 'const label = format(enabled); if (!label) return null; return <p>Age</p>;']),
    ['nested conditional return', 'enabled', 'if (enabled) return enabled ? "Age" : null; return "Age";', 'const label = format(enabled); if (!label) return null; return <p>Age</p>;'],
    ['impossible direct consumer', 'enabled', 'if (!enabled) return null; return "Age";', 'if (format(enabled) !== undefined) return <p>Age</p>; return null;'],
    ['invariant returned ternary helper', 'enabled', 'return enabled ? !enabled : false;', 'const label = format(enabled); if (!label) return null; return <p>Age</p>;'],
    ['invariant returned alternate helper', 'enabled', 'return enabled ? true : !enabled;', 'const label = format(enabled); if (!label) return null; return <p>Age</p>;'],
    ['invariant returned branch helper', 'enabled', 'return !enabled ? enabled : false;', 'return format(enabled) ? <p>Age</p> : null;'],
    ['invariant ternary helper', 'enabled', 'if (enabled ? !enabled : false) return null; return "Age";', 'const label = format(enabled); if (!label) return null; return <p>Age</p>;'],
    ['invariant alternate ternary helper', 'enabled', 'if (enabled ? false : enabled) return null; return "Age";', 'const label = format(enabled); if (!label) return null; return <p>Age</p>;'],
    ['default parameter contradiction', 'enabled, inverse = !enabled', 'if (enabled && inverse) return null; return "Age";', 'const label = format(enabled); if (!label) return null; return <p>Age</p>;'],
    ['default parameter tautology', 'enabled, inverse = !enabled', 'if (enabled || inverse) return null; return "Age";', 'const label = format(enabled); if (!label) return null; return <p>Age</p>;'],
    ['invariant ternary consumer', 'enabled', 'if (!enabled) return null; return "Age";', 'const label = format(enabled); if (label ? !label : false) return null; return <p>Age</p>;'],
  ];
  for (const [name, parameters, helper, consumer] of cases) {
    const { dir, git } = makeRepo(t), base = commit(git, 'base');
    writeFile(dir, 'src/lib/formatter.ts', `export function format(${parameters}) { ${helper} }\n`);
    writeFile(dir, 'src/components/Widget.tsx', 'import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\nimport {format} from "@/lib/formatter";\nexport function Widget() { const enabled = useFlag(OTHER_FLAG); ' + consumer + ' }\n');
    assert.equal((await evaluate('HTPR-1 [FEATURE] formatter guard', base, commit(git, name), dir)).pass, false, name);
  }
});


test('imported boolean conjunctions preserve independent caller inputs', async (t) => {
  const cases = [
    ['independent direct conditional', 'window.ready', 'return showWidget(window.ready, enabled) ? <p>Age</p> : null;', true],
    ['independent assigned return', 'window.ready', 'const label = showWidget(window.ready, enabled); if (!label) return null; return <p>Age</p>;', true],
    ['truthy independent input', 'true', 'return showWidget(true, enabled) ? <p>Age</p> : null;', true],
    ['falsy independent input', 'false', 'return showWidget(false, enabled) ? <p>Age</p> : null;', false],
    ['correlated direct conditional', '!enabled', 'return showWidget(!enabled, enabled) ? <p>Age</p> : null;', false],
    ['aliased correlated input', 'inverse', 'const inverse = !enabled; return showWidget(inverse, enabled) ? <p>Age</p> : null;', false],
    ['same correlated input', 'enabled', 'return showWidget(enabled, enabled) ? <p>Age</p> : null;', false],
  ];
  for (const [name, input, body, expected] of cases) {
    const { dir, git } = makeRepo(t), base = commit(git, 'base');
    writeFile(dir, 'src/lib/formatter.ts', 'export function showWidget(ready, enabled) { return ready && enabled; }\n');
    writeFile(dir, 'src/components/Widget.tsx', 'import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\nimport {showWidget} from "@/lib/formatter";\nexport function Widget() { const enabled = useFlag(OTHER_FLAG); ' + body + ' }\n');
    assert.equal((await evaluate('HTPR-1 [FEATURE] independent formatter input', base, commit(git, name), dir)).pass, expected, name + ': ' + input);
  }
});


test('formatter dependencies and consumed logical rendering stay sound', async (t) => {
  const cases = [
    ['constant false object field', 'data, enabled', 'if (enabled && data.inverse) return null; return "Age";', '', 'const label = format({inverse: false}, enabled); if (!label) return null; return <p>Age</p>;', false],
    ['constant true object mask', 'data, enabled', 'if (enabled || data.always) return "Age"; return null;', '', 'const label = format({always: true}, enabled); if (!label) return null; return <p>Age</p>;', false],
    ['aliased constant false object', 'data, enabled', 'if (enabled && data.inverse) return null; return "Age";', '', 'const data = {inverse: false}; const label = format(data, enabled); if (!label) return null; return <p>Age</p>;', false],
    ['nested constant false object', 'data, enabled', 'if (enabled && data.nested.inverse) return null; return "Age";', '', 'const data = {nested: {inverse: false}}; const label = format(data, enabled); if (!label) return null; return <p>Age</p>;', false],
    ['missing object field', 'data, enabled', 'if (enabled && data.inverse) return null; return "Age";', '', 'const label = format({}, enabled); if (!label) return null; return <p>Age</p>;', false],
    ['inherited truthy method', 'data, enabled', 'if (enabled || data.toString) return "Age"; return null;', '', 'const label = format({}, enabled); if (!label) return null; return <p>Age</p>;', false],
    ['inherited constructor', 'data, enabled', 'return enabled || data.constructor;', '', 'return format({}, enabled) ? <p>Age</p> : null;', false],
    ['inherited prototype', 'data, enabled', 'return enabled || data.__proto__;', '', 'return format({}, enabled) ? <p>Age</p> : null;', false],
    ['ignored primitive prototype setter', 'data, enabled', 'return enabled || data.__proto__;', '', 'return format({__proto__: false}, enabled) ? <p>Age</p> : null;', false],
    ['custom inherited truthy field', 'data, enabled', 'return enabled || data.ready;', '', 'return format({__proto__: {ready: true}}, enabled) ? <p>Age</p> : null;', false],
    ['custom inherited falsy field', 'data, enabled', 'return enabled && data.ready;', '', 'return format({__proto__: {ready: false}}, enabled) ? <p>Age</p> : null;', false],
    ['negated inherited field', 'data, enabled', 'return enabled && !data.toString;', '', 'return format({}, enabled) ? <p>Age</p> : null;', false],
    ['nested inherited field', 'data, enabled', 'return enabled || data.nested.toString;', '', 'return format({nested: {}}, enabled) ? <p>Age</p> : null;', false],
    ['empty string length', 'data, enabled', 'return enabled && data.length;', '', 'return format("", enabled) ? <p>Age</p> : null;', false],
    ['spread inherited field', 'data, enabled', 'return enabled || data.toString;', '', 'return format({...{}}, enabled) ? <p>Age</p> : null;', false],
    ['own falsy method override', 'data, enabled', 'return enabled || data.toString;', '', 'return format({toString: false}, enabled) ? <p>Age</p> : null;', true],
    ['own truthy method override', 'data, enabled', 'return enabled && data.toString;', '', 'return format({toString: true}, enabled) ? <p>Age</p> : null;', true],
    ['own field on custom prototype', 'data, enabled', 'return enabled || data.ready;', '', 'return format({__proto__: {ready: true}, ready: false}, enabled) ? <p>Age</p> : null;', true],
    ['negated constant object mask', 'data, enabled', 'if (enabled || !data.disabled) return "Age"; return null;', '', 'const label = format({disabled: false}, enabled); if (!label) return null; return <p>Age</p>;', false],
    ['constant true object control', 'data, enabled', 'if (enabled && data.ready) return "Age"; return null;', '', 'const label = format({ready: true}, enabled); if (!label) return null; return <p>Age</p>;', true],
    ['constant false object control', 'data, enabled', 'if (enabled || data.ready) return "Age"; return null;', '', 'const label = format({ready: false}, enabled); if (!label) return null; return <p>Age</p>;', true],
    ['independent field sharing flag name', 'data, enabled', 'return data.enabled && enabled;', 'props', 'return format(props, enabled) ? <p>Age</p> : null;', true],
    ['dependent object default', 'enabled, data = {inverse: !enabled}', 'if (enabled && data.inverse) return null; return "Age";', '', 'const label = format(enabled, undefined); if (!label) return null; return <p>Age</p>;', false],
    ['nested dependent object default', 'enabled, data = {nested: {inverse: !enabled}}', 'if (enabled && data.nested.inverse) return null; return "Age";', '', 'const label = format(enabled, undefined); if (!label) return null; return <p>Age</p>;', false],
    ['unsupported caller comparison', 'ready, enabled', 'return enabled || ready;', '', 'return format(1 === 1, enabled) ? <p>Age</p> : null;', false],
    ['default truthy mask', 'ready = true, enabled', 'if (enabled || ready) return "Age"; return null;', '', 'return format(undefined, enabled) ? <p>Age</p> : null;', false],
    ['aliased undefined default mask', 'ready = true, enabled', 'return enabled || ready;', '', 'const ready = undefined; return format(ready, enabled) ? <p>Age</p> : null;', false],
    ['void default mask', 'ready = true, enabled', 'return enabled || ready;', '', 'return format(void 0, enabled) ? <p>Age</p> : null;', false],
    ['default falsy conjunction', 'ready = false, enabled', 'return enabled && ready;', '', 'return format(undefined, enabled) ? <p>Age</p> : null;', false],
    ['default falsy disjunction control', 'ready = false, enabled', 'return enabled || ready;', '', 'return format(undefined, enabled) ? <p>Age</p> : null;', true],
    ['null skips default control', 'ready = true, enabled', 'return enabled || ready;', '', 'return format(null, enabled) ? <p>Age</p> : null;', true],
    ['false skips default control', 'ready = true, enabled', 'return enabled || ready;', '', 'return format(false, enabled) ? <p>Age</p> : null;', true],
    ['overwritten secondary parameter', 'ready, enabled', 'const ignored = (ready = true); if (enabled || ready) return "Age"; return null;', '', 'return format(false, enabled) ? <p>Age</p> : null;', false],
    ['updated secondary parameter', 'ready, enabled', 'const ignored = ready++; if (enabled || ready) return "Age"; return null;', '', 'return format(false, enabled) ? <p>Age</p> : null;', false],
    ['falsy disjunction input', 'ready, enabled', 'return ready || enabled;', '', 'return format(false, enabled) ? <p>Age</p> : null;', true],
    ['truthy disjunction mask', 'ready, enabled', 'return ready || enabled;', '', 'return format(true, enabled) ? <p>Age</p> : null;', false],
    ['aliased falsy conjunction', 'ready, enabled', 'return ready && enabled;', '', 'const ready = false; return format(ready, enabled) ? <p>Age</p> : null;', false],
    ['aliased falsy disjunction', 'ready, enabled', 'return ready || enabled;', '', 'const ready = false; return format(ready, enabled) ? <p>Age</p> : null;', true],
    ['correlated object field', 'data, enabled', 'if (enabled && data.inverse) return null; return "Age";', '', 'const label = format({inverse: !enabled}, enabled); if (!label) return null; return <p>Age</p>;', false],
    ['aliased correlated object', 'data, enabled', 'if (enabled && data.inverse) return null; return "Age";', '', 'const data = {inverse: !enabled}; const label = format(data, enabled); if (!label) return null; return <p>Age</p>;', false],
    ['independent object field', 'data, enabled', 'if (enabled && data.inverse) return null; return "Age";', '{ready}', 'const label = format({inverse: ready}, enabled); if (!label) return null; return <p>Age</p>;', true],
    ['logical rendering', 'enabled', 'return enabled;', '', 'return format(enabled) && <p>Age</p>;', true],
    ['nested logical rendering', 'enabled', 'return enabled;', '', 'return <div>{format(enabled) && <p>Age</p>}</div>;', true],
    ['nested conditional rendering', 'enabled', 'return enabled;', '', 'return <div>{format(enabled) ? <p>Age</p> : null}</div>;', true],
    ['discarded nested rendering', 'enabled', 'return enabled;', '', 'const discarded = <div>{format(enabled) && <p>Age</p>}</div>; return <p>Age</p>;', false],
    ['masked nested rendering', 'enabled', 'return enabled;', '', 'return (<div>{format(enabled) && <p>Age</p>}</div>, <p>Age</p>);', false],
    ['independent destructured prop', 'ready, enabled', 'return ready && enabled;', '{ready}', 'return format(ready, enabled) ? <p>Age</p> : null;', true],
    ['independent prop alias', 'ready, enabled', 'return ready && enabled;', '{ready}', 'const available = ready; return format(available, enabled) ? <p>Age</p> : null;', true],
    ['independent parameter prop', 'ready, enabled', 'return ready && enabled;', 'props', 'return format(props.ready, enabled) ? <p>Age</p> : null;', true],
    ['correlated shorthand field', 'data, enabled', 'if (enabled && data.enabled) return null; return "Age";', '', 'const label = format({enabled}, enabled); if (!label) return null; return <p>Age</p>;', false],
  ];
  for (const [name, parameters, helper, props, consumer, expected] of cases) {
    const { dir, git } = makeRepo(t), base = commit(git, 'base');
    writeFile(dir, 'src/lib/formatter.ts', `export function format(${parameters}) { ${helper} }`);
    writeFile(dir, 'src/components/Widget.tsx', 'import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\nimport {format} from "@/lib/formatter";\n' + `export function Widget(${props}) { const enabled = useFlag(OTHER_FLAG); ${consumer} }`);
    assert.equal((await evaluate('HTPR-1 [FEATURE] formatter dependency', base, commit(git, name), dir)).pass, expected, name);
  }
});

test('async server consumers preserve synchronous formatter gates', async (t) => {
  const cases = [
    ['relative conditional', '../lib/formatter', 'export function format(enabled) { return enabled; }', 'return format(enabled) ? <p>Age</p> : null;', true],
    ['alias conditional', '@/lib/formatter', 'export function format(enabled) { return enabled; }', 'return format(enabled) ? <p>Age</p> : null;', true],
    ['assigned early return', '@/lib/formatter', 'export function format(enabled) { return enabled; }', 'const label = format(enabled); if (!label) return null; return <p>Age</p>;', true],
    ['async formatter remains refused', '@/lib/formatter', 'export async function format(enabled) { return enabled; }', 'return format(enabled) ? <p>Age</p> : null;', false],
  ];
  for (const [name, moduleName, helper, consumer, expected] of cases) {
    const { dir, git } = makeRepo(t), base = commit(git, 'base');
    writeFile(dir, 'src/lib/formatter.ts', helper);
    writeFile(dir, 'src/components/Widget.tsx', 'import {isFeatureEnabled} from "@/lib/flags";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\n' + `import {format} from "${moduleName}";\nexport async function Widget() { const enabled = await isFeatureEnabled(OTHER_FLAG); ${consumer} }`);
    assert.equal((await evaluate('HTPR-1 [FEATURE] async formatter consumer', base, commit(git, name), dir)).pass, expected, name);
  }
});

test('formatter render coercion and omitted defaults preserve real gates', async (t) => {
  const cases = [
    ['empty array assigned', '@/lib/formatter', 'enabled', 'return enabled;', 'const label = format(enabled); return <div>{label ? [] : null}</div>;', false],
    ['empty array direct', '@/lib/formatter', 'enabled', 'return enabled;', 'return format(enabled) ? [] : null;', false],
    ['nested empty array', '@/lib/formatter', 'enabled', 'return enabled;', 'return format(enabled) ? [[], false, null, <></>] : null;', false],
    ['sparse empty array', '@/lib/formatter', 'enabled', 'return enabled;', 'return format(enabled) ? [, , []] : null;', false],
    ['empty array logical', '@/lib/formatter', 'enabled', 'return enabled;', 'const label = format(enabled); return <div>{label && []}</div>;', false],
    ['empty spread array', '@/lib/formatter', 'enabled', 'return enabled;', 'const label = format(enabled); return <div>{label ? [...[]] : null}</div>;', false],
    ['nested empty spread array', '@/lib/formatter', 'enabled', 'return enabled;', 'return format(enabled) ? [...[[], false, null, <></>]] : null;', false],
    ['empty spread string', '@/lib/formatter', 'enabled', 'return enabled;', 'return format(enabled) ? [...""] : null;', false],
    ['unknown spread cannot prove visibility', '@/lib/formatter', 'enabled', 'return enabled;', 'return format(enabled) ? [...window.items] : null;', false],
    ['rendered spread array control', '@/lib/formatter', 'enabled', 'return enabled;', 'return format(enabled) ? [...[<p key="age">Age</p>]] : null;', true],
    ['rendered spread string control', '@/lib/formatter', 'enabled', 'return enabled;', 'return format(enabled) ? [..."Age"] : null;', true],
    ['rendered string control', '@/lib/formatter', 'enabled', 'return enabled;', 'return format(enabled) ? "Age" : null;', true],
    ['rendered text array control', '@/lib/formatter', 'enabled', 'return enabled;', 'return format(enabled) ? ["Age"] : null;', true],
    ['empty text array', '@/lib/formatter', 'enabled', 'return enabled;', 'return format(enabled) ? [""] : null;', false],
    ['rendered sibling of unknown spread', '@/lib/formatter', 'enabled', 'return enabled;', 'return format(enabled) ? [...window.items, <p key="age">Age</p>] : null;', true],
    ['rendered array control', '@/lib/formatter', 'enabled', 'return enabled;', 'const label = format(enabled); return <div>{label ? [<p key="age">Age</p>] : null}</div>;', true],
    ['omitted optional relative', '../lib/formatter', 'enabled: boolean, ready?: boolean', 'return enabled || ready;', 'return format(enabled) ? <p>Age</p> : null;', true],
    ['omitted optional alias', '@/lib/formatter', 'enabled: boolean, ready?: boolean', 'return ready || enabled;', 'return format(enabled) ? <p>Age</p> : null;', true],
    ['omitted optional mask', '@/lib/formatter', 'enabled: boolean, ready?: boolean', 'return enabled && ready;', 'return format(enabled) ? <p>Age</p> : null;', false],
    ['boolean coerced conditional', '@/lib/formatter', 'enabled', 'return enabled;', 'return !!(format(enabled) ? <p>Age</p> : null);', false],
    ['negated conditional', '@/lib/formatter', 'enabled', 'return enabled;', 'return !(format(enabled) ? <p>Age</p> : null);', false],
    ['boolean coerced conjunction', '@/lib/formatter', 'enabled', 'return enabled;', 'return !!(format(enabled) && <p>Age</p>);', false],
    ['negated condition control', '@/lib/formatter', 'enabled', 'return enabled;', 'return !format(enabled) ? <p>Age</p> : null;', true],
    ['double negated condition control', '@/lib/formatter', 'enabled', 'return enabled;', 'return !!format(enabled) ? <p>Age</p> : null;', true],
    ['omitted truthy default relative', '../lib/formatter', 'enabled, ready = true', 'return ready && enabled;', 'return format(enabled) ? <p>Age</p> : null;', true],
    ['omitted falsy default alias', '@/lib/formatter', 'enabled, ready = false', 'return ready || enabled;', 'return format(enabled) ? <p>Age</p> : null;', true],
    ['omitted truthy default mask', '@/lib/formatter', 'enabled, ready = true', 'return ready || enabled;', 'return format(enabled) ? <p>Age</p> : null;', false],
    ['omitted falsy default mask', '@/lib/formatter', 'enabled, ready = false', 'return ready && enabled;', 'return format(enabled) ? <p>Age</p> : null;', false],
    ['omitted correlated default', '@/lib/formatter', 'enabled, ready = !enabled', 'return ready || enabled;', 'return format(enabled) ? <p>Age</p> : null;', false],
    ['supplied correlated argument', '@/lib/formatter', 'enabled, ready = false', 'return ready || enabled;', 'return format(enabled, !enabled) ? <p>Age</p> : null;', false],
  ];
  for (const [name, moduleName, parameters, helper, consumer, expected] of cases) {
    const { dir, git } = makeRepo(t), base = commit(git, 'base');
    writeFile(dir, 'src/lib/formatter.ts', `export function format(${parameters}) { ${helper} }`);
    writeFile(dir, 'src/components/Widget.tsx', 'import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\n' + `import {format} from "${moduleName}";\nexport function Widget() { const enabled = useFlag(OTHER_FLAG); ${consumer} }`);
    assert.equal((await evaluate('HTPR-1 [FEATURE] formatter rendering', base, commit(git, name), dir)).pass, expected, name);
  }
});

test('server boolean responses remain effective gates', async (t) => {
  const cases = [
    ['distinct boolean values', 'enabled ? true : false', true],
    ['identical boolean values', 'enabled ? true : true', false],
  ];
  for (const [name, response, expected] of cases) {
    const { dir, git } = makeRepo(t), base = commit(git, 'base');
    writeFile(dir, 'src/components/Widget.tsx', 'export async function loadWidget() { return fetch("/api/widget"); }\nexport const Widget = () => <div />;\n');
    writeFile(dir, 'src/app/api/widget/route.ts', 'import {isFeatureEnabled} from "@/lib/flags";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\n' + `export async function GET() { const enabled = await isFeatureEnabled(OTHER_FLAG, 6); return Response.json(${response}); }`);
    assert.equal((await evaluate('HTPR-1 [FEATURE] server boolean gate', base, commit(git, name), dir)).pass, expected, name);
  }
});

test('formatter consumer defaults do not constrain independent rendering', async (t) => {
  const cases = [
    ['relative direct conditional', '../lib/formatter', 'return format(enabled) ? <p>Age</p> : null;', true],
    ['alias direct conditional', '@/lib/formatter', 'return format(enabled) ? <p>Age</p> : null;', true],
    ['assigned early return', '@/lib/formatter', 'const label = format(enabled); if (!label) return null; return <p>Age</p>;', true],
    ['ignored formatter remains refused', '@/lib/formatter', 'format(enabled); return <p>Age</p>;', false],
  ];
  for (const [name, moduleName, body, expected] of cases) {
    const { dir, git } = makeRepo(t), base = commit(git, 'base');
    writeFile(dir, 'src/lib/formatter.ts', 'export function format(enabled) { return enabled; }');
    writeFile(dir, 'src/components/Widget.tsx', 'import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\n' + `import {format} from "${moduleName}";\nconst defaults = {};\nexport function Widget(props = defaults) { const enabled = useFlag(OTHER_FLAG); ${body} }`);
    assert.equal((await evaluate('HTPR-1 [FEATURE] formatter consumer defaults', base, commit(git, name), dir)).pass, expected, name);
  }
});

test('formatter comparisons, boolean children and action exits require observable behavior', async (t) => {
  const cases = [
    ['compound strict comparison', 'if ((enabled && "Age") === true) return "Age"; return null;', 'const label = format(enabled); if (!label) return null; return <p>Age</p>;', false],
    ['compound loose comparison', 'return (enabled && "Age") == true;', 'return format(enabled) ? <p>Age</p> : null;', false],
    ['boolean comparison control', 'return enabled === true;', 'return format(enabled) ? <p>Age</p> : null;', true],
    ['negated comparison control', 'return !enabled === false;', 'return format(enabled) ? <p>Age</p> : null;', true],
    ['logical boolean child', 'return enabled;', 'const label = format(enabled); return <div>{label ? [true && true] : null}</div>;', false],
    ['conditional boolean child', 'return enabled;', 'return format(enabled) ? [ready ? true : false] : null;', false],
    ['masked logical text child', 'return enabled;', 'return format(enabled) ? [true || "Age"] : null;', false],
    ['visible zero child', 'return enabled;', 'return <div>{format(enabled) ? 0 : null}</div>;', true],
    ['visible zero return', 'return enabled;', 'return format(enabled) ? 0 : null;', true],
    ['nested action exit', 'return enabled;', 'const send = () => { if (ready) { if (!format(enabled)) return "disabled"; doWork(); } }; return <button onClick={send}/>;', true],
    ['boolean negation child', 'return enabled;', 'const label = format(enabled); return <div>{label ? [!true] : null}</div>;', false],
    ['boolean comparison child', 'return enabled;', 'return format(enabled) ? [1 === 1] : null;', false],
    ['void child', 'return enabled;', 'return format(enabled) ? [void 0] : null;', false],
    ['visible boolean sibling', 'return enabled;', 'return format(enabled) ? [!true, <p key="age">Age</p>] : null;', true],
    ['direct action exit', 'return enabled;', 'const send = () => { if (!format(enabled)) return "disabled"; doWork(); }; return <button onClick={send}/>;', true],
    ['assigned action exit', 'return enabled;', 'const send = () => { const label = format(enabled); if (!label) return; doWork(); }; return <button onClick={send}/>;', true],
    ['action null exit', 'return enabled;', 'const send = () => { if (!format(enabled)) return null; doWork(); }; return <button onClick={send}/>;', true],
    ['ignored action return', 'return enabled;', 'const send = () => { const label = format(enabled); if (!label) return null; return <p>Age</p>; }; return <button onClick={send}/>;', false],
    ['unreachable action effect', 'return enabled;', 'const send = () => { if (!format(enabled)) return null; return; doWork(); }; return <button onClick={send}/>;', false],
    ['ignored formatter', 'return enabled;', 'format(enabled); return <p>Age</p>;', false],
  ];
  for (const [name, helper, consumer, expected] of cases) {
    const { dir, git } = makeRepo(t), base = commit(git, 'base');
    writeFile(dir, 'src/lib/formatter.ts', `export function format(enabled) { ${helper} }`);
    writeFile(dir, 'src/components/Widget.tsx', 'import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\n' + `import {format} from "@/lib/formatter";\nexport function Widget() { const enabled = useFlag(OTHER_FLAG); ${consumer} }`);
    assert.equal((await evaluate('HTPR-1 [FEATURE] observable formatter gate', base, commit(git, name), dir)).pass, expected, name);
  }
});


test('formatter consumer boundaries preserve action and JavaScript rendering gates', async (t) => {
  const cases = [
    ['equivalent text rendering', 'tsx', 'export function Widget() { const enabled = useFlag(OTHER_FLAG); return format(enabled) ? ["Age"] : "Age"; }', false],
    ['equivalent early text rendering', 'tsx', 'export function Widget() { const enabled = useFlag(OTHER_FLAG); if (format(enabled)) return ["Age"]; return "Age"; }', false],
    ['JavaScript text component', 'js', 'export function Widget() { const enabled = useFlag(OTHER_FLAG); return format(enabled) ? ["Age"] : null; }', true],
    ['JavaScript arrow component', 'js', 'export const Widget = () => { const enabled = useFlag(OTHER_FLAG); return format(enabled) ? ["Age"] : null; };', true],
    ['exported TSX action', 'tsx', 'export async function send() { const enabled = useFlag(OTHER_FLAG); if (format(enabled)) await doWork(); }', true],
    ['discarded action text', 'tsx', 'export function send() { const enabled = useFlag(OTHER_FLAG); return format(enabled) ? ["Age"] : null; }', false],
    ['empty template text', 'tsx', 'export function Widget() { const enabled = useFlag(OTHER_FLAG); const label = format(enabled); return label ? `` : null; }', false],
    ['empty interpolated template child', 'tsx', 'export function Widget() { const enabled = useFlag(OTHER_FLAG); const label = format(enabled); return <div>{label ? [`${""}`] : null}</div>; }', false],
    ['unknown interpolated template child', 'tsx', 'export function Widget() { const enabled = useFlag(OTHER_FLAG); return format(enabled) ? [`${text}`] : null; }', false],
    ['visible interpolated template child', 'tsx', 'export function Widget() { const enabled = useFlag(OTHER_FLAG); const label = format(enabled); return <div>{label ? [`Age ${days}`] : null}</div>; }', true],
    ['JavaScript ignored formatter', 'js', 'export function Widget() { const enabled = useFlag(OTHER_FLAG); format(enabled); return "Age"; }', false],
  ];
  for (const [name, extension, source, expected] of cases) {
    const { dir, git } = makeRepo(t), base = commit(git, 'base');
    writeFile(dir, 'src/lib/formatter.ts', 'export function format(enabled) { return enabled; }');
    writeFile(dir, `src/components/Widget.${extension}`, 'import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\nimport {format} from "@/lib/formatter";\n' + source);
    assert.equal((await evaluate('HTPR-1 [FEATURE] formatter consumer boundary', base, commit(git, name), dir)).pass, expected, name);
  }
});

test('imported formatter server boolean responses remain effective gates', async (t) => {
  const cases = [
    ['relative distinct booleans', '../../../lib/formatter', 'format(enabled) ? true : false', true],
    ['aliased distinct booleans', '@/lib/formatter', 'format(enabled) ? true : false', true],
    ['invariant boolean response', '@/lib/formatter', 'format(enabled) ? true : true', false],
    ['assigned distinct booleans', '@/lib/formatter', 'label ? true : false', true, 'const label = format(enabled);'],
    ['assigned invariant booleans', '@/lib/formatter', 'label ? true : true', false, 'const label = format(enabled);'],
    ['ignored server formatter', '@/lib/formatter', 'false', false, 'format(enabled);'],
  ];
  for (const [name, moduleName, response, expected, setup = ''] of cases) {
    const { dir, git } = makeRepo(t), base = commit(git, 'base');
    writeFile(dir, 'src/lib/formatter.ts', 'export function format(enabled) { return enabled; }');
    writeFile(dir, 'src/components/Widget.tsx', 'export async function loadWidget() { return fetch("/api/widget"); }\nexport const Widget = () => <div />;\n');
    writeFile(dir, 'src/app/api/widget/route.ts', 'import {isFeatureEnabled} from "@/lib/flags";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\n' + `import {format} from "${moduleName}";\nexport async function GET() { const enabled = await isFeatureEnabled(OTHER_FLAG, 6); ${setup} return Response.json(${response}); }`);
    assert.equal((await evaluate('HTPR-1 [FEATURE] imported server boolean gate', base, commit(git, name), dir)).pass, expected, name);
  }
});

test('formatter consumers reject invisible nullish children and unreachable logical aliases', async (t) => {
  const cases = [
    ['nullish boolean child', 'return <div>{label ? [null ?? true] : null}</div>;', false],
    ['false nullish text child', 'return label ? [false ?? "Age"] : null;', false],
    ['true nullish text child', 'return label ? [true ?? "Age"] : null;', false],
    ['undefined nullish boolean child', 'return label ? [undefined ?? false] : null;', false],
    ['nullish text control', 'return label ? [null ?? "Age"] : null;', true],
    ['nullish zero control', 'return label ? [0 ?? true] : null;', true],
    ['nullish empty string', 'return label ? ["" ?? "Age"] : null;', false],
    ['truthy array alias', 'const empty = []; return empty || <div>{label && <p>Age</p>}</div>;', false],
    ['truthy array literal', 'return [] || <div>{label && <p>Age</p>}</div>;', false],
    ['truthy object alias', 'const empty = {}; return empty || <div>{label && <p>Age</p>}</div>;', false],
    ['transitive truthy alias', 'const empty = []; const mask = empty; return mask || <div>{label && <p>Age</p>}</div>;', false],
    ['falsy conjunction alias', 'const ready = false; return ready && <div>{label && <p>Age</p>}</div>;', false],
    ['reachable disjunction control', 'const ready = false; return ready || <div>{label && <p>Age</p>}</div>;', true],
    ['reachable conjunction control', 'const ready = []; return ready && <div>{label && <p>Age</p>}</div>;', true],
  ];
  for (const [name, consumer, expected] of cases) {
    const { dir, git } = makeRepo(t), base = commit(git, 'base');
    writeFile(dir, 'src/lib/formatter.ts', 'export function format(enabled) { return enabled; }');
    writeFile(dir, 'src/components/Widget.tsx', 'import {useFlag} from "@/hooks/useFlag";\nimport {OTHER_FLAG} from "@/lib/flags/keys";\nimport {format} from "@/lib/formatter";\n' + `export function Widget() { const enabled = useFlag(OTHER_FLAG); const label = format(enabled); ${consumer} }`);
    assert.equal((await evaluate('HTPR-1 [FEATURE] reachable formatter output', base, commit(git, name), dir)).pass, expected, name);
  }
});

test("new money flags must start Owner and QA while existing flags keep their modes", async (t) => {
  for (const mode of ["OFF", "OWNER_AND_QA", "OWNER_ONLY", "EVERYONE"]) {
    const { dir, git } = makeRepo(t);
    perFlagLayout(dir);
    const existing = "src/lib/flags/definitions/htpr-1-other.ts";
    writeFile(dir, existing, `export const OTHER_FLAG = "htpr-1-other";
export default { key: OTHER_FLAG, kind: "bugfix", defaultMode: "OWNER_AND_QA", shippedOn: "2026-10-11", description: "Existing money flag", releaseRisk: { risk: "small", reason: "Existing billing behavior", highRisk: "money" } } as const;`);
    writeFile(dir, "src/lib/flags/keys.ts", `export { OTHER_FLAG } from "./definitions/htpr-1-other";`);
    const base = commit(git, "existing money flag");
    writeFile(dir, "src/lib/flags/definitions/htpr-2-new.ts", `export const NEW_FLAG = "htpr-2-new";
export default { key: NEW_FLAG, kind: "bugfix", defaultMode: "${mode}", shippedOn: "2026-10-28", description: "New money flag", releaseRisk: { risk: "small", reason: "Paid reporting", highRisk: "money" } } as const;`);
    const head = commit(git, "new money flag");
    const result = await evaluate("HTPR-2 [BUGFIX] money fixture", base, head, dir);
    assert.equal(result.pass, mode === "OWNER_AND_QA", result.reason);
    if (mode !== "OWNER_AND_QA") assert.match(result.reason, /new money flag htpr-2-new must set defaultMode: "OWNER_AND_QA"/);
  }
});
