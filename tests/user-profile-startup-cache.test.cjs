const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

test("fresh user profiles remain reusable for five minutes", () => {
  const { getUserProfileQueryOptions, USER_PROFILE_STALE_TIME_MS } =
    loadModule("src/lib/auth/userProfileQuery.ts");

  assert.equal(USER_PROFILE_STALE_TIME_MS, 300_000);
  assert.deepEqual(getUserProfileQueryOptions(6), {
    queryKey: ["fetchUser", 6],
    enabled: true,
    staleTime: 300_000,
  });
});

test("user profile fetching waits for a valid cookie user ID", () => {
  const { getUserProfileQueryOptions } = loadModule("src/lib/auth/userProfileQuery.ts");

  assert.equal(getUserProfileQueryOptions(undefined).enabled, false);
  assert.equal(getUserProfileQueryOptions(null).enabled, false);
  assert.equal(getUserProfileQueryOptions(0).enabled, false);
  assert.equal(getUserProfileQueryOptions(Number.NaN).enabled, false);
});
