const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const clientSource = read("src/lib/appShellBootstrap/client.ts");
const clientJavascript = ts.transpileModule(clientSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const clientModule = { exports: {} };
new Function("exports", "module", clientJavascript)(
  clientModule.exports,
  clientModule,
);

const {
  buildEarlyAppShellBootstrapScript,
  consumeEarlyAppShellBootstrapSlice,
  waitForEarlyAppShellBootstrap,
} = clientModule.exports;

const successfulPayload = {
  accountId: 6,
  slices: {
    user: { ok: true, data: { id: 6, displayName: "Owner" }, fetchedAt: 1 },
    preferences: { ok: false },
    favorites: { ok: true, data: [], fetchedAt: 1 },
    projects: { ok: true, data: [{ id: 15 }], fetchedAt: 1 },
    hyperAi: { ok: true, data: { id: 332 }, fetchedAt: 1 },
    announcements: { ok: true, data: [], fetchedAt: 1 },
    teams: { ok: true, data: [], fetchedAt: 1 },
    buildId: { ok: true, data: "build-1", fetchedAt: 1 },
  },
};

const runBootstrap = ({ betterAuthEnabled, body }) => {
  const calls = [];
  const runtimeWindow = {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => body,
      };
    },
  };
  vm.runInNewContext(
    buildEarlyAppShellBootstrapScript({ accountId: 6, betterAuthEnabled }),
    { window: runtimeWindow, Date, JSON },
  );
  return { calls, runtimeWindow };
};

test("authenticated parser bootstrap starts exactly one protected POST", async () => {
  for (const [betterAuthEnabled, expectedUrl, body] of [
    [true, "/api/auth/bridge-session", { ok: true, bootstrap: successfulPayload }],
    [false, "/api/app-shell/bootstrap", successfulPayload],
  ]) {
    const { calls, runtimeWindow } = runBootstrap({ betterAuthEnabled, body });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, expectedUrl);
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.credentials, "include");
    assert.equal(calls[0].init.cache, "no-store");
    assert.equal(await runtimeWindow.__htAppShellBootstrap.request.then((r) => r.ok), true);
  }
});

test("concurrent readers share a slice and later refetches cannot replay it", async () => {
  const { runtimeWindow } = runBootstrap({
    betterAuthEnabled: true,
    body: { ok: true, bootstrap: successfulPayload },
  });
  global.window = runtimeWindow;
  try {
    const first = consumeEarlyAppShellBootstrapSlice("projects", 6);
    const concurrent = consumeEarlyAppShellBootstrapSlice("projects", 6);
    assert.deepEqual(await first, [{ id: 15 }]);
    assert.deepEqual(await concurrent, [{ id: 15 }]);
    assert.equal(
      await consumeEarlyAppShellBootstrapSlice("projects", 6),
      undefined,
    );
    assert.equal(await waitForEarlyAppShellBootstrap(7), false);
  } finally {
    delete global.window;
  }
});

test("a failed slice falls back without discarding successful slices", async () => {
  const { runtimeWindow } = runBootstrap({
    betterAuthEnabled: false,
    body: successfulPayload,
  });
  global.window = runtimeWindow;
  try {
    assert.equal(
      await consumeEarlyAppShellBootstrapSlice("preferences", 6),
      undefined,
    );
    assert.equal(
      await consumeEarlyAppShellBootstrapSlice("buildId", 6),
      "build-1",
    );
  } finally {
    delete global.window;
  }
});

test("server bootstrap derives every private slice from the verified account", () => {
  const route = read("src/app/api/app-shell/bootstrap/route.ts");
  const service = read("src/lib/appShellBootstrap/server.ts");
  const bridge = read("src/lib/auth/bridgePlugin.ts");
  const favoritesRoute = read("src/pages/api/favorites/getFavorites.ts");
  const favoritesController = read(
    "src/utils/controllers/favorites/getAll.ts",
  );
  const projectsRoute = read("src/pages/api/projects/getAllMinimal.ts");
  const userRoute = read("src/pages/api/users/getById.ts");

  assert.match(route, /verifySession\([\s\S]*getAppShellBootstrap\(session\.id\)/);
  assert.match(route, /private, no-store/);
  assert.match(service, /Promise\.all\(\[/);
  assert.match(service, /SLICE_TIMEOUT_MS/);
  assert.match(bridge, /getAppShellBootstrap\(legacySession\.id\)/);
  assert.match(bridge, /cache-control', 'private, no-store'/);
  assert.match(favoritesController, /owner: \{ select: favoriteUserSelect \}/);
  assert.match(favoritesController, /user: \{ select: favoriteUserSelect \}/);
  assert.doesNotMatch(favoritesController, /\b(owner|user): true\b/);
  for (const source of [favoritesRoute, projectsRoute, userRoute]) {
    assert.match(source, /verifySession\(req\.cookies\[SESSION_COOKIE\]\)/);
    assert.match(source, /session\.id/);
  }
});

test("all app-shell readers consume the shared response before their fallback", () => {
  const sources = [
    "src/hooks/General/useAuth.tsx",
    "src/hooks/General/useGetUserPreferences.tsx",
    "src/utils/api/global/apiHelpers/getAllFavorites.ts",
    "src/utils/api/global/apiHelpers/getAllProjectsMinimal.ts",
    "src/hooks/MultiPages/useGetHyperAI.ts",
    "src/hooks/MultiPages/Sidebar/useGetAnnouncements.ts",
    "src/utils/api/Homepage/index.ts",
    "src/components/System/DeploySkewGuard.tsx",
  ];
  for (const sourcePath of sources) {
    assert.match(
      read(sourcePath),
      /consumeEarlyAppShellBootstrapSlice/,
      `${sourcePath} must consume its bootstrap slice`,
    );
  }

  const auth = read("src/hooks/General/useAuth.tsx");
  const currentUser = read(
    "src/hooks/General/useCurrentUserCheckFromCookies.tsx",
  );
  const globalProvider = read(
    "src/components/ProviderGlobal/GloablProviders.tsx",
  );
  const layout = read("src/app/layout.tsx");
  assert.match(auth, /waitForEarlyAppShellBootstrap\(authenticatedAccountId\)/);
  assert.match(
    auth,
    /consumeEarlyAppShellBootstrapSlice<IUser>\([\s\S]*"user",[\s\S]*authenticatedAccountId/,
  );
  assert.match(currentUser, /user\.id === authenticatedUserId/);
  assert.match(
    globalProvider,
    /authenticatedUserId !== null && startupUser\?\.id === authenticatedUserId/,
  );
  assert.ok(
    layout.indexOf('id="ht-early-app-shell-bootstrap"') <
      layout.indexOf("<ClientErrorReporter"),
  );
});
