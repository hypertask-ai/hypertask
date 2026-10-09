const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const emailFile = "src/utils/controllers/notifications/agentFirstTaskEmail.ts";
const templateFile = "src/utils/controllers/notifications/emailTemplates.ts";
const boardFile = "src/app/[...boardURL]/LandingPage.tsx";
const flag = "htpr-7028-first-task-email";
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function load(file, stubs = {}) {
  const javascript = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", javascript)(mod, mod.exports, (request) => {
    if (Object.hasOwn(stubs, request)) return stubs[request];
    const resolved = request.startsWith("@/")
      ? `src/${request.slice(2)}`
      : request.startsWith(".") ? path.join(path.dirname(file), request) : null;
    if (resolved) return load(`${resolved}.ts`, stubs);
    throw new Error(`Unstubbed external dependency: ${request}`);
  });
  return mod.exports;
}

function templates() {
  return load(templateFile, {
    "./commentPreview": { commentPreview: () => "" },
    "./mentionText": { mentionQuoteHtml: () => "" },
  });
}

const before = { id: 42, projectId: 15, uniqueIndex: 7028, title: "Review the release", sectionId: 1, section: "Doing", status: "Normal" };
const after = { ...before, sectionId: 2, section: "Done" };

function fixture(options = {}) {
  const calls = { scheduled: [], sent: [], flags: [], locks: [], reads: 0 };
  const store = options.store ?? [];
  let lockTail = Promise.resolve();
  const prisma = {
    section: { findMany: async () => {
      calls.reads++;
      return options.sections ?? [
        { id: 1, section_title: "Doing", isDone: false },
        { id: 2, section_title: "Done", isDone: true },
        { id: 3, section_title: "Shipped", isDone: true },
      ];
    } },
    agent: { findFirst: async ({ where }) => {
      assert.equal(where.userId, options.userId ?? 985);
      return options.missingAgent ? null : { displayName: "Release agent", userId: options.agentOwner ?? where.userId };
    } },
    project: { findUnique: async () => ({
      ownerId: options.boardOwner ?? 985, title: "Release board", name: "release-board",
      owner: { email: options.noEmail ? null : "qa@example.invalid" },
    }) },
    $transaction: async (callback) => {
      let release;
      let locked = false;
      const previous = lockTail;
      lockTail = new Promise((resolve) => { release = resolve; });
      const tx = {
        $executeRaw: async (strings, userId) => {
          assert.match(strings.join("?"), /pg_advisory_xact_lock\(7028::int, \?::int\)/);
          calls.locks.push(userId);
          await previous;
          locked = true;
        },
        logs: {
          findFirst: async ({ where }) => {
            assert.equal(locked, true, "durable marker read must hold the user lock");
            return store.find((row) => row.LoggedById === where.LoggedById && row.log === where.log) ?? null;
          },
          create: async ({ data }) => {
            assert.equal(locked, true, "durable marker insert must hold the user lock");
            if (options.markerFailure) throw new Error("Storage unavailable");
            store.push(data);
            return data;
          },
        },
      };
      try { return await callback(tx); } finally { release(); }
    },
  };
  const { scheduleAgentFirstTaskEmail } = load(emailFile, {
    "@vercel/functions": { waitUntil: (work) => {
      calls.scheduled.push(work);
      if (options.schedulerFailure) throw new Error("No request context");
    } },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/flags": {
      HTPR_7028_FIRST_TASK_EMAIL_FLAG: flag,
      isFeatureEnabled: async (key, userId) => {
        calls.flags.push({ key, userId });
        if (options.flagFailure) throw new Error("Flag read failed");
        return options.enabled !== false;
      },
    },
    "@/lib/email/sendEmail": { sendEmail: async (input) => {
      calls.sent.push(input);
      if (options.sendFailure) throw new Error("Provider failed");
      await options.sendBarrier;
      return { id: "local-email" };
    } },
    "@/lib/email/unsubscribe": { unsubscribeHeaders: () => ({ "List-Unsubscribe": "<https://example.invalid/unsubscribe>" }) },
    "./emailTemplates": templates(),
  });
  const schedule = (oldTask = before, task = after, userId = options.userId ?? 985, agentId = "authenticated-agent") =>
    scheduleAgentFirstTaskEmail(oldTask, task, userId, agentId);
  const settle = () => Promise.all(calls.scheduled);
  return { schedule, settle, calls, store };
}

test("agent completion sends once to the board and agent owner", async () => {
  const f = fixture();
  assert.equal(f.schedule(), undefined);
  await f.settle();
  assert.equal(f.calls.sent.length, 1);
  assert.equal(f.calls.sent[0].to, "qa@example.invalid");
  assert.equal(f.calls.sent[0].subject, "Your agent just finished its first task");
  assert.deepEqual(f.calls.flags, [{ key: flag, userId: 985 }]);
  assert.equal(f.store.length, 1);
});

test("second agent completion and a fresh process reuse the durable marker", async () => {
  const f = fixture();
  f.schedule();
  await f.settle();
  f.schedule(before, { ...after, id: 43, projectId: 16 }, 985, "another-agent");
  await f.settle();
  const restarted = fixture({ store: f.store });
  restarted.schedule();
  await restarted.settle();
  assert.equal(f.calls.sent.length, 1);
  assert.equal(restarted.calls.sent.length, 0);
  assert.equal(f.store.length, 1);
});

test("concurrent agent completions across boards claim once per user", async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) f.schedule(before, { ...after, id: 100 + i, projectId: 20 + i }, 985, `agent-${i}`);
  await f.settle();
  assert.equal(f.calls.sent.length, 1);
  assert.equal(f.store.length, 1);
  assert.equal(f.calls.locks.length, 20);
});

test("human completion never starts email work even on an agent-created task", async () => {
  const f = fixture();
  f.schedule({ ...before, agentId: "creator-agent" }, { ...after, agentId: "creator-agent" }, 985, null);
  await f.settle();
  assert.equal(f.calls.reads, 0);
  assert.equal(f.calls.sent.length, 0);
  assert.equal(f.store.length, 0);
});

test("flag off sends nothing and does not consume the marker", async () => {
  const f = fixture({ enabled: false });
  f.schedule();
  await f.settle();
  assert.equal(f.calls.sent.length, 0);
  assert.equal(f.store.length, 0);
});

test("non-owner board and mismatched agent owner email neither user", async () => {
  for (const options of [{ boardOwner: 123 }, { agentOwner: 123 }, { missingAgent: true }, { noEmail: true }]) {
    const f = fixture(options);
    f.schedule();
    await f.settle();
    assert.equal(f.calls.sent.length, 0);
    assert.equal(f.store.length, 0);
  }
});

test("different owners have independent lifetime markers", async () => {
  const store = [];
  const first = fixture({ store });
  first.schedule();
  await first.settle();
  const second = fixture({ store, userId: 6, boardOwner: 6 });
  second.schedule();
  await second.settle();
  assert.equal(store.length, 2);
  assert.equal(second.calls.sent.length, 1);
});

test("email failure does not throw and retains marker against ambiguous delivery", async () => {
  const f = fixture({ sendFailure: true });
  assert.doesNotThrow(() => f.schedule());
  await assert.doesNotReject(f.settle());
  f.schedule();
  await f.settle();
  assert.equal(f.calls.sent.length, 1);
  assert.equal(f.store.length, 1);
});

test("flag, marker and scheduling failures never reject the task-side work", async () => {
  for (const options of [{ flagFailure: true }, { markerFailure: true }, { schedulerFailure: true }]) {
    const f = fixture(options);
    assert.doesNotThrow(() => f.schedule());
    await assert.doesNotReject(f.settle());
    assert.equal(f.calls.sent.length, options.schedulerFailure ? 1 : 0);
  }
});

test("transition requires entering a done section, respects explicit isDone and legacy names", async () => {
  for (const [oldTask, task, sections, expected] of [
    [before, before, undefined, 0],
    [after, { ...after, sectionId: 3, section: "Shipped" }, undefined, 0],
    [before, { ...after, status: "Archive" }, undefined, 0],
    [before, { ...after, status: "Deleted" }, undefined, 0],
    [before, after, [{ id: 2, section_title: "Done", isDone: false }], 0],
    [before, { ...after, section: "Accepted" }, [{ id: 2, section_title: "Accepted", isDone: true }], 1],
    [{ ...before, sectionId: null }, { ...after, sectionId: null }, [], 1],
  ]) {
    const f = fixture({ sections });
    f.schedule(oldTask, task);
    await f.settle();
    assert.equal(f.calls.sent.length, expected);
  }
});

test("async scheduling returns while the provider is still pending", async () => {
  let release;
  const f = fixture({ sendBarrier: new Promise((resolve) => { release = resolve; }) });
  assert.equal(f.schedule(), undefined);
  let completed = false;
  const work = f.settle().then(() => { completed = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.sent.length, 1);
  assert.equal(completed, false);
  release();
  await work;
});

test("integration uses committed fenced task state and excludes trusted background writes", () => {
  const source = read("src/utils/controllers/tasks/single.ts");
  const point = source.indexOf("scheduleAgentFirstTaskEmail(taskBeforeWrite, task, currentUser.id, agentId)");
  assert.ok(point > source.indexOf("taskBeforeWrite = currentState"));
  assert.ok(point > source.indexOf("{ timeout: 60_000 }"));
  assert.match(source, /if \(!options.trustedCaller\) \{\s*scheduleAgentFirstTaskEmail\(taskBeforeWrite, task, currentUser.id, agentId\);/);
  assert.doesNotMatch(source, /await scheduleAgentFirstTaskEmail/);
  assert.match(read("src/lib/mcp/tasks/updateTask.ts"), /ctx.agentId \? \{ agentId: ctx.agentId \}/);
  assert.match(read("src/lib/mcp/auth/verifyJwt.ts"), /id: rawAgentId,\s*userId: user.id,\s*revokedAt: null/);
  assert.match(read("src/lib/api/task-writes/update.ts"), /updateTaskSingle\(newTask, currentUser, actingAgentId\)/);
});

test("schema stays unchanged and flag defaults to Owner + QA", () => {
  const { execFileSync } = require("node:child_process");
  assert.equal(execFileSync("git", ["diff", "origin/production", "--", "src/prisma"], { cwd: root, encoding: "utf8" }), "");
  assert.match(read("src/lib/flags.ts"), /key: HTPR_7028_FIRST_TASK_EMAIL_FLAG,\s*kind: "feature",\s*defaultMode: "OWNER_AND_QA"/);
  assert.match(read("src/lib/flags/keys.ts"), /HTPR_7028_FIRST_TASK_EMAIL_FLAG = "htpr-7028-first-task-email"/);
});

test("changed-file typecheck has no diagnostics in feature code", { skip: !process.env.HTPR_7028_TYPECHECK }, () => {
  const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.equal(parsed.errors.length, 0);
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, incremental: false, noEmit: true });
  const files = [emailFile, templateFile, boardFile, "src/lib/flags.ts", "src/lib/flags/keys.ts", "src/utils/controllers/tasks/single.ts"];
  const diagnostics = [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics()];
  for (const file of files) {
    const source = program.getSourceFile(path.join(root, file));
    assert.ok(source, file);
    diagnostics.push(...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source));
  }
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => root, getCanonicalFileName: (file) => file, getNewLine: () => "\n",
  }));
});

function inviteEffect(overrides = {}) {
  const source = read(boardFile);
  const start = source.indexOf("const firstTaskEmailEnabled = useFlag(HTPR_7028_FIRST_TASK_EMAIL_FLAG)");
  const end = source.indexOf("const readyBoardRender =", start);
  assert.ok(start > 0 && end > start);
  const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const calls = [];
  const context = {
    useFlag: (key) => { assert.equal(key, flag); return overrides.enabled !== false; },
    HTPR_7028_FIRST_TASK_EMAIL_FLAG: flag,
    searchParams: new URLSearchParams(overrides.params ?? "id=15&invite=1&view=default"),
    useSetRecoilState: () => (value) => calls.push(value), showCommandsAtom: {},
    useRecoilValue: () => ({ id: overrides.atomProjectId ?? 15 }), currentProjectAtom: {},
    useRef: () => overrides.ref ?? { current: null },
    useEffect: (effect) => { effect(); effect(); },
    authenticated: true, isGuest: false, boardDataReady: true, currentBoardAccessStatus: "authorized",
    readyProject: { id: 15 }, requestedProjectId: 15, user: { id: 985 },
    CommandMode: { InviteMember: "existing-invite-command" }, URL,
    window: { location: { href: "https://app.hypertask.ai/project?id=15&invite=1&view=default" }, history: {
      state: { preserved: true }, replaceState: (state, title, url) => calls.push({ state, url }),
    } },
    getNextRouterAwareHistoryState: (state) => state,
    ...overrides,
  };
  vm.runInNewContext(code, context);
  return JSON.parse(JSON.stringify(calls));
}

test("invite param opens existing dialog once only with flag on and keeps board URL state", () => {
  assert.deepEqual(inviteEffect(), [
    { show: true, mode: "existing-invite-command" },
    { state: { preserved: true }, url: "/project?id=15&view=default" },
  ]);
  for (const overrides of [
    { enabled: false }, { params: "id=15" }, { params: "id=15&invite=0" },
    { authenticated: false }, { isGuest: true }, { boardDataReady: false },
    { currentBoardAccessStatus: "denied" }, { currentBoardAccessStatus: "pending" },
    { readyProject: { id: 99 } }, { atomProjectId: 99 },
  ]) assert.deepEqual(inviteEffect(overrides), []);
});

test("template escapes task title and names, preserves copy, and uses absolute CTA URLs", () => {
  const { subject, html } = templates().renderAgentFirstTaskEmail({
    agentName: "Agent <script>&", taskTitle: "Fix 'quotes' <img src=x onerror=alert(1)>",
    boardName: "Board <b>&", projectId: 15, uniqueIndex: 7028,
  });
  assert.equal(subject, "Your agent just finished its first task");
  assert.match(html, /Agent &lt;script&gt;&amp; completed/);
  assert.match(html, /Fix &#39;quotes&#39; &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /on Board &lt;b&gt;&amp;\./);
  assert.match(html, /Hypertask works best when your team and your agents share the board\./);
  assert.match(html, /href="https:\/\/app.hypertask.ai\/detail\/project-15\/7028"[^>]*>Review the work<\/a>/);
  assert.match(html, /href="https:\/\/app.hypertask.ai\/project\?id=15&amp;invite=1"[^>]*>Invite a teammate<\/a>/);
  assert.doesNotMatch(html, /<script>|<img|<b>/);
});

test("commit scope preserves the requested worktree, trailers and forbidden-file constraints", { skip: !process.env.HTPR_7028_VERIFY_COMMIT }, () => {
  const { execFileSync } = require("node:child_process");
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(fs.realpathSync(root), "/home/valentin/projects/wt-7028");
  assert.equal(git("branch", "--show-current").trim(), "htpr-7028-first-task-email");
  const message = git("log", "-1", "--format=%B");
  assert.equal(message.split("\n")[0], "HTPR-7028 [FEATURE] Your agent finished its first task email with invite a teammate");
  assert.match(message, /Co-Authored-By: Claude Opus 5\.5 <noreply@anthropic\.com>\nClaude-Session: https:\/\/claude.ai\/code\/session_015vvpfaf3Uj77guJJ6A7SwJ\n*$/);
  const allowed = new Set([emailFile, templateFile, boardFile, "src/lib/flags.ts", "src/lib/flags/keys.ts", "src/utils/controllers/tasks/single.ts", "tests/first-agent-task-email.test.cjs", "tests/board-background-refetch-render.test.cjs", "tests/feature-flags.test.cjs", "tests/task-write-controller-auth.test.cjs", "tests/task-move-error-message.test.cjs"]);
  const changed = git("diff", "--name-only", "HEAD^", "HEAD").trim().split("\n");
  assert.equal(changed.length, allowed.size);
  for (const file of changed) assert.ok(allowed.has(file), file);
  assert.equal(git("ls-files", "node_modules").trim(), "");
  assert.equal(fs.lstatSync(path.join(root, "node_modules")).isSymbolicLink(), true);
  const additions = git("diff", "--unified=0", "HEAD^", "HEAD").split("\n").filter(line => line.startsWith("+") && !line.startsWith("+++"));
  assert.equal(additions.some(line => line.includes("\u2014")), false);
  assert.equal(git("diff", "--name-only", "HEAD", "--", ".", ":!GATES.md").trim(), "");
});

test("screenshot renders the actual email HTML locally without sending", { skip: !process.env.HTPR_7028_RENDER_EVIDENCE }, async () => {
  const { chromium } = require("@playwright/test");
  const directory = path.join(process.env.HOME, ".local/state/vcc-evidence/HTPR-7028/local");
  fs.mkdirSync(directory, { recursive: true });
  const { html } = templates().renderAgentFirstTaskEmail({
    agentName: "Release agent", taskTitle: "Check the release notes", boardName: "Product team", projectId: 15, uniqueIndex: 7028,
  });
  fs.writeFileSync(path.join(directory, "first-task-email.html"), html);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 700 }, colorScheme: "light" });
    await page.setContent(html);
    assert.equal(await page.locator("a.cta").count(), 2);
    await page.screenshot({ path: path.join(directory, "first-task-email-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 700 });
    await page.screenshot({ path: path.join(directory, "first-task-email-phone.png"), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: path.join(directory, "first-task-email-dark.png"), fullPage: true });
  } finally { await browser.close(); }
});
