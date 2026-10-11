const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

test("the real task page sends task and comments snapshots once, preserving their server timestamp", async () => {
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
  const comments = [{ id: 1, text: "Server comment ".repeat(1000) }];
  const taskSnapshot = { id: 42, project: { team: {} }, description: "Long task ".repeat(1000) };
  let fetchStartedAt;
  const component = () => null;
  const stubs = {
    "./TaskDetailComp": { default: component },
    "../../unauthorized/page": { default: component },
    "@/lib/auth/serverUser": { requireServerCookieUser: async () => ({ id: 2343 }) },
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => { throw new Error("Unexpected metadata access lookup"); } },
    "@/lib/prisma": { default: {} },
    "@/lib/flags": {
      HTPR_6868_TICKET_PREFIX_FLAG: "htpr-6868-ticket-prefix",
      isFeatureEnabled: async () => false,
    },
    "@/utils/controllers/taskDetail/load": {
      parseDetailSlug: () => ({ projectId: 6859, uniqueIndex: 43 }),
      fetchTaskDetail: async () => taskSnapshot,
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
  const tasks = [];
  function visit(node) {
    if (!node?.props) return;
    if (node.props._comments) payloads.push(JSON.parse(node.props._comments));
    for (const key of ["parsedTask", "_currentTask"]) {
      if (node.props[key]) tasks.push(JSON.parse(node.props[key]));
    }
    for (const child of [node.props.children].flat()) visit(child);
  }
  visit(tree);
  assert.equal(payloads.length, 1, "only the provider should receive the comments snapshot");
  assert.deepEqual(tasks, [taskSnapshot], "only the provider should receive the task snapshot");
  for (const payload of payloads) {
    assert.deepEqual(payload.comments, comments);
    assert.ok(Number.isFinite(payload.updatedAt));
    assert.ok(payload.updatedAt >= before);
    assert.ok(payload.updatedAt <= fetchStartedAt, "timestamp must not hide server processing age");
  }
});
