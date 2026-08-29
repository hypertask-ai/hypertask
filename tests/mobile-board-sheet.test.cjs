// HTPR-4504: tapping the boards icon on a task detail page opened a thin,
// unusable strip at the bottom instead of a Boards panel.
//
// Cause: MobileTitleSheet read the boards list from the React Query CACHE only.
// That cache is warmed on inbox and filled on the board page, but nothing loads
// it on task detail — so the list was empty, the sheet had no rows, and it
// collapsed to its own padding. Nothing was broken about the slide-out itself,
// which is why it looked like a CSS bug.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { QueryClient, QueryObserver } = require("@tanstack/query-core");

const root = path.resolve(__dirname, "..");
const sheet = fs.readFileSync(
  path.join(root, "src/components/Global/MobileTitleSheet.tsx"),
  "utf8",
);
const accessibleListHook = fs.readFileSync(
  path.join(root, "src/hooks/MultiPages/useGetAllAccessibleBoardList.ts"),
  "utf8",
);
test("the sheet fetches an independent account-scoped accessible board list", () => {
  assert.ok(
    /useGetAllAccessibleBoardList\(/.test(sheet),
    "the sheet must fetch when the route-authoritative cache is cold",
  );
  assert.doesNotMatch(
    sheet,
    /useGetAllBoards\(/,
    "the switcher must not mount a competing observer on the route-authoritative query",
  );
  assert.match(
    accessibleListHook,
    /\["mobileBoardSwitcherProjects", accountId\]/,
    "the independent request must be scoped to the current account",
  );
  assert.doesNotMatch(
    sheet,
    /PROJECTS_ALL_QUERY_KEY|getQueryData/,
    "the switcher must not display shared cache metadata before its own authorization request settles",
  );
  assert.match(
    sheet,
    /!accessibleBoardsLoading &&\s*!accessibleBoardsError &&\s*Array\.isArray\(accessibleBoards\)/,
    "the fresh accessible-board response must replace the cached fallback, including with an empty list",
  );
  assert.match(
    sheet,
    /boards\.length === 0 && accessibleBoardsError/,
    "a failed list request must show an error state rather than stale cached metadata",
  );
  assert.match(sheet, /refetchAccessibleBoards\(\)/, "the error state must be retryable");
});

test("the sheet never renders an empty body", () => {
  // A zero-height list reads as a broken control. A line of text is a state the
  // user can understand.
  assert.ok(
    /boards\.length === 0/.test(sheet),
    "the sheet must handle the empty case explicitly",
  );
  assert.ok(
    /Loading boards/.test(sheet) && /No boards yet/.test(sheet),
    "both the loading and the genuinely-empty case need visible copy",
  );
  assert.ok(
    /Couldn’t load boards/.test(sheet) && /Try again/.test(sheet),
    "a request failure must not be presented as a genuinely empty account",
  );
});

test("the independent source uses the authoritative accessible-board listing", () => {
  assert.match(
    accessibleListHook,
    /getAllProjects\(user, null, \{ signal \}\)/,
    "the switcher must use the same listing semantics as the Board route without fetching an active board payload",
  );
  assert.match(
    accessibleListHook,
    /return projects\.updatedProjects/,
    "the independent query must expose the complete authoritative list",
  );
  assert.doesNotMatch(
    accessibleListHook,
    /initialData:/,
    "a synthetic empty result must not make a cold switcher query look fresh",
  );
  assert.match(
    accessibleListHook,
    /refetchOnMount: "always"/,
    "every explicit switcher open must refresh authorization before showing cached results",
  );
  assert.match(
    accessibleListHook,
    /queryFn: async \(\{ signal \}\)[\s\S]*?getAllProjects\(user, null, \{ signal \}\)/,
    "fresh authorization must abort an obsolete in-flight switcher response",
  );
});

test("the accessible boards query does not fire without a user", () => {
  assert.ok(
    /enabled: !!currentUser\?\.id/.test(sheet),
    "the sheet must not fetch until it knows who the user is",
  );
});

test("a cancelled mounted switcher query restarts as an active refetch", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const queryKey = ["mobileBoardSwitcherProjects", 6];
  let calls = 0;
  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn: ({ signal }) =>
      new Promise((resolve, reject) => {
        calls += 1;
        const call = calls;
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
        if (call === 2) resolve([{ id: 15, title: "Hypertask Product" }]);
      }),
  });
  const unsubscribe = observer.subscribe(() => undefined);
  await new Promise((resolve) => setImmediate(resolve));

  const cancellation = queryClient.cancelQueries(
    { queryKey, exact: true },
    { revert: false },
  );
  await cancellation;
  await queryClient.invalidateQueries({
    queryKey,
    exact: true,
    refetchType: "active",
  });

  assert.equal(calls, 2);
  assert.equal(observer.getCurrentResult().status, "success");
  assert.deepEqual(observer.getCurrentResult().data, [
    { id: 15, title: "Hypertask Product" },
  ]);
  unsubscribe();
  queryClient.clear();
});

test("cancellation does not resurrect metadata removed by fresh authorization", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const queryKey = ["mobileBoardSwitcherProjects", 6];
  queryClient.setQueryData(queryKey, [{ id: 15 }, { id: 99 }]);
  const pending = queryClient.fetchQuery({
    queryKey,
    queryFn: ({ signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
    staleTime: 0,
  });
  await new Promise((resolve) => setImmediate(resolve));

  queryClient.setQueryData(queryKey, [{ id: 15 }]);
  await queryClient.cancelQueries(
    { queryKey, exact: true },
    { revert: false },
  );
  await pending.catch(() => undefined);

  assert.deepEqual(queryClient.getQueryData(queryKey), [{ id: 15 }]);
  queryClient.clear();
});

test("a failed refresh retains an already-authorized local board", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const queryKey = ["projectsAll"];
  const localBoard = {
    accountId: 6,
    dataOrigin: "indexeddb",
    updatedProjects: [{ id: 15, tasks: [{ id: 1 }] }],
  };

  await assert.rejects(
    queryClient.fetchQuery({
      queryKey,
      queryFn: async () => {
        // Fresh authorization publishes the prepared snapshot while this
        // network query is still in flight.
        queryClient.setQueryData(queryKey, localBoard, { updatedAt: 0 });
        await Promise.resolve();
        throw new Error("Active board payload unavailable");
      },
      staleTime: 0,
    }),
  );

  assert.deepEqual(queryClient.getQueryData(queryKey), localBoard);
  queryClient.clear();
});
