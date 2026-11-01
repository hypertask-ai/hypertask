const test = require("node:test");
const assert = require("node:assert/strict");
const { QueryClient, QueryObserver } = require("@tanstack/query-core");

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
