const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { NextRequest, NextResponse } = require("next/server");
const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { alias: { "@": path.join(root, "src") } });
const { normalizeThemePreference, resolveThemePreference, resolvedThemeDomMetadata, themeCookieSeedValue, themeOptions, availableThemeOptions } = jiti("../src/lib/themePreferences.ts");
const { buildThemeBootScript } = jiti("../src/lib/themeBootScript.ts");
const { seedResponseThemeCookie } = jiti("../src/lib/auth/themeCookie.ts");
const { getAllCommands } = jiti("../src/components/Modals/commands/HTC/AllCommands.ts");

const ts = require("typescript");

function load(file, mocks, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function("require", "exports", ...Object.keys(globals), code)((id) => {
    if (Object.hasOwn(mocks, id)) return { __esModule: true, ...mocks[id] };
    if (id === "react/jsx-runtime") return require(id);
    throw new Error(`Unexpected import: ${id}`);
  }, exports, ...Object.values(globals));
  return exports.default;
}

function boot(cookie, dark, enabled, width = 768) {
  const classes = new Set(["rounded", "rounded-dark", "system"]);
  const attributes = {};
  let color;
  vm.runInNewContext(buildThemeBootScript("theme", "porcelain", "amoled", enabled), {
    document: {
      get cookie() { return `theme=${cookie}`; },
      set cookie(_) { assert.fail("boot must preserve the saved cookie"); },
      documentElement: {
        classList: {
          add: (...values) => values.forEach(value => classes.add(value)),
          remove: (...values) => values.forEach(value => classes.delete(value)),
        },
        setAttribute: (key, value) => { attributes[key] = value; },
      },
      querySelector: () => ({ setAttribute: (_, value) => { color = value; } }),
    },
    window: { matchMedia: query => ({ matches: query === "(min-width: 768px)" ? width >= 768 : dark }) },
  });
  return { classes: [...classes], theme: attributes["data-theme"], color };
}

test("saved Material migrates to system at every width without changing the cookie", () => {
  assert.equal(availableThemeOptions(true, true).some(option => option.value === "rounded"), false);
  for (const width of [390, 767, 768, 1440]) for (const dark of [false, true]) {
    const theme = dark ? "amoled" : "porcelain";
    const metadata = resolvedThemeDomMetadata[theme];
    assert.equal(normalizeThemePreference("rounded", true), "system");
    assert.deepEqual(boot("rounded", dark, true, width), { classes: metadata.classes, theme, color: metadata.themeColor });
  }
});

test("retirement off restores Material only when its own flag permits it", () => {
  for (const rounded of [false, true]) {
    assert.equal(normalizeThemePreference("rounded", rounded, false), rounded ? "rounded" : "system");
    const commands = getAllCommands({ context: "Others" }, false, rounded, "", "", false, false, false, false).flatMap(group => group.commandLists);
    assert.equal(commands.some(command => command.key === "roundedTheme"), rounded);
  }
  const classes = new Set();
  const attributes = {};
  vm.runInNewContext(buildThemeBootScript("theme", "porcelain", "amoled", true, false), {
    document: { cookie: "theme=rounded", documentElement: { classList: { add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)) }, setAttribute: (key, value) => { attributes[key] = value; } } },
    window: { matchMedia: () => ({ matches: true }) },
  });
  assert.equal(attributes["data-theme"], "rounded-dark");
  assert.deepEqual([...classes], ["dark", "rounded", "rounded-dark"]);
});

test("flag-off renders a saved Material choice as system and keeps the cookie", () => {
  assert.equal(normalizeThemePreference("rounded"), "system");
  assert.equal(normalizeThemePreference("rounded", false), "system");
  assert.equal(themeCookieSeedValue("rounded"), undefined);
  for (const dark of [false, true]) {
    const theme = dark ? "amoled" : "porcelain";
    assert.equal(resolveThemePreference(normalizeThemePreference("rounded", false), dark ? "dark" : "light"), theme);
    assert.deepEqual(boot("rounded", dark, false), { classes: [...resolvedThemeDomMetadata[theme].classes], theme, color: resolvedThemeDomMetadata[theme].themeColor });
    const response = NextResponse.json({ ok: true });
    assert.equal(seedResponseThemeCookie(new NextRequest("https://app.hypertask.ai", { headers: { cookie: "theme=rounded" } }), response), false);
  }
});

test("legacy themes resolve consistently on each device", () => {
  for (const theme of ["porcelain", "graphite", "amoled", "dia"]) {
    for (const enabled of [false, true]) for (const width of [390, 767, 768, 1440]) for (const scheme of ["light", "dark"]) {
      const resolved = resolveThemePreference(normalizeThemePreference(theme, enabled), scheme);
      const metadata = resolvedThemeDomMetadata[resolved];
      assert.equal(themeCookieSeedValue(theme), undefined);
      assert.deepEqual(boot(theme, scheme === "dark", enabled, width), { classes: metadata.classes, theme: resolved, color: metadata.themeColor });
    }
  }
});

test("Material stays hidden in the command picker", () => {
  for (const enabled of [false, true]) {
    const commands = getAllCommands({ context: "Others" }, false, enabled, "", "", false, false, false, true).flatMap(group => group.commandLists);
    assert.equal(commands.some(command => command.key === "roundedTheme"), false);
  }
});

test("Rounded CSS cannot leak through Tailwind's pre-existing rounded utility class", () => {
  const css = require("postcss").parse(fs.readFileSync(path.join(root, "src/styles/tailwindThemes/rounded.css"), "utf8"));
  const selectors = [];
  css.walkRules(rule => selectors.push(...rule.selectors));
  const scoped = selector => /^\.rounded(?:-light\b|-dark\b|:where\(\.rounded-light, \.rounded-dark\)|\.rounded-(?:light|dark)\b)/.test(selector);
  assert.equal(scoped(".rounded button"), false);
  assert.equal(scoped("button"), false);
  assert.ok(selectors.length > 20);
  assert.ok(selectors.every(scoped), selectors.filter(selector => !scoped(selector)).join("\n"));
});

test("Rounded registry retains the feature default and exact small release risk", () => {
  const { default: definition } = jiti("../src/lib/flags/definitions/htpr-7328-rounded-theme.ts");
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, undefined);
  assert.deepEqual(definition.releaseRisk, { risk: "small", reason: "Adds one theme choice; other themes unchanged" });
});

test("component flag branches preserve theme choices, cookie reads and writes, and command results", () => {
  for (const enabled of [false, true]) for (const isMobile of [false, true]) {
    const appearance = load("src/components/Modals/Settings/AppearanceSection.tsx", {
      "@/hooks/useThemeVisibility": { useThemeVisibility: () => ({ restore: false, loaded: true }) },
      "@/hooks/useFlag": { useFlag: key => key === "htpr-8054-graphite-2" || enabled },
      "@/lib/contexts/mobileContext": { useMobileView: () => isMobile },
      "@/lib/flags/keys": { HTPR_7328_ROUNDED_THEME_FLAG: "htpr-7328-rounded-theme" },
      "@/lib/flags/definitions/htpr-8054-graphite-2": { HTPR_8054_GRAPHITE_2_FLAG: "htpr-8054-graphite-2" },
      "lucide-react": { Check: () => null },
      "@/hooks/MultiPages/HTC/useDarkMode": { default: () => ({ currentTheme: "system" }) },
      "@/lib/themePreferences": { themeOptions, availableThemeOptions },
      "@/utils/undoActions/helperFuncs": { cn: () => "" },
      "./SettingsCard": { default: "section" },
      "./SettingsSectionShell": { default: "section" },
    });
    const picker = appearance().props.children.props.children;
    assert.deepEqual(picker.props.options.map(option => option.value), ["porcelain", "amoled", "graphite-2"]);
    const source = fs.readFileSync(path.join(root, "src/components/Modals/commands/HTC/commands.tsx"), "utf8");
    const parsed = ts.createSourceFile("commands.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const names = new Set(["getCommands", "getThemeCommands", "getLegacyCommands"]);
    const statements = [];
    const visit = (node) => {
      if ((ts.isVariableStatement(node) && node.declarationList.declarations.some(item => names.has(item.name.getText(parsed)))) ||
          (ts.isIfStatement(node) && node.expression.getText(parsed) === "roundedEnabled || graphite2Enabled || visibility.restore || !visibility.loaded")) statements.push(node.getText(parsed));
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    assert.equal(statements.length, 4);
    const code = ts.transpileModule(statements.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const getCommands = new Function("useCallback", "getAllCommands", "roundedEnabled", "isMobile", "keepAiChatClosedKeywords", "aiChatAutoOpenCommandName", "blockerCommentEnabled", "shareKeyLabels", "removeImageGeneration", "graphite2Enabled", "visibility", `${code}; return getCommands;`)((callback) => callback, getAllCommands, enabled, isMobile, "", "", false, false, false, false, { restore: false, loaded: true });
    for (const options of [undefined, { context: "Others" }, { context: "Task", kanbanSelectAllEnabled: true }]) {
      assert.deepEqual(getCommands(options), getAllCommands(options, options?.kanbanSelectAllEnabled, enabled && !isMobile));
    }
    const loadingCommands = new Function("useCallback", "getAllCommands", "roundedEnabled", "isMobile", "keepAiChatClosedKeywords", "aiChatAutoOpenCommandName", "blockerCommentEnabled", "shareKeyLabels", "removeImageGeneration", "graphite2Enabled", "visibility", `${code}; return getCommands;`)((callback) => callback, getAllCommands, false, isMobile, "", "", false, false, false, false, { restore: false, loaded: false });
    const loadingKeys = loadingCommands({ context: "Others" }).flatMap(group => group.commandLists.map(command => command.key));
    for (const key of ["systemTheme", "lightTheme", "darkTheme", "amoledTheme", "paperTheme", "graphite2Theme", "roundedTheme"]) assert.equal(loadingKeys.includes(key), false);
    const dispatcherSource = fs.readFileSync(path.join(root, "src/components/commands.tsx"), "utf8");
    const dispatcher = ts.createSourceFile("commands.tsx", dispatcherSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let themeWriter;
    const findThemeWriter = (node) => {
      if (ts.isIfStatement(node) && node.expression.getText(dispatcher) === "!roundedEnabled || !graphite2Enabled") themeWriter = node.getText(dispatcher);
      ts.forEachChild(node, findThemeWriter);
    };
    findThemeWriter(dispatcher);
    assert.ok(themeWriter);
    const themeWriterCode = ts.transpileModule(`let switchCommandTheme = switchToTheme; ${themeWriter}; const write = switchCommandTheme;`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const write = new Function("roundedEnabled", "graphite2Enabled", "switchToTheme", `${themeWriterCode}; return write;`)(enabled, true, theme => normalizeThemePreference(theme, enabled));
    for (const option of themeOptions) assert.equal(write(option.value), normalizeThemePreference(option.value, enabled));
    for (const theme of [undefined, "unknown", "light", "dark", ...themeOptions.map(option => option.value)]) for (const dark of [false, true]) {
      let written;
      let refreshes = 0;
      let resolvedPreference;
      const useDarkMode = load("src/hooks/MultiPages/HTC/useDarkMode.tsx", {
        "next/navigation": { useRouter: () => ({ refresh: () => { refreshes++; } }) },
        "nookies": { parseCookies: () => ({ theme }), default: { set: (...args) => { written = args; } } },
        "react": { useEffect: () => {}, useState: () => [dark ? "dark" : "light", () => {}] },
        "@/hooks/useThemeVisibility": { useThemeVisibility: () => ({ restore: false, loaded: true }) },
      "@/hooks/useFlag": { useFlag: key => key === "htpr-8054-graphite-2" || enabled },
        "@/lib/contexts/mobileContext": { useMobileView: () => isMobile },
        "@/lib/flags/keys": { HTPR_7328_ROUNDED_THEME_FLAG: "htpr-7328-rounded-theme" },
      "@/lib/flags/definitions/htpr-8054-graphite-2": { HTPR_8054_GRAPHITE_2_FLAG: "htpr-8054-graphite-2" },
        "@/lib/themePreferences": {
          ...jiti("../src/lib/themePreferences.ts"),
          resolveThemePreference: (preference, scheme) => {
            resolvedPreference = preference;
            return resolveThemePreference(preference, scheme);
          },
        },
      });
      const hook = useDarkMode();
      const preference = normalizeThemePreference(theme, enabled);
      const expectedPreference = preference === "rounded" && isMobile ? "system" : preference;
      assert.equal(hook.currentTheme, preference);
      assert.equal(resolvedPreference, expectedPreference);
      const expectedTheme = resolveThemePreference(expectedPreference, dark ? "dark" : "light");
      assert.equal(hook.effectiveTheme, resolvedThemeDomMetadata[expectedTheme].classes.includes("dark") ? "dark" : "light");
      for (const option of themeOptions) {
        hook.switchToTheme(option.value);
        assert.deepEqual(written, [null, "theme", normalizeThemePreference(option.value, enabled) ?? "system", { maxAge: 600 * 60 * 24 * 7, path: "/" }]);
      }
      assert.equal(refreshes, themeOptions.length);
    }
  }
});

test("listener migrates saved themes on width and device scheme changes without rewriting cookies", () => {
  for (const enabled of [false, true]) for (const stored of ["rounded", ...themeOptions.map(option => option.value)]) {
    let cleanup;
    let observerCallback;
    let disconnected = false;
    const dark = { matches: false, addEventListener: (_, callback) => { dark.change = callback; }, removeEventListener: (_, callback) => { assert.equal(callback, dark.change); dark.change = undefined; } };
    const desktop = { ...dark, matches: false, addEventListener: (_, callback) => { desktop.change = callback; }, removeEventListener: (_, callback) => { assert.equal(callback, desktop.change); desktop.change = undefined; } };
    const classes = new Set(["dark", "rounded", "rounded-dark"]);
    const attributes = { "data-theme": "rounded-dark" };
    let color;
    const document = {
      get cookie() { return `theme=${stored}`; },
      set cookie(_) { assert.fail("listener must preserve the saved cookie"); },
      documentElement: {
        classList: {
          [Symbol.iterator]: () => classes.values(),
          contains: value => classes.has(value),
          add: (...values) => values.forEach(value => classes.add(value)),
          remove: (...values) => values.forEach(value => classes.delete(value)),
        },
        getAttribute: key => attributes[key],
        setAttribute: (key, value) => { attributes[key] = value; },
      },
      querySelector: () => ({ setAttribute: (_, value) => { color = value; } }),
    };
    const listener = load("src/lib/contexts/ThemeListener.tsx", {
      react: { useEffect: effect => { cleanup = effect(); } },
      "@/hooks/useThemeVisibility": { useThemeVisibility: () => ({ restore: false, loaded: true }) },
      "@/hooks/useFlag": { useFlag: key => key === "htpr-8054-graphite-2" || enabled, useFlagLoaded: () => true },
      "@/lib/flags/keys": { HTPR_7328_ROUNDED_THEME_FLAG: "htpr-7328-rounded-theme" },
      "@/lib/flags/definitions/htpr-8054-graphite-2": { HTPR_8054_GRAPHITE_2_FLAG: "htpr-8054-graphite-2" },
      "@/lib/themePreferences": jiti("../src/lib/themePreferences.ts"),
    }, {
      document,
      window: { matchMedia: query => query === "(min-width: 768px)" ? desktop : dark },
      MutationObserver: class {
        constructor(callback) { observerCallback = callback; }
        observe() {}
        disconnect() { disconnected = true; }
      },
    });
    const check = () => {
      const preference = normalizeThemePreference(stored, enabled);
      const theme = resolveThemePreference(preference === "rounded" && !desktop.matches ? "system" : preference, dark.matches ? "dark" : "light");
      assert.equal(attributes["data-theme"], theme);
      assert.deepEqual([...classes], resolvedThemeDomMetadata[theme].classes);
      assert.equal(color, resolvedThemeDomMetadata[theme].themeColor);
      assert.equal(document.cookie, `theme=${stored}`);
    };
    listener();
    check();
    for (const wide of [true, false, true]) {
      desktop.matches = wide;
      desktop.change();
      check();
      for (const scheme of [true, false]) {
        dark.matches = scheme;
        dark.change();
        check();
      }
    }
    classes.add("rounded-dark");
    attributes["data-theme"] = "rounded-dark";
    observerCallback();
    check();
    cleanup();
    assert.equal(desktop.change, undefined);
    assert.equal(dark.change, undefined);
    assert.equal(disconnected, true);
  }
});

test("restored Material follows its own switch even with Graphite 2 enabled", () => {
  const visibility = { restore: true, loaded: true, system: true, porcelain: true, graphite: true, amoled: true, dia: true };
  for (const enabled of [false, true]) {
    assert.equal(normalizeThemePreference("rounded", enabled, true, true), enabled ? "rounded" : "system");
    const options = availableThemeOptions(enabled, true, visibility);
    assert.equal(options.some(option => option.value === "rounded"), enabled);
    const commands = getAllCommands({ context: "Others" }, false, enabled, "", "", false, false, false, true, visibility).flatMap(group => group.commandLists);
    assert.equal(commands.some(command => command.key === "roundedTheme"), enabled);
  }
});

test("listener preserves the server theme until restoration switches load", () => {
  for (const loaded of [false, true]) {
    const attributes = { "data-theme": "graphite" };
    const classes = new Set(["dark", "graphite"]);
    let writes = 0;
    const media = { matches: false, addEventListener() {}, removeEventListener() {} };
    const document = {
      get cookie() { return "theme=graphite"; },
      set cookie(_) { assert.fail("listener must not write cookies"); },
      documentElement: {
        classList: { [Symbol.iterator]: () => classes.values(), contains: value => classes.has(value), add: (...values) => values.forEach(value => classes.add(value)), remove: (...values) => values.forEach(value => classes.delete(value)) },
        getAttribute: key => attributes[key],
        setAttribute: (key, value) => { writes++; attributes[key] = value; },
      },
      querySelector: () => null,
    };
    const listener = load("src/lib/contexts/ThemeListener.tsx", {
      react: { useEffect: effect => effect() },
      "@/hooks/useThemeVisibility": { useThemeVisibility: () => ({ restore: true, loaded, system: true, porcelain: true, graphite: false, amoled: true, dia: true }) },
      "@/hooks/useFlag": { useFlag: () => true, useFlagLoaded: () => true },
      "@/lib/flags/keys": { HTPR_7328_ROUNDED_THEME_FLAG: "rounded" },
      "@/lib/flags/definitions/htpr-8054-graphite-2": { HTPR_8054_GRAPHITE_2_FLAG: "graphite2" },
      "@/lib/themePreferences": jiti("../src/lib/themePreferences.ts"),
    }, { document, window: { matchMedia: () => media }, MutationObserver: class { observe() {} disconnect() {} } });
    listener();
    assert.equal(attributes["data-theme"], loaded ? "porcelain" : "graphite");
    assert.equal(writes, loaded ? 1 : 0);
    assert.equal(document.cookie, "theme=graphite");
  }
});
