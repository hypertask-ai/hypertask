const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const assets = ["e4af272ccee01ff0", "5611c55482296524", "4b9bb515ce6d026f"].map(hash => `/_next/static/media/${hash}-s.woff2`);
const plex = "/_next/static/media/26d4368bf94c0ec4-s.woff2";

function loadLayout(board, inbox = null, overrides = {}) {
  const font = { variable: "font-variable", className: "font-class" };
  const mocks = {
    "next/headers": { cookies: async () => ({ get: name => name === "theme" ? { value: "porcelain" } : undefined }) },
    "@/lib/firstScreen/serverBoardDocument": { getServerBoardDocument: async () => board },
    "@/lib/firstScreen/serverInboxDocument": { getServerInboxDocument: async () => inbox },
    "@/lib/firstScreen/serverTicketShell": { getServerTicketShell: async () => null },
    "@/utils/serverActions": { isMobileDevice: async () => ({ isMobile: true, isApple: false }) },
    "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: () => null },
    "@/lib/configs/auth.config": { default: { cookies: { theme: "theme", defaultTheme: "porcelain" } } },
    "@/lib/configs/general.config": { DIV_ID_CONSTANTS: { bodyLayout: "body-layout" } },
    "@/lib/fonts/inter": { inter: font, INTER_LATIN_FONT_HREF: assets[0] },
    "@/lib/fonts/newsreader": { newsreader: font, NEWSREADER_LATIN_FONT_HREFS: assets.slice(1) },
    "@/lib/fonts/ibmPlexSans": { ibmPlexSans: font },
    "@/lib/flags/keys": { HTPR_7278_MEMORY_ONLY_TRACKING_FLAG: "htpr-7278-memory-only-tracking", HTPR_7627_TICKET_FIRST_SCREEN_FLAG: "htpr-7627-ticket-first-screen" },
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/lib/themePreferences": { normalizeThemePreference: x => x, resolveInitialThemeColor: () => "#fff", resolveThemePreference: () => "porcelain", resolvedThemeDomMetadata: { porcelain: { classes: ["light", "porcelain"], themeColor: "#ffffff" } } },
    "@/lib/themeBootScript": { buildThemeBootScript: () => "" },
    "@/lib/appShellBootstrap/client": { buildEarlyAppShellBootstrapScript: () => "" },
    "@/utils/Providers": { default: ({ children }) => children },
  };
  Object.assign(mocks, overrides);
  const exports = {};
  const code = ts.transpileModule(read("src/app/layout.tsx"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: id => {
    if (Object.hasOwn(mocks, id)) return { __esModule: true, ...mocks[id] };
    if (id.endsWith(".css") || id.endsWith(".scss")) return {};
    if (id.startsWith("@/") || id === "@vercel/speed-insights/next") return { __esModule: true, default: () => null, SpeedInsights: () => null };
    return require(id);
  } }, { filename: "src/app/layout.tsx" });
  return exports.default;
}

const document = (mobile = true, theme = "porcelain", route = "/project") => ({
  scope: { route, accountId: 985 }, display: { isMobile: mobile, theme }, flags: { values: { "htpr-6934-server-first-screen": true } },
});

for (const theme of ["porcelain", "graphite", "amoled", "dia"]) {
  test(`only a seeded phone board defers unused fonts in ${theme}`, async () => {
    for (const [board, inbox, deferred] of [
      [document(true, theme), null, theme !== "dia"],
      [document(false, theme), null, false],
      [null, document(true, theme, "/inbox"), false],
      [null, null, false],
    ]) {
      const html = renderToStaticMarkup(await loadLayout(board, inbox)({ children: React.createElement("a", { href: "/detail/project-15/1" }, "Real card") }));
      for (const asset of assets) assert.equal(html.includes(`href="${asset}"`), !deferred, JSON.stringify({ board, inbox, asset }));
      assert.ok(html.includes("Real card"));
      assert.equal(html.includes(plex), false, JSON.stringify({ board, inbox, theme }));
    }
  });
}

test("font assets stay available but Next no longer unconditionally preloads unused fonts", () => {
  for (const file of ["src/lib/fonts/inter.ts", "src/lib/fonts/newsreader.ts"]) {
    assert.match(read(file), /preload: false/);
    assert.match(read(file), /display: "swap"/);
  }
  assert.match(read("src/lib/fonts/inter.ts"), /e4af272ccee01ff0-s\.woff2/);
  assert.match(read("src/lib/fonts/newsreader.ts"), /5611c55482296524-s\.woff2/);
  assert.match(read("src/lib/fonts/newsreader.ts"), /4b9bb515ce6d026f-s\.woff2/);
});

test("HTPR-7718: layout seeds only authenticated first document visits and isolates seed failures", async () => {
  const flagKey = "htpr-7718-first-visit-flag-seed";
  const flagSeed = { accountId: 985, evaluatedAt: new Date().toISOString(), values: { "visible-ticket-flag": true } };
  for (const scenario of [
    { name: "first visit", seeded: true },
    { name: "board seed", board: document() },
    { name: "inbox seed", inbox: document(true, "porcelain", "/inbox") },
    { name: "ticket shell", shell: { accountId: 985, display: { theme: "porcelain" } } },
    { name: "RSC request", rsc: "1" },
    { name: "flag off", enabled: false },
    { name: "no session", anonymous: true },
    { name: "headers failure", failure: "headers" },
    { name: "flag failure", failure: "flag" },
    { name: "seed failure", failure: "seed" },
  ]) {
    const calls = [];
    const Provider = () => null;
    const layout = loadLayout(scenario.board ?? null, scenario.inbox ?? null, {
      "next/headers": { cookies: async () => ({ get: () => undefined }), headers: async () => {
        if (scenario.failure === "headers") throw Error("headers unavailable");
        return new Headers(scenario.rsc ? { rsc: scenario.rsc } : {});
      } },
      "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: () => scenario.anonymous ? null : { id: 985 } },
      "@/lib/firstScreen/serverTicketShell": { getServerTicketShell: async () => scenario.shell ?? null },
      "@/lib/flags/definitions/htpr-7718-first-visit-flag-seed": { HTPR_7718_FIRST_VISIT_FLAG_SEED_FLAG: flagKey },
      "@/lib/flags": { isFeatureEnabled: async (key, accountId) => {
        if (key !== flagKey) return key === "htpr-7627-ticket-first-screen";
        assert.equal(accountId, 985);
        calls.push("flag");
        if (scenario.failure === "flag") throw Error("flag unavailable");
        return scenario.enabled !== false;
      } },
      "@/lib/firstScreen/serverFlags": { getFirstVisitFlagSeed: async accountId => {
        assert.equal(accountId, 985);
        calls.push("seed");
        if (scenario.failure === "seed") throw Error("seed unavailable");
        return flagSeed;
      } },
      "@/utils/Providers": { default: Provider },
    });
    const tree = await layout({ children: "existing-content" });
    const provider = tree.props.children[1].props.children.find(child => child?.type === Provider);
    assert.ok(provider, scenario.name);
    assert.equal(provider.props.flagSeed, scenario.seeded ? flagSeed : null, scenario.name);
    assert.equal(provider.props.children, "existing-content", scenario.name);
    const eligible = !scenario.board && !scenario.inbox && !scenario.shell && !scenario.rsc && !scenario.anonymous && scenario.failure !== "headers";
    assert.deepEqual(calls, !eligible ? [] : scenario.enabled === false || scenario.failure === "flag" ? ["flag"] : ["flag", "seed"], scenario.name);
  }
});
