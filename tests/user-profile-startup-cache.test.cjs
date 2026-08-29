const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadQueryOptions() {
  const source = fs.readFileSync(
    path.join(root, "src/lib/auth/userProfileQuery.ts"),
    "utf8",
  );
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", javascript)(mod, mod.exports);
  return mod.exports;
}

const authSource = fs.readFileSync(
  path.join(root, "src/hooks/General/useAuth.tsx"),
  "utf8",
);

test("fresh user profiles remain reusable for five minutes", () => {
  const { getUserProfileQueryOptions, USER_PROFILE_STALE_TIME_MS } =
    loadQueryOptions();

  assert.equal(USER_PROFILE_STALE_TIME_MS, 300_000);
  assert.deepEqual(getUserProfileQueryOptions(6), {
    queryKey: ["fetchUser", 6],
    enabled: true,
    staleTime: 300_000,
  });
});

test("user profile fetching waits for a valid cookie user ID", () => {
  const { getUserProfileQueryOptions } = loadQueryOptions();

  assert.equal(getUserProfileQueryOptions(undefined).enabled, false);
  assert.equal(getUserProfileQueryOptions(null).enabled, false);
  assert.equal(getUserProfileQueryOptions(0).enabled, false);
  assert.equal(getUserProfileQueryOptions(Number.NaN).enabled, false);
});

test("AuthProvider uses the cache contract and retains explicit refresh", () => {
  assert.match(
    authSource,
    /\.\.\.getUserProfileQueryOptions\(currentUserCookie\?\.id\)/,
  );
  assert.match(authSource, /queryFn: fetchUserById/);
  assert.match(
    authSource,
    /setUserCookieAndAtom\(transformedUser\)/,
    "a completed background refresh must still update cookie and app state",
  );
});
