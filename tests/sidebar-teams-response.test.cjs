const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
  cache: false,
});

const {
  requireSidebarTeams,
  selectSidebarTeams,
  sidebarTeamsQueryKey,
  SIDEBAR_TEAMS_CACHE_VERSION,
  SIDEBAR_TEAMS_PATH,
} = jiti(path.join(root, "src/utils/api/Homepage/sidebarTeamsResponse.ts"));

test("the axiosClient sidebar path does not repeat its /api base URL", () => {
  assert.equal(SIDEBAR_TEAMS_PATH, "/teams/getAllSidebar");
  assert.ok(!SIDEBAR_TEAMS_PATH.startsWith("/api/"));
  assert.equal(
    axios.create({ baseURL: "/api" }).getUri({ url: SIDEBAR_TEAMS_PATH }),
    "/api/teams/getAllSidebar"
  );

  const homepageApi = fs.readFileSync(
    path.join(root, "src/utils/api/Homepage/index.ts"),
    "utf8"
  );
  assert.match(
    homepageApi,
    /axiosClient\.post\(SIDEBAR_TEAMS_PATH, body\)/
  );
  assert.doesNotMatch(homepageApi, /axiosClient\.post\(`?\/api\/teams\/getAllSidebar/);
});

test("the request rejects catch-all HTML instead of caching it as teams", () => {
  assert.throws(
    () => requireSidebarTeams("<!DOCTYPE html><html>Product</html>"),
    /Invalid sidebar teams response/
  );
});

test("hydrated HTML from the broken deployment is harmless while refetching", () => {
  assert.deepEqual(
    selectSidebarTeams("<!DOCTYPE html><html>Product</html>"),
    []
  );

  const queryHook = fs.readFileSync(
    path.join(root, "src/hooks/MultiPages/useGetAllTeamsMinimal.ts"),
    "utf8"
  );
  assert.match(queryHook, /select:selectSidebarTeams/);
  assert.match(queryHook, /queryKey:sidebarTeamsQueryKey\(currentUserId\)/);
});

test("the fixed deployment bypasses the poisoned persisted query", () => {
  const oldKey = ["getAllTeamsMinimal", 6];
  const fixedKey = sidebarTeamsQueryKey(6);

  assert.equal(SIDEBAR_TEAMS_CACHE_VERSION, 2);
  assert.deepEqual(fixedKey, ["getAllTeamsMinimal", 6, 2]);
  assert.notDeepEqual(fixedKey, oldKey);
  assert.deepEqual(fixedKey.slice(0, 1), ["getAllTeamsMinimal"]);
});

test("valid sidebar teams pass through unchanged", () => {
  const teams = [{ id: "team-1", projects: [{ id: 15, title: "Product" }] }];
  assert.equal(requireSidebarTeams(teams), teams);
  assert.equal(selectSidebarTeams(teams), teams);
});
