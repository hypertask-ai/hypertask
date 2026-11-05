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
  vm.runInNewContext(buildThemeBootScript("theme", "porcelain", "amoled", true, enabled), {
    document: dom.window.document,
    window: { matchMedia: query => ({ matches: query === "(min-width: 768px)" ? true : dark }) },
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

test("legacy cookies migrate identically before and after hydration", () => {
  for (const enabled of [false, true]) for (const dark of [false, true]) {
    for (const theme of ["light", "dark", "graphite", "dia", "rounded", "system", "unknown", "toString"]) {
      const preference = preferences.normalizeThemePreference(theme, true, enabled);
      const expected = preferences.resolveThemePreference(preference, dark ? "dark" : "light");
      const document = boot(theme, enabled, dark);
      assert.equal(document.documentElement.dataset.theme, expected, `${theme} ${enabled} ${dark}`);
      assert.equal(document.cookie, `theme=${theme}`);
    }
  }
});

test("Appearance picker shows Graphite 2 only when enabled and selects the saved choice", () => {
  for (const enabled of [false, true]) for (const [currentTheme, effectiveTheme, selected] of [
    ["graphite-2", undefined, enabled ? "Graphite 2" : undefined],
    ["system", "dark", enabled ? "AMOLED" : "Follow system"],
    ["system", "light", enabled ? "Light" : "Follow system"],
    [undefined, "dark", enabled ? "AMOLED" : "Follow system"],
    [undefined, "light", enabled ? "Light" : "Follow system"],
  ]) {
    const writes = [];
    const { default: Appearance } = load("src/components/Modals/Settings/AppearanceSection.tsx", {
      "@/lib/flags/definitions/htpr-8054-graphite-2": { HTPR_8054_GRAPHITE_2_FLAG: flag },
      "@/hooks/useThemeVisibility": { useThemeVisibility: () => ({ restore: false, loaded: true }) },
      "@/hooks/useFlag": { useFlag: key => key === flag && enabled },
      "@/lib/flags/keys": {},
      "@/lib/contexts/mobileContext": { useMobileView: () => false },
      "lucide-react": { Check: "check" },
      "@/hooks/MultiPages/HTC/useDarkMode": { default: () => ({ currentTheme, effectiveTheme, switchToTheme: value => writes.push(value) }) },
      "@/lib/themePreferences": preferences,
      "@/utils/undoActions/helperFuncs": { cn: (...classes) => classes.filter(Boolean).join(" ") },
      "./SettingsCard": { default: "section" },
      "./SettingsSectionShell": { default: "section" },
    });
    const picker = Appearance().props.children.props.children;
    const rows = picker.type(picker.props).props.children;
    const row = rows.find(row => row.props.children[0].props.children === "Graphite 2");
    assert.equal(Boolean(row), enabled);
    assert.deepEqual(rows.map(row => row.props.children[0].props.children), enabled ? ["Light", "AMOLED", "Graphite 2"] : ["Follow system", "Light · Porcelain", "Dark · Graphite", "OLED black · AMOLED", "Paper · Dia"]);
    assert.deepEqual(rows.filter(row => row.props.className.includes("bg-active-modal-element")).map(row => row.props.children[0].props.children), selected ? [selected] : []);
    if (enabled) {
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
      "@/hooks/useThemeVisibility": { useThemeVisibility: () => ({ restore: false, loaded: true }) },
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
  assert.deepEqual(on.filter(item => item.key.endsWith("Theme")).map(item => item.name), ["Light", "AMOLED", "Graphite 2"]);
  assert.deepEqual(off.filter(item => item.key.endsWith("Theme")).map(item => item.name), ["Follow system", "Light · Porcelain", "Dark · Graphite", "OLED black · AMOLED", "Paper · Dia"]);
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
  for (const [property, expected] of Object.entries({ "--bg-pageBackground": "#17181b", "--bg-sidebar": "#17181b", "--bg-cardBackground": "#1f2125", "--bg-hover-active": "#26282d", "--color-border-comment-description": "#2a2c31", "--color-white-black": "#ececed", "--color-text-light-gray": "#9a9ca1", "--color-text-quiet": "#6c6f74", "--bg-label-span": "#6c6f74" })) {
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

test("Graphite 2 keeps labels transparent and shared backgrounds visible", async () => {
  const { compile } = require("@tailwindcss/node");
  const { chromium } = require("@playwright/test");
  const options = { base: root, onDependency() {} };
  const utilities = await compile('@import "./src/styles/tailwind-entry.css";', options);
  const theme = await compile('@import "./src/styles/tailwindThemes/graphite-2.css";', options);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<html class="graphite-2"><head><style>${utilities.build(["bg-label-span"])}${theme.build([])}</style></head><body>
      <div id="handle" class="bg-label-span"></div>
      <div id="pill" class="label-pill bg-label-span"></div>
      <div data-task-properties-rail><div id="property" class="bg-label-span"></div></div>
    </body></html>`);
    const colors = await page.evaluate(() => ["handle", "pill", "property"].map(id => getComputedStyle(document.getElementById(id)).backgroundColor));
    assert.equal(colors[0], "rgb(108, 111, 116)");
    assert.deepEqual(colors.slice(1), ["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]);
  } finally {
    await browser.close();
  }
});

test("server document gates Graphite 2 without changing other saved themes", async () => {
  const unused = [
    "@/styles/globals.scss", "@/styles/tailwindThemes/rounded.css", "@/styles/tailwindThemes/graphite-2.css", "../../tokens.css",
    "@/utils/Providers", "@/hooks/useFlag", "@/components/Analytics/PostHogAnalytics", "@vercel/speed-insights/next",
    "@/components/ErrorBoundary/ClientErrorReporter", "@/lib/ai/AiChipEventRecorder", "@/components/System/DeploySkewGuard",
    "@/components/FilesImageFallback", "@/lib/ticketSidebarBoot",
  ];
  for (const [theme, off, on, restored] of [
    ["graphite-2", "system", "graphite-2", "graphite-2"],
    ["graphite", "graphite", "graphite-2", "graphite"],
    ["porcelain", "porcelain", "porcelain", "porcelain"],
    ["amoled", "amoled", "amoled", "amoled"],
    ["dia", "dia", "porcelain", "dia"],
  ]) for (const [enabled, restore, expected] of [[false, false, off], [true, false, on], [true, true, restored]]) {
    const { default: RootLayout } = load("src/app/layout.tsx", {
      ...Object.fromEntries(unused.map(name => [name, {}])),
      "next/headers": { cookies: async () => ({ get: name => name === "theme" ? { value: theme } : undefined }) },
      "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: () => ({ id: 985 }) },
      "@/lib/flags": { isFeatureEnabled: async key => key === flag ? enabled : key.startsWith("htpr-8710-") && restore },
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
    assert.equal(document.props["data-theme"], expected);
    assert.equal(document.props.className.split(" ")[0], expected === "system" ? "system" : ["porcelain", "dia"].includes(expected) ? "light" : "dark");
  }
});

test("command entry refuses disabled themes while preserving every allowed choice", () => {
  for (const enabled of [false, true]) for (const rounded of [false, true]) {
    const writes = [];
    let dispatch;
    const { default: Commands } = load("src/components/commands.tsx", {
      "@/hooks/useThemeVisibility": { useThemeVisibility: () => ({ restore: false, loaded: true }) },
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

test("restored appearance and cookie writes respect each independent switch", () => {
  for (const enabled of [false, true]) {
    const visibility = { restore: true, loaded: true, system: true, porcelain: true, graphite: enabled, amoled: true, dia: true };
    const writes = [];
    const { default: Appearance } = load("src/components/Modals/Settings/AppearanceSection.tsx", {
      "@/hooks/useThemeVisibility": { useThemeVisibility: () => visibility },
      "@/hooks/useFlag": { useFlag: () => true },
      "@/lib/contexts/mobileContext": { useMobileView: () => false },
      "lucide-react": { Check: "check" },
      "@/hooks/MultiPages/HTC/useDarkMode": { default: () => ({ currentTheme: "graphite", effectiveTheme: "dark", switchToTheme: value => writes.push(value) }) },
      "@/lib/themePreferences": preferences,
      "@/utils/undoActions/helperFuncs": { cn: (...classes) => classes.filter(Boolean).join(" ") },
      "./SettingsCard": { default: "section" }, "./SettingsSectionShell": { default: "section" },
    });
    const picker = Appearance().props.children.props.children;
    assert.equal(picker.props.options.some(option => option.value === "graphite"), enabled);
    const { default: hook } = load("src/hooks/MultiPages/HTC/useDarkMode.tsx", {
      "@/hooks/useThemeVisibility": { useThemeVisibility: () => visibility },
      "@/hooks/useFlag": { useFlag: () => true },
      "@/lib/contexts/mobileContext": { useMobileView: () => false },
      "next/navigation": { useRouter: () => ({ refresh() {} }) },
      nookies: { parseCookies: () => ({ theme: "graphite" }), default: { set: (...args) => writes.push(args[2]) } },
      react: { useEffect() {}, useState: () => ["dark"] },
      "@/lib/themePreferences": preferences,
    });
    const result = hook();
    assert.deepEqual(writes, []);
    result.switchToTheme("graphite");
    assert.deepEqual(writes, enabled ? ["graphite"] : []);
  }
});

test("dark toggle chooses an available opposite theme and never writes while loading", () => {
  const base = { restore: true, loaded: true, system: false, porcelain: false, graphite: false, amoled: false, dia: false };
  for (const { visibility, theme, system, graphite2 = false, expected } of [
    { visibility: { ...base, graphite: true }, theme: "porcelain", system: "light", expected: "graphite" },
    { visibility: { ...base, dia: true }, theme: "amoled", system: "dark", expected: "dia" },
    { visibility: base, theme: "porcelain", system: "light", graphite2: true, expected: "graphite-2" },
    { visibility: { ...base, system: true, amoled: true }, theme: "amoled", system: "light", expected: "system" },
    { visibility: { ...base, porcelain: true }, theme: "porcelain", system: "light" },
    { visibility: { ...base, loaded: false, graphite: true }, theme: "porcelain", system: "light" },
    { visibility: { ...base, restore: false, loaded: false }, theme: "porcelain", system: "light" },
    { visibility: { ...base, restore: false }, theme: "porcelain", system: "light", expected: "amoled" },
  ]) {
    const writes = [];
    let refreshes = 0;
    const { default: hook } = load("src/hooks/MultiPages/HTC/useDarkMode.tsx", {
      "@/hooks/useThemeVisibility": { useThemeVisibility: () => visibility },
      "@/hooks/useFlag": { useFlag: key => key === flag && graphite2 },
      "@/lib/contexts/mobileContext": { useMobileView: () => false },
      "next/navigation": { useRouter: () => ({ refresh: () => refreshes++ }) },
      nookies: { parseCookies: () => ({ theme }), default: { set: (_ctx, _key, value) => writes.push(value) } },
      react: { useEffect() {}, useState: () => [system] },
      "@/lib/themePreferences": preferences,
    });
    const result = hook();
    result.toggleDarkModeHandler();
    if (!visibility.loaded) result.switchToTheme("porcelain");
    assert.deepEqual(writes, expected ? [expected] : []);
    assert.equal(refreshes, expected ? 1 : 0);
  }
});

test("appearance picker and theme commands wait for visibility and show only enabled choices", () => {
  for (const visibility of [
    { restore: false, loaded: false },
    { restore: true, loaded: false, system: true, porcelain: true, graphite: false, amoled: true, dia: false },
    { restore: true, loaded: true, system: true, porcelain: true, graphite: false, amoled: true, dia: false },
  ]) {
    const { default: Appearance } = load("src/components/Modals/Settings/AppearanceSection.tsx", {
      "@/hooks/useThemeVisibility": { useThemeVisibility: () => visibility },
      "@/hooks/useFlag": { useFlag: () => false },
      "@/lib/contexts/mobileContext": { useMobileView: () => false },
      "lucide-react": { Check: "check" },
      "@/hooks/MultiPages/HTC/useDarkMode": { default: () => ({ currentTheme: "system", effectiveTheme: "light", switchToTheme() {} }) },
      "@/lib/themePreferences": preferences,
      "@/utils/undoActions/helperFuncs": { cn: (...classes) => classes.filter(Boolean).join(" ") },
      "./SettingsCard": { default: "section" }, "./SettingsSectionShell": { default: "section" },
    });
    const picker = Appearance().props.children.props.children;
    const values = picker.props.options.map(option => option.value);
    assert.deepEqual(values, visibility.loaded ? ["system", "porcelain", "amoled"] : []);
    const keys = getAllCommands({ context: "Others" }, false, false, "", "", false, false, false, false, visibility)
      .flatMap(group => group.commandLists).map(command => command.key);
    assert.deepEqual(["systemTheme", "lightTheme", "darkTheme", "amoledTheme", "paperTheme"].filter(key => keys.includes(key)),
      visibility.loaded ? ["systemTheme", "lightTheme", "amoledTheme"] : []);
  }
});
