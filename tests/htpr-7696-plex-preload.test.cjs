const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { createRequire } = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const fontPath = "src/lib/fonts/ibmPlexSans.ts";
const request = { path: fontPath, import: "IBM_Plex_Sans", variableName: "ibmPlexSans" };
const loaderPath = require.resolve("../scripts/plex-preload-loader.cjs");
const googleLoader = require.resolve("next/dist/compiled/@next/font/google/loader");
const nextLoader = require("next/dist/build/webpack/loaders/next-font-loader").default;
const postcss = require("postcss");

function loadTs(file, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(code, { exports, require: id => {
    if (Object.hasOwn(mocks, id)) return { __esModule: true, ...mocks[id] };
    if (id.endsWith(".css") || id.endsWith(".scss")) return {};
    if (id.startsWith("@/") || id === "@vercel/speed-insights/next") return { __esModule: true, default: () => null, SpeedInsights: () => null };
    return require(id);
  } }, { filename: file });
  return exports;
}

function webpackConfig() {
  const configModule = { exports: {} };
  const configRequire = id => {
    if (id === "node:child_process") return { execFileSync() {} };
    if (["@next/bundle-analyzer", "next-pwa"].includes(id)) return () => config => config;
    if (id === "@posthog/nextjs-config") return { withPostHogConfig: config => config };
    return require(id);
  };
  configRequire.resolve = createRequire(path.join(root, "next.config.js")).resolve;
  new Function("require", "module", "process", "__dirname", read("next.config.js"))(
    configRequire, configModule, { env: { BUILD_ID: "plex-test" }, execPath: process.execPath }, root,
  );
  return configModule.exports;
}

function fontChain(isServer, assetPrefix, deploymentId) {
  const { getNextFontLoader } = require("next/dist/build/webpack/config/blocks/css/loaders/next-font");
  const use = getNextFontLoader({ isServer, isClient: !isServer, isDevelopment: false, hasAppDir: true,
    assetPrefix, deploymentId, experimental: {} }, async () => ({ postcss }), googleLoader);
  const rule = { test: require.resolve("next/font/google/target.css"), use };
  const config = { module: { rules: [{ oneOf: [rule] }] }, resolve: { alias: {} } };
  webpackConfig().webpack(config, { dev: false, isServer });
  const index = use.findIndex(entry => entry.loader === "next-font-loader");
  assert.equal(use[index - 1].loader, loaderPath);
  assert.equal(use[index - 2].options.fontLoader, true);
  return use;
}

async function emittedFont(t, isServer, assetPrefix = "", deploymentId = "") {
  t.mock.method(require("next/dist/compiled/@next/font/dist/google/fetch-css-from-google-fonts"), "fetchCSSFromGoogleFonts", async () => `/* latin-ext */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 100 700;
  font-display: swap;
  src: url(https://fonts.example.invalid/plex-ext.woff2) format('woff2');
  unicode-range: U+0100-02BA;
}
/* latin */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 100 700;
  font-display: swap;
  src: url(https://fonts.example.invalid/plex.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}`);
  t.mock.method(require("next/dist/compiled/@next/font/dist/google/fetch-font-file"), "fetchFontFile", async url => Buffer.from(url));
  let options;
  loadTs(fontPath, { "next/font/google": { IBM_Plex_Sans: value => { options = value; return {}; } } });
  assert.equal(options.preload, false);
  const use = fontChain(isServer, assetPrefix, deploymentId);
  const files = [];
  const span = { traceChild: () => span, traceAsyncFn: fn => fn() };
  const query = `?${JSON.stringify({ ...request, arguments: [options] })}`;
  const result = await new Promise((resolve, reject) => {
    Promise.resolve(nextLoader.call({
      resourceQuery: query, rootContext: root, resourcePath: require.resolve("next/font/google/target.css"),
      currentTraceSpan: span, getOptions: () => use[use.length - 1].options,
      emitFile: name => files.push(name), async: () => (error, css, map, meta) => error ? reject(error) : resolve({ css, map, meta }),
    })).catch(reject);
  });
  const originalCss = result.css;
  require(loaderPath).call({ resourceQuery: query, mode: "production", callback: (error, css, map, meta) => {
    assert.ifError(error);
    assert.equal(css, originalCss);
    Object.assign(result, { css, map, meta });
  } }, result.css, result.map, result.meta);
  const { getExportCode } = require("next/dist/build/webpack/loaders/css-loader/src/utils");
  const code = getExportCode(result.meta.exports, [], { esModule: false, modules: { exportOnlyLocals: true, exportLocalsConvention: "asIs" } });
  const cssModule = { exports: {} };
  vm.runInNewContext(code, { module: cssModule });
  const latin = postcss.parse(result.css).nodes.find((node, index, nodes) => node.type === "atrule" && nodes[index - 1]?.text === "latin");
  const href = /^url\((.+?)\)/.exec(latin.nodes.find(node => node.prop === "src").value)[1];
  assert.equal(cssModule.exports.preloadHref, href);
  assert.equal(href.startsWith(`${assetPrefix}/_next/static/media/`), true);
  assert.equal(href.endsWith(deploymentId ? `?dpl=${deploymentId}` : ".woff2"), true);
  assert.equal(files.length, isServer ? 0 : 2);
  assert.equal(files.some(file => file.includes(".p.")), false);
  return { ...result, href, font: { ...cssModule.exports, className: "plex-class", variable: "plex-variable" } };
}

async function documentHtml(font, theme, ticket = true, board = false, enabled = true, displayTheme = theme) {
  const plainFont = { variable: "font-variable", className: "font-class" };
  const display = { isMobile: false, theme: displayTheme };
  const layout = loadTs("src/app/layout.tsx", {
    "next/headers": { cookies: async () => ({ get: name => name === "theme" ? { value: theme } : undefined }) },
    "@/lib/firstScreen/serverBoardDocument": { getServerBoardDocument: async () => board ? { display } : null },
    "@/lib/firstScreen/serverInboxDocument": { getServerInboxDocument: async () => null },
    "@/lib/firstScreen/serverTicketShell": { getServerTicketShell: async () => ticket ? { accountId: 985, display } : null },
    "@/utils/serverActions": { isMobileDevice: async () => ({ isMobile: false, isApple: false }) },
    "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: () => null },
    "@/lib/configs/auth.config": { default: { cookies: { theme: "theme", defaultTheme: "system" } } },
    "@/lib/configs/general.config": { DIV_ID_CONSTANTS: { bodyLayout: "body-layout" } },
    "@/lib/fonts/inter": { inter: plainFont, INTER_LATIN_FONT_HREF: "/inter.woff2" },
    "@/lib/fonts/newsreader": { newsreader: plainFont, NEWSREADER_LATIN_FONT_HREFS: [] },
    "@/lib/fonts/ibmPlexSans": { ibmPlexSans: font },
    "@/lib/flags/keys": { HTPR_7627_TICKET_FIRST_SCREEN_FLAG: "ticket-seed", HTPR_7328_ROUNDED_THEME_FLAG: "rounded" },
    "@/lib/flags": { isFeatureEnabled: async key => key === "rounded" || (enabled && key === "ticket-seed") },
    "@/lib/themePreferences": loadTs("src/lib/themePreferences.ts"),
    "@/lib/themeBootScript": { buildThemeBootScript: () => "" },
    "@/utils/Providers": { default: ({ children }) => children },
  }).default;
  return renderToStaticMarkup(await layout({ children: React.createElement("p", null, "Ticket description") }));
}

const plexPreloads = html => [...html.matchAll(/<link\b[^>]*>/g)].map(match => match[0])
  .filter(tag => tag.includes('rel="preload"') && tag.includes("/_next/static/media/"));

for (const [assetPrefix, deploymentId] of [["", ""], ["", "deploy-test"], ["/assets", "deploy-test"], ["https://cdn.example.invalid", "deploy-test"]]) {
  test(`Plex ticket preload equals Next's CSS URL: ${assetPrefix} ${deploymentId}`, async t => {
    const server = await emittedFont(t, true, assetPrefix, deploymentId);
    const client = await emittedFont(t, false, assetPrefix, deploymentId);
    assert.equal(server.href, client.href);
    for (const theme of ["amoled", "graphite", "porcelain", "system"]) {
      const preloads = plexPreloads(await documentHtml(server.font, theme));
      assert.equal(preloads.length, 1, theme);
      assert.ok(preloads[0].includes(`href="${server.href}"`));
      assert.ok(preloads[0].includes('as="font"'));
      assert.ok(preloads[0].includes('type="font/woff2"'));
      assert.ok(preloads[0].includes('crossorigin="anonymous"'));
    }
    for (const theme of ["dia", "rounded"]) assert.equal(plexPreloads(await documentHtml(server.font, theme)).length, 0, theme);
    assert.equal(plexPreloads(await documentHtml(server.font, "dia", true, false, true, "porcelain")).length, 0);
    assert.equal(plexPreloads(await documentHtml(server.font, "porcelain", true, false, true, "dia")).length, 1);
    for (const theme of ["amoled", "graphite", "porcelain", "dia", "rounded", "system"]) {
      assert.equal(plexPreloads(await documentHtml(server.font, theme, false, true)).length, 0, `board ${theme}`);
      assert.equal(plexPreloads(await documentHtml(server.font, theme, false)).length, 0, `no seed ${theme}`);
      assert.equal(plexPreloads(await documentHtml(server.font, theme, true, false, false)).length, 0, `seed flag off ${theme}`);
    }
  });
}

test("only the shared Plex invocation gets URL metadata; ambiguous Latin output fails closed", () => {
  const loader = require(loaderPath);
  for (const other of [{ ...request, import: "Inter" }, { ...request, path: "src/other-font.ts" }]) {
    let called = false;
    loader.call({ resourceQuery: `?${JSON.stringify(other)}`, callback: (error, css, map, meta) => {
      assert.ifError(error); assert.equal(css, "unchanged"); assert.equal(meta, null); called = true;
    } }, "unchanged", null, null);
    assert.equal(called, true);
  }
  for (const css of ["", "/* latin */\n@font-face { src: url(/one.woff2); }\n@font-face { src: url(/two.woff2); }"]) {
    assert.throws(() => loader.call({ resourceQuery: `?${JSON.stringify(request)}`, mode: "production" }, css, null,
      { ast: { root: postcss.parse(css) }, exports: [] }), /exactly one emitted Latin font URL/);
  }
  let fallback = false;
  loader.call({ resourceQuery: `?${JSON.stringify(request)}`, mode: "development", callback: () => { fallback = true; } }, "", null,
    { ast: { root: postcss.parse("") }, exports: [] });
  assert.equal(fallback, true);
});
