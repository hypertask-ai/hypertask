const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync, execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const base = "fdb5e4e4c84d906dc061b51811b5a80179aa5192";
const cli = process.env.HTPR_6923_CLI_ROOT || "/home/valentin/projects/hypertask-cli-zig";
const legacyHashes = {
  update: "fd86e539628986d289b1a2bcfa7356d99d9fcfa5ac56b6475af1e91ad28c829b",
  move: "513aeab45ad20296fe90f8685e6010ca77527ec998a20bd6c9dd00f3133b3381",
};
const lifecycleHashes = {
  "create": "ac3bf10430d38d203068e2c6f94588275b5f2f4a778cf4163884f8e8a62a31b8",
  "global": "e0fc2c38b61e70aaa8a80a106b2fb52d55b0ddac095c91dfd8e1fe5a6cc8df6e",
  "archive": "c37913de3aaa395f5a45ce66155863ad6670d21f03c2c09037c747dad4e54cb2"
};
function lifecycleLegacySources() {
  const unwrap = (file) => read(file)
    .replace('import { withTaskWriteFlag } from "@/lib/api/task-writes/route";\n', "")
    .replace(/export default withTaskWriteFlag\([\s\S]*?\n\);/, "export default handler;");
  let create = unwrap("src/pages/api/tasks/create.ts")
    .replace('import { createFullScreenTaskAndReturn } from "@/lib/api/task-writes/create-fullscreen";\n', "");
  // Restore only the legacy blank-line padding removed from the moved file.
  const fullscreenPadding = { 17: 16, 35: 12, 62: 8, 68: 4 };
  const fullscreen = read("src/lib/api/task-writes/create-fullscreen.ts").split("\n")
    .map((line, index) => {
      if (!fullscreenPadding[index]) return line;
      assert.equal(line, "", "only blank legacy padding is normalized");
      return " ".repeat(fullscreenPadding[index]);
    })
    .join("\n").split("export const createFullScreenTaskAndReturn")[1];
  create = create.replace('export { createFullScreenTaskAndReturn } from "@/lib/api/task-writes/create-fullscreen";\n', "export const createFullScreenTaskAndReturn" + fullscreen);
  const effects = read("src/lib/api/task-writes/create-global-effects.ts");
  const types = effects.slice(effects.indexOf("type TaskCreatedGlobally"), effects.indexOf("function schedulePostCreateWork("));
  const helpers = effects.slice(effects.indexOf("function schedulePostCreateWork("), effects.indexOf("\nexport {"))
    .replaceAll('"@/pages/api/queues/FAST/generateSummary"', '"../queues/FAST/generateSummary"');
  let global = unwrap("src/pages/api/tasks/createGlobally.ts")
    .replace(/^import \{ schedulePostCreateWork[^\n]+\n/m, "")
    .replace('import { IAgent, ILabel, IUser } from "@/models/model";\n', 'import { IAgent, IEstimate, ILabel, IPriority, ITask, IUser } from "@/models/model";\nimport { waitUntil } from "@vercel/functions";\nimport {\n  ITaskAssignedActivity,\n  ITaskEstimateActivity,\n  ITaskPriorityActivity,\n} from "@/models/ActivityModels.ts";\n')
    .replace('import { getSessionUser }', 'import { assignmentActivityUserSelect } from "@/utils/controllers/activities/createAssignedActivity";\nimport { getSessionUser }')
    .replace("const handler: NextApiHandler", types.replace(/\n$/, "") + "const handler: NextApiHandler")
    .replace("\nexport default handler;", helpers + "\nexport default handler;");
  return { create, global, archive: unwrap("src/pages/api/tasks/(un)archive.ts") };
}
function lifecycle() {
  const sources = lifecycleLegacySources();
  for (const [kind, source] of Object.entries(sources)) {
    assert.equal(crypto.createHash("sha256").update(source).digest("hex"), lifecycleHashes[kind], kind + " legacy bytes");
  }
  const route = read("src/lib/api/task-writes/route.ts");
  assert.ok(route.includes("HTPR_6923_APP_ROUTER_WRITES_FLAG"));
  assert.ok(route.includes("if (!enabled || !session || !headers) return legacy(req, res)"));
  for (const [page, handler] of [["create", "create"], ["createGlobally", "create-global"], ["(un)archive", "archive"]]) {
    assert.ok(read(`src/pages/api/tasks/${page}.ts`).includes(`withTaskWriteFlag(handler, "POST"`));
    assert.ok(read(`src/pages/api/tasks/${page}.ts`).includes(`/task-writes/${handler}`));
    assert.ok(!fs.existsSync(path.join(root, `src/app/api/tasks/${page}/route.ts`)), "no URL twin");
  }
  assert.throws(() => assert.equal(crypto.createHash("sha256").update(sources.create + "changed").digest("hex"), lifecycleHashes.create), "pin mutation control");
  console.log("lifecycle verification passed");
}
const slice3Routes = {
  "recoverTask": {
    "module": "recover",
    "method": "POST",
    "hash": "345c9a672ef944ce46895d185d87f64e7defd17265a08725e8f78dea72ac3d29"
  },
  "deleteTask": {
    "module": "delete",
    "method": "DELETE",
    "hash": "d45c197575d3bb033423577d0decdc0f92028a9ee3123a1da236a97d9d17b02e"
  },
  "setDueDate": {
    "module": "due-date",
    "method": "POST",
    "hash": "4857ca934023b79b4065cc3e7dd8ef058f882e2a18062600b35302e842ee525f"
  },
  "setStartDate": {
    "module": "start-date",
    "method": "POST",
    "hash": "d07cc8fdcb98c639e23482d4c16523bf77873442ed8571e00b577928e68cea76"
  },
  "setRecurrence": {
    "module": "recurrence",
    "method": "POST",
    "hash": "3217ca8cb57633e0f2cc5f86d88f5d6f5fa330fc593faf718ef12a4a601810e6"
  },
  "addParent": {
    "module": "add-parent",
    "method": "POST",
    "hash": "e6180619e7f83250629a9b4094b91ce376ab0f29545012955ca20569b21cbfec"
  },
  "removeParent": {
    "module": "remove-parent",
    "method": "POST",
    "hash": "3758ae47ad5c10b47c43b302436058d8113101587b1bf9a6b1e002c9c022853b"
  },
  "addRelations": {
    "module": "add-relations",
    "method": "POST",
    "hash": "b4dabfb101a497d43d9b1f78500dcf2dc1c820b6ec51cd0b3192e3680d968c0c"
  },
  "removeRelation": {
    "module": "remove-relation",
    "method": "POST",
    "hash": "61f845062e293bbaccbbe2a49bc842dcff05c3e12b15e48faa51514a64aff720"
  },
  "waiting-on": {
    "module": "waiting-on",
    "method": "POST",
    "hash": "9c3e0b9650c507251cbc91c7acf350029753e86b75382d200dad6b965c11c7ff"
  },
  "reactToDescription": {
    "module": "description-reaction",
    "method": "POST",
    "hash": "778e00b93cd8ec2a0744b137a32228675ec8494a569a47f10660ad61587bbdfe"
  },
  "linkPullRequest": {
    "module": "link-pull-request",
    "method": "POST",
    "hash": "d81cc3abc8687818dcd24699c629d2a993c21488c4093ffe722ef2c54404ddb3"
  }
};
function slice3LegacySources() {
  return Object.fromEntries(Object.keys(slice3Routes).map((name) => {
    let source = read(`src/pages/api/tasks/${name}.ts`)
      .replace('import { withTaskWriteFlag } from "@/lib/api/task-writes/route";\n', "")
      .replace(/\n\nexport default withTaskWriteFlag[\s\S]*$/, "");
    if (name === "recoverTask") source = source.replace(" async function handler(", "export default  async function handler(") + "\n";
    else if (name === "deleteTask") source = source.replace("async function handler(", "export default async function handler(") + "\n";
    else if (name === "linkPullRequest") source = source.replace("const handler = createLinkPullRequestHandler(", "export default createLinkPullRequestHandler(") + "\n";
    else source += "\n\nexport default handler;" + (name === "reactToDescription" ? "" : "\n");
    return [name, source];
  }));
}
function slice3() {
  const sources = slice3LegacySources();
  for (const [name, { module, method, hash }] of Object.entries(slice3Routes)) {
    assert.equal(crypto.createHash("sha256").update(sources[name]).digest("hex"), hash, name + " legacy bytes");
    const page = read(`src/pages/api/tasks/${name}.ts`);
    assert.ok(page.includes(`withTaskWriteFlag(handler, "${method}"`));
    assert.ok(page.includes(`/task-writes/${module}`));
    assert.ok(!fs.existsSync(path.join(root, `src/app/api/tasks/${name}/route.ts`)), "no URL twin");
    assert.throws(() => assert.equal(crypto.createHash("sha256").update(sources[name] + "changed").digest("hex"), hash), "pin mutation control");
  }
  const route = read("src/lib/api/task-writes/route.ts");
  assert.ok(route.includes("HTPR_6923_APP_ROUTER_WRITES_FLAG"));
  assert.ok(route.includes("if (!enabled || !session || !headers) return legacy(req, res)"));
  assert.ok(read("src/pages/api/tasks/linkPullRequest.ts").includes("export function createLinkPullRequestHandler"), "retain exported factory and URL pending external review");
  // Relocated diagnostic strings are not HTTP callers; exclude only those logs.
  const corpora = [filesAt(root, "src"), filesAt(cli, "."), filesAt(root, "e2e")]
    .map(corpus => corpus.map(row => ({ ...row, text: row.text.replace(/console\.(?:warn|error)\("\/api\/tasks\/linkPullRequest[^\n]*/g, "") })));
  for (const corpus of corpora) assert.equal(callerFiles("tasks/linkPullRequest", corpus).length, 0, "PR URL retained despite zero tracked callers");
  assert.throws(() => assert.equal(callerFiles("tasks/linkPullRequest", [{ file: "fixture.ts", text: 'fetch("/api/tasks/linkPullRequest")' }]).length, 0), "absence control detects a live caller");
  console.log("slice3 structural verification passed");
}
const deadCandidates = [
  "tasks/getAll", "tasks/linkPullRequest", "projects/detail", "projects/views/sync-view",
  "section/getAll", "section/getByTaskId", "notifications/mute",
];
const baselineDiagnostics = [
  "src/components/Modals/Sheets/AppSheet.tsx(2,17): error TS2305: Module '\"react-modal-sheet\"' has no exported member 'useScrollPosition'.",
  "src/components/Modals/Sheets/AppSheet.tsx(149,7): error TS2322: Type 'SheetDetent' is not assignable to type 'SheetDetent | undefined'.",
  "src/components/Modals/Sheets/AppSheet.tsx(173,13): error TS2322: Type '{ children: ReactNode; disableScroll: boolean; disableDrag: boolean; scrollClassName: string; }' is not assignable to type 'IntrinsicAttributes & Omit<CommonProps, \"drag\" | \"onDrag\" | \"onDragEnd\" | \"onDragStart\" | \"dragConstraints\" | \"dragElastic\" | \"dragMomentum\"> & { ...; } & RefAttributes<...>'.",
  "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentsContainer.tsx(39,49): error TS7006: Parameter 'member' implicitly has an 'any' type.",
  "src/hooks/MultiPages/AIChat/aiChatSend.ts(210,75): error TS7006: Parameter 'section' implicitly has an 'any' type.",
  "src/hooks/MultiPages/AIChat/aiChatSend.ts(212,56): error TS7006: Parameter 'task' implicitly has an 'any' type.",
  "src/hooks/MultiPages/AIChat/aiChatSend.ts(219,27): error TS7006: Parameter 'taskLabel' implicitly has an 'any' type.",
  "src/hooks/MultiPages/AIChat/aiChatSend.ts(220,30): error TS7006: Parameter 'label' implicitly has an 'any' type.",
  "src/hooks/MultiPages/Tasks/useTagsModal.ts(53,56): error TS7006: Parameter 'id' implicitly has an 'any' type.",
  "src/hooks/MultiPages/useAddDeleteTaskInBoards.tsx(126,62): error TS7006: Parameter 'sec' implicitly has an 'any' type.",
  "src/lib/mcp-server/streamable-http.ts(13,31): error TS2339: Property 'http' does not exist on type 'RequestHandlerExtra<ServerRequest, ServerNotification>'.",
  "src/lib/mcp-server/streamable-http.ts(19,41): error TS2339: Property 'mcpReq' does not exist on type 'RequestHandlerExtra<ServerRequest, ServerNotification>'.",
  "src/lib/mcp-server/streamable-http.ts(28,36): error TS2353: Object literal may only specify known properties, and 'verboseLogs' does not exist in type 'ServerOptions'.",
  "src/lib/redis.ts(45,26): error TS2769: No overload matches this call.",
  "src/lib/state.tsx(8,3): error TS2305: Module '\"jotai\"' has no exported member 'useAtomValueRawSync'.",
];
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
function run(command, args, name) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 600000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  const output = result.stdout + result.stderr;
  fs.mkdirSync(path.join(root, ".unlazy/htpr-6923"), { recursive: true });
  fs.writeFileSync(path.join(root, `.unlazy/htpr-6923/${name}.log`), output);
  console.log(output);
  return { result, output };
}
function filesAt(directory, prefix) {
  return execFileSync("git", ["ls-files", "-z", "--", prefix], { cwd: directory, encoding: "utf8" })
    .split("\0").filter((file) => file && /\.(?:[cm]?js|tsx?|zig|py|json|sh|html|md)$/.test(file))
    .map((file) => ({ file, text: fs.readFileSync(path.join(directory, file), "utf8") }));
}
function callerFiles(endpoint, corpus) {
  const escaped = endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Includes shortened URLs and source imports conservatively, but not prefix siblings.
  const pattern = new RegExp(`/${escaped}(?=[?\\#\\s'\"\x60)]|$)`);
  return corpus.filter(({ file, text }) => file !== `src/pages/api/${endpoint}.ts` && pattern.test(text));
}
function inventory() {
  const routes = git("ls-files", "src/pages/api/tasks", "src/pages/api/projects", "src/pages/api/section", "src/pages/api/notifications")
    .split("\n").filter((file) => file.endsWith(".ts"));
  const corpora = [filesAt(root, "src"), filesAt(cli, "."), filesAt(root, "e2e")];
  return routes.map((file) => {
    const endpoint = file.replace("src/pages/api/", "").replace(/\.ts$/, "");
    return { file, endpoint, callers: corpora.map((corpus) => callerFiles(endpoint, corpus).length) };
  });
}
function plan() {
  const doc = read("docs/htpr-6509-slices.md").split("## HTPR-6923: remaining Pages Router migration")[1];
  assert.ok(doc, "ticket-specific plan exists");
  const rows = [...doc.matchAll(/^\| `src\/pages\/api\/([^`]+\.ts)` \| (\d+) \| ([^|]+) \| (\d+) \/ (\d+) \/ (\d+) \|$/gm)]
    .map((match) => ({ file: `src/pages/api/${match[1]}`, slice: Number(match[2]), callers: match.slice(4, 7).map(Number) }));
  const measured = inventory();
  assert.deepEqual(rows.map(({ file }) => file).sort(), measured.map(({ file }) => file).sort(), "every route has exactly one primary slice");
  assert.ok(rows.every(({ slice }) => slice >= 1 && slice <= 12));
  for (const row of rows) assert.deepEqual(row.callers, measured.find(({ file }) => file === row.file).callers, row.file);
  for (const endpoint of deadCandidates) {
    assert.deepEqual(measured.find((row) => row.endpoint === endpoint).callers, [0, 0, 0], endpoint);
    assert.ok(doc.includes(`\`/api/${endpoint}\``), "every candidate has a disposition");
  }
  assert.equal(callerFiles("tasks/single", [{ file: "fixture.ts", text: 'fetch("/api/tasks/single?id=42")' }]).length, 1, "positive absence-check control");
  assert.throws(() => assert.equal(callerFiles("tasks/getAll", [{ file: "fixture.ts", text: 'fetch("/api/tasks/getAll")' }]).length, 0));
  assert.equal(callerFiles("tasks/create", [{ file: "fixture.ts", text: 'fetch("/api/tasks/createGlobally")' }]).length, 0, "prefix sibling is not a caller");
  console.log(`slice plan verified: ${rows.length} routes, ${new Set(rows.map(({ slice }) => slice)).size} primary groups, 7 zero-caller candidates; CLI ${execFileSync("git", ["rev-parse", "HEAD"], { cwd: cli, encoding: "utf8" }).trim()}`);
}
async function flag() {
  const { load } = require("./task-route-loader.cjs");
  const flags = load("src/lib/flags.ts", {
    "@/lib/prisma": { default: {
      featureFlag: { findUnique: async () => null },
      user: { findUnique: async ({ where }) => ({ email: where.id === 6 ? "valentin.yeo@gmail.com" : "valentin@hypertask.ai" }) },
    } },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => null },
    "@/lib/agentRuns/model": { AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG: "test" },
  });
  const key = flags.HTPR_6923_APP_ROUTER_WRITES_FLAG;
  assert.equal(key, "htpr-6923-app-router-writes");
  assert.ok(flags.FEATURE_FLAG_KEYS.includes(key));
  assert.deepEqual(await Promise.all([6, 985, 2343].map((id) => flags.isFeatureEnabled(key, id))), [true, true, false]);
  const { result } = run("npm", ["run", "test:file", "--", "tests/feature-flag-gate.test.cjs", "tests/feature-flags.test.cjs"], "flag");
  assert.equal(result.status, 0);
  console.log("flag verification passed");
}
function regression() {
  const files = [
    "tests/htpr-6923-task-writes.test.cjs", "tests/task-single-auth.test.cjs", "tests/task-move-pages-runtime.test.cjs",
    "tests/task-move-error-message.test.cjs", "tests/task-write-access-choke-points.test.cjs",
    "tests/task-write-controller-auth.test.cjs", "tests/task-write-access-gate.test.cjs",
    "tests/task-route-consolidation.test.cjs", "tests/htpr-6478-mcp-services.test.cjs", "tests/htpr-6478-permissions.test.cjs",
    "tests/ui-patterns.test.cjs",
  ];
  const { result } = run("npm", ["run", "test:file", "--", ...files], "regression");
  assert.equal(result.status, 0);
  console.log("regression verification passed");
}
function quality() {
  const lint = run("npm", ["run", "lint"], "lint");
  assert.equal(lint.result.status, 0, "full lint must pass");
  const tsc = run("npx", ["tsc", "--noEmit", "--pretty", "false"], "tsc");
  assert.equal(tsc.result.stderr, "");
  const diagnostics = tsc.output.split(/\r?\n/).filter((line) => line.includes("error TS"));
  assert.deepEqual(diagnostics, baselineDiagnostics, "exact independently captured baseline; no diagnostics added or silently removed");
  assert.ok([1, 2].includes(tsc.result.status));
  git("diff", "--check");
  console.log(`quality verification passed: full lint clean; full tsc ${diagnostics.length} baseline diagnostics, no new diagnostics (exit ${tsc.result.status})`);
}
function commit() {
  assert.equal(git("branch", "--show-current"), "htpr-6923-pages-router-writes");
  assert.match(git("log", "-1", "--format=%s"), /^HTPR-6923 /);
  assert.equal(git("log", "-1", "--format=%an <%ae>"), "Dev 1 (HT) <ht-bug-fixer@agents.hypertask.ai>");
  assert.equal(git("rev-parse", "HEAD^"), base);
  const allowed = new Set([
    "docs/htpr-6509-slices.md", "src/lib/flags.ts", "src/lib/api/task-writes/route.ts", "src/lib/api/task-writes/update.ts",
    "src/lib/api/task-writes/move.ts", "src/pages/api/tasks/single.ts", "src/pages/api/tasks/moveTask.ts",
    "tests/task-single-auth.test.cjs", "tests/feature-flags.test.cjs", "tests/htpr-6923-task-writes.test.cjs", "tests/htpr-6923-verify.cjs",
  ]);
  const changed = git("diff", "--name-only", base, "HEAD").split("\n");
  assert.deepEqual(changed.sort(), [...allowed].sort(), "no sibling scope or unrelated changes");
  const numstat = git("diff", "--numstat", base, "HEAD").split("\n");
  const productionLines = numstat.filter((line) => !line.split("\t")[2].startsWith("tests/"))
    .reduce((sum, line) => sum + Number(line.split("\t")[0]) + Number(line.split("\t")[1]), 0);
  assert.ok(productionLines < 800, `production/doc changed lines ${productionLines}`);
  assert.equal(git("diff", "--name-only"), "", "no tracked changes after commit");
  assert.equal(git("diff", "--cached", "--name-only"), "");
  assert.deepEqual(git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean), ["GATES.md"], "only the local proof ledger is untracked");
  for (const [kind, file] of Object.entries({ update: "src/pages/api/tasks/single.ts", move: "src/pages/api/tasks/moveTask.ts" })) {
    const source = read(file).replace('import { withTaskWriteFlag } from "@/lib/api/task-writes/route";\n', "")
      .replace(/export default withTaskWriteFlag\([\s\S]*$/, "export default handler;\n");
    assert.equal(crypto.createHash("sha256").update(source).digest("hex"), legacyHashes[kind]);
  }
  assert.throws(() => assert.ok(allowed.has("src/lib/mcp/auth.ts")), "scope control rejects a sibling file");
  console.log(`local commit verified: ${git("rev-parse", "HEAD")}; ${productionLines} production/doc changed lines; only GATES.md is local`);
}
module.exports = { legacyHashes, lifecycleHashes, lifecycleLegacySources, slice3Routes, slice3LegacySources, inventory, callerFiles };
if (require.main === module) {
  const commands = { plan, flag, regression, quality, commit, lifecycle, slice3 };
  assert.ok(commands[process.argv[2]], "known verification mode required");
  Promise.resolve(commands[process.argv[2]]()).catch((error) => { console.error(error); process.exitCode = 1; });
}
