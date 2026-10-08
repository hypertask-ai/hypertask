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
const flag = "htpr-7016-phone-board-cold-start";
const assets = ["e4af272ccee01ff0", "5611c55482296524", "4b9bb515ce6d026f"].map(hash => `/_next/static/media/${hash}-s.woff2`);
const plex = "/_next/static/media/26d4368bf94c0ec4-s.woff2";

function loadLayout(board, inbox = null) {
  const font = { variable: "font-variable", className: "font-class" };
  const mocks = {
    "next/headers": { cookies: async () => ({ get: name => name === "theme" ? { value: "porcelain" } : undefined }) },
    "@/lib/firstScreen/serverBoardDocument": { getServerBoardDocument: async () => board },
    "@/lib/firstScreen/serverInboxDocument": { getServerInboxDocument: async () => inbox },
    "@/utils/serverActions": { isMobileDevice: async () => ({ isMobile: true, isApple: false }) },
    "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: () => null },
    "@/lib/configs/auth.config": { default: { cookies: { theme: "theme", defaultTheme: "porcelain" } } },
    "@/lib/configs/general.config": { DIV_ID_CONSTANTS: { bodyLayout: "body-layout" } },
    "@/lib/fonts/inter": { inter: font, INTER_LATIN_FONT_HREF: assets[0] },
    "@/lib/fonts/newsreader": { newsreader: font, NEWSREADER_LATIN_FONT_HREFS: assets.slice(1) },
    "@/lib/fonts/ibmPlexSans": { ibmPlexSans: font, IBM_PLEX_SANS_LATIN_FONT_HREF: plex },
    "@/lib/flags/keys": { HTPR_7016_PHONE_BOARD_COLD_START_FLAG: flag },
    "@/lib/themePreferences": { normalizeThemePreference: x => x, resolveInitialThemeColor: () => "#fff", resolveThemePreference: () => "porcelain" },
    "@/lib/themeBootScript": { buildThemeBootScript: () => "" },
    "@/lib/appShellBootstrap/client": { buildEarlyAppShellBootstrapScript: () => "" },
    "@/utils/Providers": { default: ({ children }) => children },
  };
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

const document = (enabled, mobile = true, theme = "porcelain", route = "/project") => ({
  scope: { route, accountId: 985 }, display: { isMobile: mobile, theme }, flags: { values: { [flag]: enabled, "htpr-6934-server-first-screen": true } },
});

for (const theme of ["porcelain", "graphite", "amoled", "dia"]) {
  test(`only an enabled seeded phone board defers unused fonts in ${theme}`, async () => {
    for (const [board, inbox, deferred] of [
      [document(true, true, theme), null, theme !== "dia"],
      [document(false, true, theme), null, false],
      [document(undefined, true, theme), null, false],
      [document(true, false, theme), null, false],
      [null, document(true, true, theme, "/inbox"), false],
      [null, null, false],
    ]) {
      const html = renderToStaticMarkup(await loadLayout(board, inbox)({ children: React.createElement("a", { href: "/detail/project-15/1" }, "Real card") }));
      for (const asset of assets) assert.equal(html.includes(`href="${asset}"`), !deferred, JSON.stringify({ board, inbox, asset }));
      assert.ok(html.includes("Real card"));
      assert.equal(html.includes(`href="${plex}"`), Boolean((board || inbox) && theme !== "dia"));
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
