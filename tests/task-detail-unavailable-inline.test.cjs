const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pagePath = path.join(root, "src/app/detail/[...slug]/page.tsx");
const previousReact = global.React;
global.React = require("react");
const stubs = new Map();

function stub(filename, exports) {
  stubs.set(filename, require.cache[filename]);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function stubLocal(relativePath, exports) {
  stub(path.join(root, relativePath), exports);
}

const Unavailable = () => null;

stubLocal("src/app/detail/[...slug]/TaskDetailController.tsx", { default: () => null });
stubLocal("src/app/unauthorized/page.tsx", { default: Unavailable });
stubLocal("src/utils/controllers/taskDetail/load.ts", {
  fetchCommentsForSlug: async () => [],
  fetchTaskDetail: async () => null,
  parseDetailSlug: () => ({ projectId: 15, uniqueIndex: 6562 }),
  parseProjectSlug: () => 15,
});
stubLocal("src/lib/auth/serverUser.ts", {
  requireServerCookieUser: async () => ({ id: 42 }),
});
stubLocal("src/lib/prisma.ts", { default: {} });
stubLocal("src/lib/contexts/TaskDetail/TaskProvider.tsx", {
  TasksProvider: ({ children }) => children,
});
stubLocal("src/lib/contexts/TaskDetail/FollowersProvider.tsx", {
  FollowersProvider: ({ children }) => children,
});
stubLocal("src/utils/helperFunctions/TaskDetail.ts", { processComments: () => ({}) });
stubLocal("src/utils/controllers/users/fetch_preferences.ts", {
  fetchUserPreferenceController: async () => ({
    res: {
      commentsStacked: false,
      scrollSetting: "Bottom",
      shareReadReceipts: false,
    },
  }),
});
stubLocal("src/utils/controllers/tasks/markRead.ts", {
  getTaskReadStateLastReadAt: async () => null,
});
stubLocal("src/utils/controllers/comments/readReceipts.ts", {
  filterCommentReadReceipts: async (comments) => comments,
});
stubLocal("src/lib/agentRuns/service.ts", {
  listTaskAgentRunActivities: async () => [],
});

const navigationPath = require.resolve("next/navigation");
stub(navigationPath, {
  redirect: () => {
    throw new Error("late redirect called");
  },
});

const jitiModule = require("jiti");
const jiti = jitiModule.createJiti
  ? jitiModule.createJiti(__filename, {
      interopDefault: true,
      jsx: true,
      alias: { "@": path.join(root, "src") },
    })
  : jitiModule(__filename, {
      interopDefault: true,
      jsx: true,
      alias: { "@": path.join(root, "src") },
    });
const Page = jiti(pagePath).default;

test.after(() => {
  delete require.cache[pagePath];
  for (const [filename, previous] of stubs) {
    if (previous === undefined) delete require.cache[filename];
    else require.cache[filename] = previous;
  }
  if (previousReact === undefined) delete global.React;
  else global.React = previousReact;
});

test("a deleted task renders the unavailable page without a late redirect", async () => {
  const result = await Page({
    params: Promise.resolve({ slug: ["project-15", "6562"] }),
    searchParams: Promise.resolve({}),
  });

  assert.equal(result.type, Unavailable);
});
