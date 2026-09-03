const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const axios = require("axios");
const { QueryClient } = require("@tanstack/react-query");

// HTPR-6063: useGetNotifications mounts independently in the app shell and
// the inbox page, so each mount's own effect fired its own
// /api/notifications/access request - 2-3x per load, confirmed via HAR,
// competing for connections in the window that gates the inbox GET's start
// time. fetchInboxAccessibleProjectIds collapses concurrent callers onto one
// in-flight request via React Query's own dedupe (queryKey + staleTime: 0),
// not a time-based cache: a fresh call after the prior one settles must
// still hit the server.

const root = path.join(__dirname, "..");
const jiti = require("jiti")(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
  cache: false,
});

const { fetchInboxAccessibleProjectIds, inboxAccessQueryKey } = jiti(
  path.join(root, "src/hooks/Inbox/useGetNotifications.ts"),
);

test("HTPR-6063: concurrent access calls collapse into one fetch, a later call after settle fetches again", async () => {
  const originalGet = axios.get;
  let calls = 0;
  axios.get = async (url) => {
    if (!url.includes("/api/notifications/access")) {
      return originalGet(url);
    }
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { data: { accountId: 6, projectIds: [1, 2, 3] } };
  };

  try {
    const queryClient = new QueryClient();

    const [a, b, c] = await Promise.all([
      fetchInboxAccessibleProjectIds(queryClient, 6),
      fetchInboxAccessibleProjectIds(queryClient, 6),
      fetchInboxAccessibleProjectIds(queryClient, 6),
    ]);
    assert.equal(calls, 1, "3 concurrent callers must collapse into 1 fetch");
    assert.deepEqual(a, { accountId: 6, projectIds: [1, 2, 3] });
    assert.deepEqual(b, a);
    assert.deepEqual(c, a);

    await fetchInboxAccessibleProjectIds(queryClient, 6);
    assert.equal(
      calls,
      2,
      "a call after the prior one settled must hit the server again - staleTime:0, not a time cache",
    );

    queryClient.clear();
  } finally {
    axios.get = originalGet;
  }
});

test("HTPR-6063: the access query key is scoped by userId, not shared across accounts", () => {
  assert.notDeepEqual(inboxAccessQueryKey(6), inboxAccessQueryKey(7));
});
