const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const agent = { id: "native-id", name: "Sidebar Desktop Native", sessionId: "native-session" };
const chat = { lane: "Desktop", id: "saved-id", title: "Smoke Desktop chat: planning", message: "Saved personal transcript" };
const fixture = { projectId: 15, lanes: { Desktop: [agent] }, personalChats: [chat], storageStates: { Desktop: "/fixtures/desktop.json", Mobile: "/fixtures/mobile.json" } };

function smoke() {
  let use;
  const register = () => {};
  Object.assign(register, {
    use: options => { use = options; }, describe: { configure() {} }, skip() {}, beforeAll() {}, beforeEach() {},
  });
  const expect = locator => ({
    async toBeVisible() { await locator.ready; assert.equal(locator.visible, true); },
    async toBeHidden() { assert.equal(locator.visible, false); },
    async toHaveText(text) { await locator.ready; assert.equal(locator.text, text); },
    toBe: expected => assert.equal(locator, expected),
  });
  expect.poll = callback => ({ toBe: async expected => assert.equal(await callback(), expected) });
  const js = ts.transpileModule(read("e2e/smoke/agent-sidebar-chats.spec.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", `${js}\nexports.open = open; exports.choose = choose; exports.setFixture = value => { fixture = value; };`)(name => {
    if (name === "@playwright/test") return { test: register, expect };
    if (name.startsWith("node:")) return require(name);
    if (name === "./lib/realtime") return { withRealtime: value => value };
    if (name === "./lib/layout-lock-scroll") return {};
    assert.fail(`Unexpected dependency: ${name}`);
  }, loaded, loaded.exports);
  loaded.exports.setFixture(fixture);
  return { ...loaded.exports, use };
}

function pageFor({ selected = agent, failure } = {}) {
  const titleReady = deferred(), transcriptReady = deferred();
  const list = { visible: true, getByRole: () => ({ visible: false }) };
  const title = { visible: true, text: "AI chat", ready: titleReady.promise };
  const transcript = { visible: true, ready: transcriptReady.promise };
  const row = { visible: true, isVisible: async () => true, click: async () => { list.visible = false; } };
  row.filter = () => row;
  row.first = () => row;
  const selectors = [];
  list.isVisible = async () => list.visible;
  list.locator = selector => { selectors.push(selector); return row; };
  const page = {
    getByTestId: id => id === "agent-sidebar-conversations" ? list : {
      visible: true, getByText: (text, options) => {
        assert.equal(text, selected.name ? `${selected.name} history 1` : selected.message);
        assert.equal(options.exact, true);
        return transcript;
      },
    },
    getByRole: (_role, { name }) => name === "Switch conversation" ? title : { visible: true },
    getByText: text => { assert.equal(text, failure); return transcript; },
    locator: () => ({ visible: true }),
  };
  return { page, selectors, list, title, commit() {
    title.text = selected.name ?? "AI chat";
    titleReady.resolve();
  }, load: () => transcriptReady.resolve() };
}

test("native selection waits for title and transcript", async () => {
  const view = pageFor();
  let complete = false;
  const choosing = smoke().choose(view.page, agent.name).then(() => { complete = true; });
  await tick();
  assert.equal(view.list.visible, false);
  assert.equal(complete, false, "closing the picker is not native-open completion");
  view.commit();
  await tick();
  assert.equal(complete, false, "the native title alone is not transcript readiness");
  view.load();
  await choosing;
  assert.equal(complete, true);
  assert.deepEqual(view.selectors, ['[data-command-key="native-id"]']);
});

test("saved selection waits for the exact session message", async () => {
  const view = pageFor({ selected: chat });
  view.commit();
  let complete = false;
  const choosing = smoke().choose(view.page, chat.title).then(() => { complete = true; });
  await tick();
  assert.equal(complete, false);
  view.load();
  await choosing;
  assert.deepEqual(view.selectors, ['[data-command-key="session:saved-id"]']);
});

test("open failure waits for the expected error", async () => {
  const view = pageFor({ failure: "Runtime unavailable" });
  let complete = false;
  const choosing = smoke().choose(view.page, agent.name, "Runtime unavailable").then(() => { complete = true; });
  await tick();
  assert.equal(complete, false);
  view.load();
  await choosing;
  assert.equal(view.title.text, "AI chat");
});

test("open waits for browser flags and lane history", async () => {
  const view = pageFor({ selected: chat });
  const flags = deferred();
  let listening = false, complete = false;
  view.page.waitForResponse = predicate => {
    listening = true;
    assert.equal(predicate({ url: () => "http://localhost/api/flags", ok: () => true }), true);
    return flags.promise;
  };
  view.page.goto = async () => { assert.equal(listening, true); };
  view.page.request = { get: () => assert.fail("a separate API request does not prove browser readiness") };
  const opening = smoke().open(view.page, "Desktop").then(() => { complete = true; });
  await tick();
  assert.equal(complete, false);
  flags.resolve({ json: async () => ({ flags: { "htpr-7518-agent-sidebar-chats": true, "htpr-7688-past-chats-first": true } }) });
  view.commit();
  await tick();
  assert.equal(complete, false);
  view.load();
  await opening;
  assert.deepEqual(view.selectors, ['[data-command-key="session:saved-id"]']);
});

test("browser contexts use lane storage states", async () => {
  const { use } = smoke();
  assert.equal(typeof use.storageState, "function");
  for (const lane of ["Desktop", "Mobile"]) {
    let state;
    await use.storageState({}, value => { state = value; }, { project: { name: lane } });
    assert.equal(state, fixture.storageStates[lane]);
  }
});

test("seed isolates lane users, cookies, histories and tokens", async () => {
  const source = read("scripts/seed-browser-smoke.mjs");
  const start = source.indexOf("  const personalChats = [];");
  const end = source.indexOf("  let contract;", start);
  assert.ok(start >= 0 && end > start);
  const records = {}, files = {};
  let id = 100;
  const prisma = Object.fromEntries(["user", "member_Team", "member", "chatSession", "chatMessage", "agent"].map(model => {
    records[model] = [];
    return [model, {
      create: async ({ data }) => {
        const row = { ...data, id: id++, ...(data.UserSetting ? { UserSetting: { id: id++ } } : {}) };
        records[model].push(row);
        return row;
      },
      createMany: async ({ data }) => { records[model].push(...data); },
      update: async ({ where, data }) => Object.assign(records[model].find(row => row.id === where.id), data),
    }];
  }));
  const run = new (Object.getPrototypeOf(async function () {}).constructor)(
    "prisma", "path", "writeFile", "signSession", "createMcpToken", "agentTokenCredentialFields",
    `const runKey = "unit", googleAccount = { id: "account" }, team = { id: "team" }, board = { id: 15 };
const stateFile = "/fixtures/state.json", user = { id: 1, email: "shared@example.invalid" }, sessionUser = { id: 1, uid: "shared" };
const state = { cookies: [{ name: "ht_session" }, { name: "nookies_user" }, { name: "previousBoard", value: "project-15|&|" }], origins: [] };
${source.slice(start, end)}`,
  );
  await run(prisma, path, async (file, text) => { files[file] = JSON.parse(text); }, JSON.stringify,
    (userId, _email, _ttl, agentId) => `${userId}:${agentId}`, token => ({ token }));
  const seeded = files["/fixtures/agent-sidebar-fixture.json"];
  assert.ok(seeded.storageStates, "parallel lanes must not use the shared smoke account");
  assert.deepEqual(Object.keys(seeded.storageStates), ["Desktop", "Mobile"]);
  assert.equal(new Set(records.user.map(user => user.id)).size, 2);
  for (const lane of ["Desktop", "Mobile"]) {
    const user = records.user.find(user => user.displayName === `Sidebar ${lane}`);
    assert.notEqual(user.id, 1);
    assert.ok(records.member.some(member => member.userId === user.id && member.agentId === undefined && member.status === "Accepted"));
    assert.ok(records.member_Team.some(member => member.userId === user.id && member.status === "Accepted"));
    const cookies = files[seeded.storageStates[lane]].cookies;
    assert.equal(JSON.parse(cookies.find(cookie => cookie.name === "ht_session").value).id, user.id);
    const client = JSON.parse(decodeURIComponent(cookies.find(cookie => cookie.name === "nookies_user").value));
    assert.equal(client.id, user.id);
    assert.equal(client.uid, user.uid);
    assert.equal(client.UserSettingId, user.UserSetting.id);
    const personal = seeded.personalChats.filter(session => session.lane === lane);
    assert.equal(personal.length, 3);
    for (const saved of personal) {
      assert.equal(records.chatSession.find(session => session.id === saved.id).userId, user.id);
      assert.ok(records.chatMessage.some(message => message.sessionId === saved.id && message.content === saved.message));
    }
    assert.equal(seeded.lanes[lane].length, 3);
    for (const agent of seeded.lanes[lane]) {
      assert.equal(records.agent.find(row => row.id === agent.id).userId, user.id);
      assert.equal(records.chatSession.find(session => session.id === agent.sessionId).userId, user.id);
      assert.equal(agent.token, `${user.id}:${agent.id}`);
    }
  }
});

test("theme setup clears its own persisted B draft", () => {
  const source = read("e2e/smoke/agent-sidebar-chats.spec.ts");
  const start = source.indexOf("for (const theme of");
  const end = source.indexOf("test('open error", start);
  const theme = source.slice(start, end);
  assert.match(theme, /request\.patch\(`\/api\/agent-chat\/\$\{b\.sessionId\}\/participant`/);
  assert.match(theme, /data: \{ draft: '' \}/);
  assert.match(theme, /expect\(clearedDraft\.status\(\)\)\.toBe\(200\)/);
  assert.ok(theme.indexOf("request.patch") < theme.indexOf("await open("));
  assert.match(theme, /await expect\(bEditor\)\.toBeEmpty\(\)/);
});

test("history waits for a lane-owned row", () => {
  const source = read("e2e/smoke/agent-sidebar-chats.spec.ts");
  assert.match(source, /page\.locator\('#ai-chat-session-history'\)\.getByRole\('button', \{ name: fixture\.personalChats\.find\(chat => chat\.lane === info\.project\.name\)!\.title, exact: true \}\)\)\.toBeVisible\(\)/);
});
