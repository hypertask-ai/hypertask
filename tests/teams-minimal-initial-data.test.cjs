const test = require("node:test");
const assert = require("node:assert");
const { QueryClient, QueryObserver } = require("@tanstack/query-core");

const OPTIONS = {
  queryKey: ["getAllTeamsMinimal", 6, 2],
  enabled: true,
  initialData: [],
  refetchOnMount: true,
  staleTime: 60_000,
  refetchOnWindowFocus: false,
};

async function mountAndCount(extraOptions) {
  let calls = 0;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const observer = new QueryObserver(client, {
    ...OPTIONS,
    ...extraOptions,
    queryFn: async () => {
      calls += 1;
      return [{ id: 1, title: "Hypertask", projects: [{ id: 15 }] }];
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  await new Promise((resolve) => setTimeout(resolve, 50));
  const data = observer.getCurrentResult().data;
  unsubscribe();
  client.clear();
  return { calls, teams: Array.isArray(data) ? data.length : null };
}

test("a seed dated now is trusted as fresh, so the board list is never fetched", async () => {
  const { calls, teams } = await mountAndCount({});
  assert.equal(calls, 0, "no request is made: the seed satisfies staleTime");
  assert.equal(teams, 0, "and the sidebar is handed an empty board list");
});

test("a seed dated at the epoch is stale on arrival, so mounting fetches", async () => {
  const { calls, teams } = await mountAndCount({ initialDataUpdatedAt: 0 });
  assert.equal(calls, 1, "mounting issues exactly one request");
  assert.equal(teams, 1, "and the real board list replaces the placeholder");
});

test("real data still honours staleTime, so a second mount does not refetch", async () => {
  let calls = 0;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const options = {
    ...OPTIONS,
    initialDataUpdatedAt: 0,
    queryFn: async () => {
      calls += 1;
      return [{ id: 1, title: "Hypertask", projects: [] }];
    },
  };

  const first = new QueryObserver(client, options);
  const unsubFirst = first.subscribe(() => {});
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(calls, 1, "the first mount fetches");

  const second = new QueryObserver(client, options);
  const unsubSecond = second.subscribe(() => {});
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(calls, 1, "the second mount reuses the fresh data");

  unsubFirst();
  unsubSecond();
  client.clear();
});
