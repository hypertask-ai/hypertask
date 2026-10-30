const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { loadModule: load } = require("./helpers/loadModule.cjs");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { alias: { "@": path.join(root, "src") } });
const preferences = jiti("../src/lib/themePreferences.ts");
const { buildThemeBootScript } = jiti("../src/lib/themeBootScript.ts");
const { getAllCommands } = jiti("../src/components/Modals/commands/HTC/AllCommands.ts");
const { CommandMode } = jiti("../src/models/enums.ts");
const flag = "htpr-8054-graphite-2";

function boot(theme, enabled, dark) {
  const dom = new JSDOM('<html class="dark graphite"><head><meta name="theme-color" content="#232326"></head></html>', { url: "https://app.hypertask.ai" });
  dom.window.document.cookie = `theme=${theme}`;
  vm.runInNewContext(buildThemeBootScript("theme", "porcelain", "amoled", false, enabled), {
    document: dom.window.document,
    window: { matchMedia: () => ({ matches: dark }) },
  });
  return dom.window.document;
}

test("Graphite 2 restores before first paint, while rollback preserves its saved cookie", () => {
  for (const enabled of [false, true]) for (const dark of [false, true]) {
    const document = boot("graphite-2", enabled, dark);
    const expected = enabled ? "graphite-2" : dark ? "amoled" : "porcelain";
    assert.equal(document.documentElement.dataset.theme, expected);
    assert.deepEqual([...document.documentElement.classList], preferences.resolvedThemeDomMetadata[expected].classes);
    assert.equal(document.querySelector("meta").content, enabled ? "#17181b" : dark ? "#000000" : "#ffffff");
    assert.equal(document.cookie, "theme=graphite-2");
    assert.equal(preferences.normalizeThemePreference("graphite-2", false, enabled), enabled ? "graphite-2" : "system");
  }
});

test("the new flag does not change any old theme's first-paint result", () => {
  for (const theme of ["system", "porcelain", "graphite", "amoled", "dia"]) for (const dark of [false, true]) {
    const on = boot(theme, true, dark);
    const off = boot(theme, false, dark);
    assert.equal(on.documentElement.outerHTML, off.documentElement.outerHTML);
  }
});

test("Appearance picker shows Graphite 2 only when enabled and selects the saved choice", () => {
  for (const enabled of [false, true]) {
    const writes = [];
    const { default: Appearance } = load("src/components/Modals/Settings/AppearanceSection.tsx", {
      "@/lib/flags/definitions/htpr-8054-graphite-2": { HTPR_8054_GRAPHITE_2_FLAG: flag },
      "@/hooks/useFlag": { useFlag: key => key === flag && enabled },
      "@/lib/flags/keys": {},
      "@/lib/contexts/mobileContext": { useMobileView: () => false },
      "lucide-react": { Check: "check" },
      "@/hooks/MultiPages/HTC/useDarkMode": { default: () => ({ currentTheme: "graphite-2", switchToTheme: value => writes.push(value) }) },
      "@/lib/themePreferences": preferences,
      "@/utils/undoActions/helperFuncs": { cn: (...classes) => classes.filter(Boolean).join(" ") },
      "./SettingsCard": { default: "section" },
      "./SettingsSectionShell": { default: "section" },
    });
    const picker = Appearance().props.children.props.children;
    const rows = picker.type(picker.props).props.children;
    const row = rows.find(row => row.props.children[0].props.children === "Graphite 2");
    assert.equal(Boolean(row), enabled);
    assert.deepEqual(rows.filter(row => row.props.children[0].props.children !== "Graphite 2").map(row => row.props.children[0].props.children), ["Follow system", "Light · Porcelain", "Dark · Graphite", "OLED black · AMOLED", "Paper · Dia"]);
    if (enabled) {
      assert.ok(row.props.className.includes("bg-active-modal-element"));
      row.props.onClick();
      assert.deepEqual(writes, ["graphite-2"]);
    }
  }
});

test("theme hook gates cookie reads and writes independently of Material", () => {
  for (const enabled of [false, true]) for (const rounded of [false, true]) {
    let written;
    let refreshes = 0;
    const { default: useDarkMode } = load("src/hooks/MultiPages/HTC/useDarkMode.tsx", {
      "@/lib/flags/definitions/htpr-8054-graphite-2": { HTPR_8054_GRAPHITE_2_FLAG: flag },
      "@/lib/flags/keys": { HTPR_7328_ROUNDED_THEME_FLAG: "rounded" },
      "@/hooks/useFlag": { useFlag: key => key === flag ? enabled : rounded },
      "@/lib/contexts/mobileContext": { useMobileView: () => false },
      "next/navigation": { useRouter: () => ({ refresh: () => refreshes++ }) },
      nookies: { parseCookies: () => ({ theme: "graphite-2" }), default: { set: (...args) => written = args } },
      react: { useEffect: () => {}, useState: () => ["dark"] },
      "@/lib/themePreferences": preferences,
    });
    const hook = useDarkMode();
    assert.equal(hook.currentTheme, enabled ? "graphite-2" : "system");
    hook.switchToTheme("graphite-2");
    assert.equal(written[2], enabled ? "graphite-2" : "system");
    assert.deepEqual(written[3], { maxAge: 600 * 60 * 24 * 7, path: "/" });
    assert.equal(refreshes, 1);
  }
});

test("Ctrl+K adds one command beside Graphite, dispatches it, and keeps old command ids", () => {
  const commands = enabled => getAllCommands({ context: "Others" }, false, false, "", "", false, false, false, enabled).find(group => group.group === "Appearance").commandLists;
  const on = commands(true);
  const off = commands(false);
  const command = on.find(command => command.key === "graphite2Theme");
  assert.equal(command.name, "Graphite 2");
  assert.equal(on[on.findIndex(item => item.key === "darkTheme") + 1], command);
  assert.deepEqual(on.filter(item => item !== command), off);
  const writes = [];
  let closed = 0;
  const { createCommandDispatcher } = load("src/components/commandDispatcher.ts", {
    "@/models/enums": { CommandMode },
    "@/lib/agents/chatPaletteCommands": {},
    "@/hooks/Kanban/mobileBoardGestures": {},
    "react-hot-toast": {},
    "@/lib/constants": {},
    "@/lib/constants/aiEvents": {},
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": {},
    "@/lib/tours/types": {},
    "./Modals/Settings/settingsNavigation": {},
    "@/lib/snippets": {},
    "@/lib/timeQuickLog": {},
    "@/lib/aiChatDisplayMode": {},
  });
  createCommandDispatcher({ switchToTheme: value => writes.push(value), boardCloseHandler: () => closed++, setShowCommands: () => {}, setCommandMode: () => {} }).handleAction(command.commandMode);
  assert.deepEqual(writes, ["graphite-2"]);
  assert.equal(closed, 1);
  assert.equal(CommandMode.BlockerComment + 1, CommandMode.ArchiveColumn);
  assert.equal(CommandMode.ArchiveColumn + 1, CommandMode.ToggleGraphite2Theme);
});

test("Graphite 2 CSS is isolated and carries the approved palette", () => {
  const css = fs.readFileSync(path.join(root, "src/styles/tailwindThemes/graphite-2.css"), "utf8");
  const ast = require("postcss").parse(css);
  const selectors = [];
  ast.walkRules(rule => selectors.push(...rule.selectors));
  const scoped = selector => /^(?:html)?\.graphite-2(?:\s|$)/.test(selector);
  assert.equal(scoped(".graphite button"), false);
  assert.equal(scoped("button"), false);
  assert.ok(selectors.every(scoped));
  const dom = new JSDOM(`<style>${css}</style><main></main>`);
  const element = dom.window.document.documentElement;
  const style = () => dom.window.getComputedStyle(element);
  element.className = "graphite-2";
  assert.equal(style().getPropertyValue("--bg-newcomment-well"), "var(--bg-pageBackground)");
  assert.notEqual(style().getPropertyValue("--bg-pageBackground"), style().getPropertyValue("--bg-cardBackground"));
  for (const [property, expected] of Object.entries({ "--bg-pageBackground": "#17181b", "--bg-sidebar": "#17181b", "--bg-cardBackground": "#1f2125", "--bg-hover-active": "#26282d", "--color-border-comment-description": "#2a2c31", "--color-white-black": "#ececed", "--color-text-light-gray": "#9a9ca1", "--color-text-quiet": "#6c6f74", "--bg-label-span": "transparent" })) {
    assert.equal(style().getPropertyValue(property), expected, property);
    for (const theme of ["graphite", "porcelain", "amoled", "dia"]) {
      element.className = theme;
      assert.equal(style().getPropertyValue(property), "", `${theme} ${property}`);
    }
    element.className = "graphite-2";
  }
});

test("flag ships for Everyone with small reversible risk", () => {
  const { default: definition } = jiti("../src/lib/flags/definitions/htpr-8054-graphite-2.ts");
  assert.equal(definition.key, flag);
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.kind, "feature");
  assert.equal(definition.releaseRisk.risk, "small");
});


test("Graphite 2 stylesheet compiles its title size with the installed Tailwind version", async () => {
  const { compile } = require("@tailwindcss/node");
  const compiler = await compile('@import "./src/styles/tailwindThemes/graphite-2.css";', {
    base: root,
    onDependency() {},
  });
  const css = require("postcss").parse(compiler.build([]));
  const declarations = new Map();
  css.walkRules(".graphite-2 #title-input", rule => {
    rule.walkDecls(decl => declarations.set(decl.prop, { value: decl.value, important: decl.important }));
  });
  assert.deepEqual(declarations.get("font-size"), { value: "24px", important: true });
  assert.equal(declarations.get("font-weight").value, "600");
});

test("server document gates Graphite 2 without changing other saved themes", async () => {
  const unused = [
    "@/styles/globals.scss", "@/styles/tailwindThemes/rounded.css", "@/styles/tailwindThemes/graphite-2.css", "../../tokens.css",
    "@/utils/Providers", "@/hooks/useFlag", "@/components/Analytics/PostHogAnalytics", "@vercel/speed-insights/next",
    "@/components/ErrorBoundary/ClientErrorReporter", "@/lib/ai/AiChipEventRecorder", "@/components/System/DeploySkewGuard",
    "@/components/FilesImageFallback", "@/lib/ticketSidebarBoot",
  ];
  for (const enabled of [false, true]) for (const theme of ["graphite-2", "graphite", "porcelain", "amoled", "dia"]) {
    const { default: RootLayout } = load("src/app/layout.tsx", {
      ...Object.fromEntries(unused.map(name => [name, {}])),
      "next/headers": { cookies: async () => ({ get: name => name === "theme" ? { value: theme } : undefined }) },
      "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: () => ({ id: 985 }) },
      "@/lib/flags": { isFeatureEnabled: async key => key === flag && enabled },
      "@/utils/serverActions": { isMobileDevice: async () => ({ isMobile: false, isApple: false }) },
      "@/lib/configs/auth.config": { default: { cookies: { theme: "theme", defaultTheme: "system" } } },
      "@/lib/configs/general.config": { DIV_ID_CONSTANTS: { bodyLayout: "body-layout" } },
      "@/lib/fonts/inter": { inter: { variable: "inter", className: "inter" } },
      "@/lib/fonts/newsreader": { newsreader: { variable: "newsreader" }, NEWSREADER_LATIN_FONT_HREFS: [] },
      "@/lib/fonts/ibmPlexSans": { ibmPlexSans: { variable: "plex" } },
      "@/lib/themePreferences": preferences,
      "@/lib/themeBootScript": { buildThemeBootScript },
      "@/lib/appShellBootstrap/client": { buildEarlyAppShellBootstrapScript: () => "" },
      "@/lib/firstScreen/serverBoardDocument": { getServerBoardDocument: async () => null },
      "@/lib/firstScreen/serverInboxDocument": { getServerInboxDocument: async () => null },
      "@/lib/firstScreen/serverTicketShell": { getServerTicketShell: async () => null },
    });
    const document = await RootLayout({ children: "Existing page" });
    const expected = theme === "graphite-2" && !enabled ? "system" : theme;
    assert.equal(document.props["data-theme"], expected);
    assert.equal(document.props.className.split(" ")[0], expected === "system" ? "system" : ["porcelain", "dia"].includes(theme) ? "light" : "dark");
  }
});

test("command entry refuses disabled themes while preserving every allowed choice", () => {
  for (const enabled of [false, true]) for (const rounded of [false, true]) {
    const writes = [];
    let dispatch;
    const { default: Commands } = load("src/components/commands.tsx", {
      "@/hooks/useFlag": { useFlag: key => key === flag ? enabled : key === "rounded" && rounded },
      "@/lib/flags/keys": { HTPR_7328_ROUNDED_THEME_FLAG: "rounded" },
      react: { useEffect() {} },
      "./useCommandsState": { useCommandsState: () => ({ showCommands: { show: false }, currentUser: { id: 985 }, switchToTheme: theme => writes.push(theme) }) },
      "./boardCommandActions": { createBoardCommandActions: () => ({}) },
      "./generalCommandActions": { createGeneralCommandActions: () => ({}) },
      "./commandModalCallbacks": { createCommandModalCallbacks: () => ({}) },
      "./commandDispatcher": { createCommandDispatcher: context => { dispatch = context; return {}; } },
      "@/hooks/Kanban/useArchiveColumn": { useArchiveColumn: () => ({}) },
      "./commandModalPanels1": {}, "./commandModalPanels2": {}, "./commandModals": {},
      "./Modals/Common Modals/ConfirmDialog": {}, "./Modals/commands/HTC/AllCommands": {},
    });
    Commands({});
    for (const theme of ["graphite-2", "rounded", "graphite", "porcelain", "amoled", "dia", "system"]) dispatch.switchToTheme(theme);
    assert.deepEqual(writes, [enabled ? "graphite-2" : "system", rounded ? "rounded" : "system", "graphite", "porcelain", "amoled", "dia", "system"]);
  }
});
