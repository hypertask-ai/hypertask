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

const { PLEX_LATIN_FONT_HREF } = loadTs("src/lib/fonts/ibmPlexSans.ts", { "next/font/google": { IBM_Plex_Sans: () => ({}) } });

test("the Plex latin preload is one emitted font file", () => {
  assert.match(PLEX_LATIN_FONT_HREF, /^\/_next\/static\/media\/[0-9a-f]+-s\.woff2$/);
});

async function documentHtml(theme, ticket = true, board = false, enabled = true, displayTheme = theme) {
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
    "@/lib/fonts/ibmPlexSans": { ibmPlexSans: plainFont, PLEX_LATIN_FONT_HREF },
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

test("a cached ticket shell preloads the Plex latin file for the three Plex themes", async () => {
  for (const theme of ["amoled", "graphite", "porcelain"]) {
    const preloads = plexPreloads(await documentHtml(theme));
    assert.equal(preloads.length, 1, theme);
    assert.ok(preloads[0].includes(`href="${PLEX_LATIN_FONT_HREF}"`), theme);
    assert.ok(preloads[0].includes('as="font"'), theme);
    assert.ok(preloads[0].includes('type="font/woff2"'), theme);
    assert.ok(preloads[0].includes('crossorigin="anonymous"'), theme);
  }
});

test("no Plex preload when the theme does not use it or the shell is not the first screen", async () => {
  for (const theme of ["dia", "rounded", "system"]) {
    assert.equal(plexPreloads(await documentHtml(theme)).length, 0, theme);
  }
  assert.equal(plexPreloads(await documentHtml("dia", true, false, true, "porcelain")).length, 0, "displayed theme");
  assert.equal(plexPreloads(await documentHtml("porcelain", true, false, true, "dia")).length, 1, "displayed theme");
  for (const theme of ["amoled", "graphite", "porcelain", "dia", "rounded", "system"]) {
    assert.equal(plexPreloads(await documentHtml(theme, false, true)).length, 0, `board ${theme}`);
    assert.equal(plexPreloads(await documentHtml(theme, false)).length, 0, `no seed ${theme}`);
    assert.equal(plexPreloads(await documentHtml(theme, true, false, false)).length, 0, `seed flag off ${theme}`);
  }
});
