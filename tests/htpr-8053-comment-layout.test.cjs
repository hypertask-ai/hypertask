const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const fixture = {
  taskId: 101,
  detailPath: "/detail/project-11/1",
  flags: { "htpr-7298-standalone-pages": true, "htpr-7309-pages-screens": true },
  pages: {
    Desktop: { projectId: 22, taskId: 202, detailPath: "/detail/project-22/1" },
    Mobile: { projectId: 33, taskId: 303, detailPath: "/detail/project-33/1" },
  },
};

function pagesSmoke() {
  let run;
  let suite;
  let storageState;
  const register = (name, ...args) => {
    if (name.startsWith("Pages list creates")) run = args.at(-1);
  };
  Object.assign(register, { describe(name, callback) { suite = name; callback(); suite = undefined; }, use(options) { if (suite === "Pages fixtures") storageState = options.storageState; }, afterEach() {}, skip(condition) { assert.equal(condition, false); } });
  const expect = value => ({
    toBe: expected => assert.equal(value, expected),
    async toBeVisible() {},
    async toHaveCount() {},
    async toHaveValue() {},
  });
  expect.poll = callback => ({ toBe: async expected => assert.equal(await callback(), expected) });
  const js = ts.transpileModule(fs.readFileSync(path.join(root, "e2e/smoke/prod.spec.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = {};
  new Function("require", "exports", "__dirname", "console", js)(name => {
    if (name === "@playwright/test") return { test: register, expect };
    if (name === "node:fs") return { ...fs, readFileSync: file => {
      assert.equal(path.basename(file), "card-fixture.json");
      return JSON.stringify(fixture);
    } };
    if (name.startsWith("node:") || name === "zod") return require(name);
    if (name === "./lib/errorPage") return {};
    if (name === "./lib/realtime") return { withRealtime: value => value };
    if (name === "./lib/tier") return { tieredId: value => value };
    assert.fail(`Unexpected dependency ${name}`);
  }, loaded, path.join(root, "e2e/smoke"), { log() {}, error() {} });
  assert.equal(typeof run, "function");
  return { run, storageState };
}

for (const lane of ["Desktop", "Mobile"]) {
  test(`Pages ${lane} writes never add content above the layout fixture's comment box`, async t => {
    const previous = process.env.BROWSER_SMOKE_PR;
    process.env.BROWSER_SMOKE_PR = "1";
    t.after(() => {
      if (previous === undefined) delete process.env.BROWSER_SMOKE_PR;
      else process.env.BROWSER_SMOKE_PR = previous;
    });
    let url = "https://example.invalid/";
    let boardId;
    let linkedTaskId;
    const links = [];
    const ticketVisits = [];
    const locator = (role, name) => ({
      getByRole: (childRole, options) => locator(childRole, options?.name),
      getByText: text => locator(undefined, text),
      fill: async () => {},
      allInnerTexts: async () => [],
      click: async () => {
        if (role === "link") {
          const target = [fixture, ...Object.values(fixture.pages)].find(row => row.taskId === linkedTaskId);
          url = `https://example.invalid${target.detailPath}`;
        } else if (name === "New page") url = "https://example.invalid/page/test-page";
      },
    });
    const page = {
      url: () => url,
      goto: async destination => {
        url = new URL(destination, "https://example.invalid").href;
        if (new URL(url).pathname.startsWith("/detail/")) ticketVisits.push(new URL(url).pathname);
        if (new URL(url).pathname === "/pages") boardId = Number(new URL(url).searchParams.get("project_id"));
      },
      reload: async () => {},
      keyboard: { press: async () => {} },
      getByRole: (role, options) => locator(role, options?.name),
      getByText: name => locator(undefined, name),
      getByPlaceholder: () => locator(),
      locator: () => locator(),
      request: {
        get: async () => ({ json: async () => ({ page: { projectId: boardId } }) }),
        post: async (endpoint, options) => {
          if (endpoint.endsWith("/links")) {
            linkedTaskId = options.data.task_id;
            links.push(linkedTaskId);
          }
          return { ok: () => true };
        },
        delete: async (endpoint, options) => {
          if (endpoint.endsWith("/links")) links.push(options.data.task_id);
          return { ok: () => true };
        },
      },
    };
    const registered = pagesSmoke();
    await registered.storageState({}, async statePath => {
      assert.equal(path.basename(statePath), `pages-${lane}-state.json`);
    }, { project: { name: lane } });
    await registered.run({ page }, { project: { name: lane } });
    assert.equal(boardId, fixture.pages[lane].projectId, "Pages writes must not change the layout board");
    assert.deepEqual(ticketVisits, [fixture.pages[lane].detailPath], "task-context page linking must not open the layout ticket");
    assert.deepEqual(links, [fixture.pages[lane].taskId, fixture.pages[lane].taskId], "link and unlink must use the lane's own ticket, never the layout ticket");
    assert.ok(!links.includes(fixture.taskId), "linking the shared layout ticket pushes its comment box down 120–138px");
  });
}

const { matrixDifferences } = require("jiti").createJiti(__filename)(path.join(root, "e2e/smoke/lib/layout-lock-matrix.ts"));
const baseline = JSON.parse(fs.readFileSync(path.join(root, "e2e/smoke/layout-lock-matrix.baseline.json"), "utf8"));

test("the unchanged layout oracle rejects the observed 120–138px comment-box shifts", () => {
  for (const [width, delta] of [[1920, 120], [1440, 120], [1280, 120], [1100, 120], [950, 138], [768, 138]]) {
    const expected = baseline.pages["ticket-short-thread"]["ai-closed|rail-expanded"][width];
    const actual = Object.fromEntries(Object.entries(expected).map(([name, anchor]) => [name, { ...anchor.box }]));
    assert.deepEqual(matrixDifferences("short thread", "ticket-short-thread", expected, actual), []);
    actual["comment-box"].y += delta;
    assert.ok(matrixDifferences("short thread", "ticket-short-thread", expected, actual).some(message => message.includes(`comment-box moved 0,${delta}px`)));
  }
});
