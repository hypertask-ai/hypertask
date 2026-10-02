const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

test("the real task page passes the server snapshot timestamp to both comments consumers", async () => {
  const filename = path.join(__dirname, "../src/app/detail/[...slug]/page.tsx");
  const javascript = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const comments = [{ id: 1, text: "Server comment" }];
  let fetchStartedAt;
  const component = () => null;
  const stubs = {
    "./TaskDetailComp": { default: component },
    "../../unauthorized/page": { default: component },
    "@/lib/auth/serverUser": { requireServerCookieUser: async () => ({ id: 2343 }) },
    "@/lib/prisma": { default: {} },
    "@/utils/controllers/taskDetail/load": {
      parseDetailSlug: () => ({ projectId: 6859, uniqueIndex: 43 }),
      fetchTaskDetail: async () => ({ id: 42, project: { team: {} } }),
      fetchCommentsForSlug: async () => { fetchStartedAt = Date.now(); return comments; },
    },
    "@/lib/contexts/TaskDetail/TaskProvider": { TasksProvider: component },
    "@/lib/contexts/TaskDetail/FollowersProvider": { FollowersProvider: component },
    "@/utils/helperFunctions/TaskDetail": { processComments: () => ({}) },
    "@/utils/controllers/users/fetch_preferences": {
      fetchUserPreferenceController: async () => ({ res: { commentsStacked: false } }),
    },
    "@/utils/controllers/tasks/markRead": { getTaskReadStateLastReadAt: async () => null },
    "@/utils/controllers/comments/readReceipts": { filterCommentReadReceipts: async (data) => data },
    "@/lib/agentRuns/service": { listTaskAgentRunActivities: async () => [] },
    "next/navigation": { redirect: () => { throw new Error("Unexpected redirect"); } },
  };
  const loaded = { exports: {} };
  const localRequire = (request) => {
    if (request in stubs) return stubs[request];
    assert.ok(["react", "react/jsx-runtime"].includes(request), `Unstubbed import: ${request}`);
    return require(request);
  };
  new Function("module", "exports", "require", javascript)(loaded, loaded.exports, localRequire);
  const before = Date.now();
  const tree = await loaded.exports.default({
    params: Promise.resolve({ slug: ["project-6859", "43"] }),
    searchParams: Promise.resolve({}),
  });
  const payloads = [];
  function visit(node) {
    if (!node?.props) return;
    if (node.props._comments) payloads.push(JSON.parse(node.props._comments));
    for (const child of [node.props.children].flat()) visit(child);
  }
  visit(tree);
  assert.equal(payloads.length, 2);
  for (const payload of payloads) {
    assert.deepEqual(payload.comments, comments);
    assert.ok(Number.isFinite(payload.updatedAt));
    assert.ok(payload.updatedAt >= before);
    assert.ok(payload.updatedAt <= fetchStartedAt, "timestamp must not hide server processing age");
  }
  assert.equal(payloads[0].updatedAt, payloads[1].updatedAt);
});
