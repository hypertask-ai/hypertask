const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const axios = require("axios");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { interopDefault: true });
const { markTaskSeen } = jiti(
  path.join(root, "src/utils/api/Task Detail/markTaskSeen.ts"),
);

// HTPR-6047: task detail opens fired detailMeta, comments/getByTask and
// users/preferences 2-3 times each. Two of the three causes were structural
// and can be pinned by source shape rather than by mounting React, so this
// asserts the shape rather than re-reproducing the bug at runtime.

test("HTPR-6047: TaskDetailComp does not hold its own comments query", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src/app/detail/[...slug]/TaskDetailComp.tsx"),
    "utf8",
  );
  // DescriptionAndCommentsProvider's useCommentAndDescriptions is the one
  // remaining owner of the [CommentsTQPrefixKey, taskId] query. A second
  // useGetAllComments call here used to fire its own /api/comments/getByTask
  // request on every open.
  assert.ok(
    !/useGetAllComments\s*\(/.test(src),
    "TaskDetailComp must not call useGetAllComments directly - it duplicates DescriptionAndCommentsProvider's query",
  );
  assert.ok(
    /queryClient\.refetchQueries\(\{\s*queryKey:\s*\[globalConstants\.CommentsTQPrefixKey/.test(
      src,
    ),
    "the comment-list refetch trigger must reach the shared query by key, not hold its own observer",
  );
});

test("HTPR-6047: fetchCommentsHelper reads preferences from the shared React Query cache", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src/utils/api/Task Detail/index.ts"),
    "utf8",
  );
  // The old fix kept its own 5-minute memo, separate from useGetUserPreferences'
  // own cache entry, so a cold detail-page memo fired a second
  // /api/users/preferences request that useGetUserPreferences' consumers didn't
  // need. Routing through queryClient.ensureQueryData with the same query key
  // makes it the same cache entry.
  assert.ok(
    /queryClient\.ensureQueryData\(\{\s*queryKey:\s*USER_PREFERENCES_QUERY_KEY/.test(
      src,
    ),
    "fetchCommentsHelper must fetch preferences via the shared USER_PREFERENCES_QUERY_KEY cache entry",
  );
  assert.ok(
    !/prefMemo/.test(src),
    "the old standalone preferences memo must be gone, not left running alongside the shared cache",
  );
});

test("task detail uses the shared seen-request helper exactly once", () => {
  const src = fs.readFileSync(
    path.join(
      root,
      "src/hooks/Task Detail/CommentAndDescriptionHooks/useCommentAndDescriptions.ts",
    ),
    "utf8",
  );

  assert.equal(src.match(/markTaskSeen\(/g)?.length, 1);
  assert.doesNotMatch(
    src,
    /axios\.post\("\/api\/(?:notifications\/getByTask|comments\/updateSeen)"/,
    "the hook must not start another notification write outside the tested helper",
  );
});

test("task seen requests choose one endpoint and preserve failures", async (t) => {
  const originalPost = axios.post;
  const calls = [];
  t.after(() => {
    axios.post = originalPost;
  });
  axios.post = async (...args) => {
    calls.push(args);
    return { status: 200 };
  };

  await markTaskSeen(42, []);
  await markTaskSeen(42, [10, 11]);

  assert.deepEqual(calls, [
    ["/api/notifications/getByTask", { taskId: 42 }],
    ["/api/comments/updateSeen", { commentIds: [10, 11], taskId: 42 }],
  ]);

  const timeout = Object.assign(new Error("timeout exceeded"), {
    code: "ECONNABORTED",
  });
  axios.post = async () => {
    throw timeout;
  };
  await assert.rejects(markTaskSeen(42, []), (error) => error === timeout);
});

test("HTPR-6047: FollowersProvider mounts inside the task-detail Suspense boundary", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src/app/detail/[...slug]/page.tsx"),
    "utf8",
  );
  // FollowersProvider used to sit outside <Suspense> while TaskDetail sat
  // inside it, so TaskDetail's own dynamic() imports could defer its mount
  // (and its priority/estimate/labels hooks) to a later commit than
  // FollowersProvider's - missing the one-tick window getTaskDetailMeta
  // relies on to coalesce all four fields into one request (HTPR-3708).
  const suspenseOpen = src.indexOf("<Suspense");
  const providerOpen = src.indexOf("<FollowersProvider>");
  const providerClose = src.indexOf("</FollowersProvider>");
  const suspenseClose = src.lastIndexOf("</Suspense>");
  assert.ok(
    suspenseOpen >= 0 && providerOpen > suspenseOpen,
    "<FollowersProvider> must open after <Suspense> opens",
  );
  assert.ok(
    providerClose >= 0 && providerClose < suspenseClose,
    "</FollowersProvider> must close before </Suspense> closes",
  );
});
