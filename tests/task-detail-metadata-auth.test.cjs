const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { load } = require("./task-route-loader.cjs");

function harness(userId) {
  const calls = [];
  const unrelated = {
    "@/lib/agents/publicAgent": {}, "@/lib/cycles": {}, "@/lib/agents/visibility": {},
    "@/utils/controllers/notifications/visibleInboxScope": {},
  };
  const { projectContentAccessWhere } = load("src/utils/controllers/projects/getAllIncludes.ts", unrelated);
  const mocks = {
    "@/lib/auth/serverUser": { getServerCookieUser: async () => { calls.push(["session"]); return userId === null ? null : { id: userId }; } },
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere },
    "@/utils/controllers/taskDetail/load": { parseDetailSlug: slug =>
      slug?.[0] === "project-7049" && slug?.[1] === "318" ? { projectId: 7049, uniqueIndex: 318 } : null },
    "@/lib/prisma": { default: { task: { findFirst: async query => {
      calls.push(["task", query]);
      const project = { ownerId: 985, members: [{ userId: 42, agentId: null }, { userId: 43, agentId: "agent-only" }] };
      if (query.where.project && !query.where.project.OR.some(branch =>
        branch.ownerId === project.ownerId || (branch.members && project.members.some(member =>
          member.userId === branch.members.some.userId && member.agentId === branch.members.some.agentId)))) return null;
      return { title: "Private title", ticketNumber: "PRIVATE-318" };
    } } } },
  };
  const filename = path.resolve(__dirname, "../src/app/detail/[...slug]/page.tsx");
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name === "@/lib/prisma") return { __esModule: true, ...mocks[name] };
    return mocks[name] ?? {};
  }, loadedModule, loadedModule.exports);
  return { generateMetadata: loadedModule.exports.generateMetadata, calls };
}

for (const userId of [2343, 43, null, 985, 42]) {
  test(`detail metadata: user ${userId} only receives titles with human board access`, async () => {
    const h = harness(userId);
    const result = await h.generateMetadata({ params: Promise.resolve({ slug: ["project-7049", "318"] }) });
    assert.deepEqual(result, { title: [985, 42].includes(userId) ? "PRIVATE-318 Private title - Hypertask" : "Hypertask" });
    assert.deepEqual(h.calls.map(([kind]) => kind), userId === null ? ["session"] : ["session", "task"]);
    if (userId !== null) {
      assert.equal(h.calls[1][1].where.projectId, 7049);
      assert.equal(h.calls[1][1].where.uniqueIndex, 318);
      assert.deepEqual(h.calls[1][1].select, { title: true, ticketNumber: true });
    }
  });
}

test("detail metadata: malformed slug does not query session or task content", async () => {
  const h = harness(985);
  assert.deepEqual(await h.generateMetadata({ params: Promise.resolve({ slug: ["project-7049"] }) }), { title: "Hypertask" });
  assert.deepEqual(h.calls, []);
});
