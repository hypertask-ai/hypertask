const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");
const { renderToStaticMarkup } = require("react-dom/server");

const root = path.resolve(__dirname, "..");
const flag = "htpr-7554-font-once";
const coldStartFlag = "htpr-7016-phone-board-cold-start";
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const font = { variable: "font-variable", className: "font-class" };

function load(file, mocks, env = {}) {
  const exports = {};
  const code = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { exports, process: { env }, require: id => {
    if (Object.hasOwn(mocks, id)) return { __esModule: true, ...mocks[id] };
    if (id.endsWith(".css") || id.endsWith(".scss")) return {};
    if (id.startsWith("@/") || id === "@vercel/speed-insights/next") return { __esModule: true, default: () => null, SpeedInsights: () => null };
    return require(id);
  } }, { filename: file });
  return exports;
}

const fonts = {
  "@/lib/fonts/inter": load("src/lib/fonts/inter.ts", { "next/font/google": { Inter: () => font } }),
  "@/lib/fonts/newsreader": load("src/lib/fonts/newsreader.ts", { "next/font/google": { Newsreader: () => font } }),
  "@/lib/fonts/ibmPlexSans": load("src/lib/fonts/ibmPlexSans.ts", { "next/font/google": { IBM_Plex_Sans: () => font } }),
};
const assets = [fonts["@/lib/fonts/inter"].INTER_LATIN_FONT_HREF, ...fonts["@/lib/fonts/newsreader"].NEWSREADER_LATIN_FONT_HREFS];
const plex = fonts["@/lib/fonts/ibmPlexSans"].IBM_PLEX_SANS_LATIN_FONT_HREF;

function cssFontUrl(href, deploymentId) {
  const loader = fs.readFileSync(require.resolve("next/dist/build/webpack/loaders/next-font-loader/index.js"), "utf8");
  const expression = loader.match(/const outputPath = (.+);/);
  assert.ok(expression, "Next font loader must expose its CSS asset URL expression");
  return vm.runInNewContext(expression[1], {
    assetPrefix: "", interpolatedName: href.replace(/^\/_next\//, ""), deploymentId,
  });
}

async function head({ enabled = true, deploymentId = "dpl_font_once", theme = "porcelain", mobile = false, deferred = false, screen = "board", userId = 2343 } = {}) {
  const document = { display: { theme, isMobile: mobile }, flags: { values: { [coldStartFlag]: deferred } } };
  const calls = [];
  const Layout = load("src/app/layout.tsx", {
    ...fonts,
    "next/headers": { cookies: async () => ({ get: name => name === "theme" ? { value: theme } : undefined }) },
    "@/lib/firstScreen/serverBoardDocument": { getServerBoardDocument: async () => screen === "board" ? document : null },
    "@/lib/firstScreen/serverInboxDocument": { getServerInboxDocument: async () => screen === "inbox" ? document : null },
    "@/utils/serverActions": { isMobileDevice: async () => ({ isMobile: mobile, isApple: false }) },
    "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: () => userId === null ? null : { id: userId } },
    "@/lib/configs/auth.config": { default: { cookies: { theme: "theme", defaultTheme: "porcelain" } } },
    "@/lib/configs/general.config": { DIV_ID_CONSTANTS: { bodyLayout: "body-layout" } },
    "@/lib/flags/keys": { HTPR_7554_FONT_ONCE_FLAG: flag, HTPR_7016_PHONE_BOARD_COLD_START_FLAG: coldStartFlag },
    "@/lib/flags": { isFeatureEnabled: async (key, accountId) => { calls.push([key, accountId]); return key === flag && enabled; } },
    "@/lib/themePreferences": { normalizeThemePreference: x => x, resolveInitialThemeColor: () => "#fff", resolveThemePreference: () => theme, resolvedThemeDomMetadata: { [theme]: { classes: [theme] } } },
    "@/lib/themeBootScript": { buildThemeBootScript: () => "" },
    "@/lib/appShellBootstrap/client": { buildEarlyAppShellBootstrapScript: () => "" },
  }, deploymentId === null ? {} : { NEXT_DEPLOYMENT_ID: deploymentId }).default;
  const tree = await Layout({ children: null });
  const html = renderToStaticMarkup(tree.props.children.find(child => child.type === "head"));
  const links = Array.from(html.matchAll(/<link\b[^>]*>/g), match => match[0]);
  const hrefs = links.filter(link => /rel="preload"/.test(link) && /as="font"/.test(link)).map(link => link.match(/href="([^"]+)"/)[1]);
  for (const link of links) {
    assert.match(link, /type="font\/woff2"/);
    assert.match(link, /crossorigin="anonymous"/i);
  }
  return { html, hrefs, calls };
}

test("the font-once flag is an Everyone improvement with its release risk", () => {
  const definition = load("src/lib/flags/definitions/htpr-7554-font-once.ts", {}).default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.shippedOn, "2026-10-22");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
});

test("flag on renders all four preloads with exactly Next's CSS deployment URLs", async () => {
  for (const deploymentId of ["dpl_font_once", "dpl_another_release"]) {
    const result = await head({ deploymentId });
    assert.deepEqual(result.hrefs, [...assets, plex].map(href => cssFontUrl(href, deploymentId)));
    assert.deepEqual(result.calls.filter(([key]) => key === flag), [[flag, 2343]]);
    assert.equal(new Set(result.hrefs).size, 4);
  }
});

test("flag off preserves the entire previous head, even with a deployment ID", async () => {
  const result = await head({ enabled: false });
  assert.deepEqual(result.hrefs, [...assets, plex]);
  assert.equal(result.html, (await head({ enabled: false, deploymentId: "" })).html);
});

test("without a deployment ID the enabled head remains unchanged", async () => {
  for (const deploymentId of ["", null]) {
    assert.equal((await head({ deploymentId })).html, (await head({ enabled: false, deploymentId })).html);
  }
});

test("font eligibility is unchanged for all themes, desktop/phone, board/inbox/no first screen", async () => {
  for (const theme of ["porcelain", "graphite", "amoled", "dia"]) {
    for (const mobile of [false, true]) {
      for (const screen of ["board", "inbox", "none"]) {
        for (const deferred of [false, true]) {
          const options = { theme, mobile, screen, deferred };
          const previous = await head({ ...options, enabled: false });
          const current = await head(options);
          const wantsPlex = screen !== "none" && theme !== "dia";
          const wantsOtherFonts = !(screen === "board" && mobile && deferred && theme !== "dia");
          assert.deepEqual(previous.hrefs, [...(wantsOtherFonts ? assets : []), ...(wantsPlex ? [plex] : [])]);
          assert.deepEqual(current.hrefs, previous.hrefs.map(href => cssFontUrl(href, "dpl_font_once")));
        }
      }
    }
  }
});

test("signed-out layouts evaluate the flag with the existing anonymous identity", async () => {
  const result = await head({ userId: null });
  assert.deepEqual(result.calls.filter(([key]) => key === flag), [[flag, -1]]);
  assert.deepEqual(result.hrefs, [...assets, plex].map(href => cssFontUrl(href, "dpl_font_once")));
});
