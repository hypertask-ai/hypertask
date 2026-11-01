const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { NextRequest, NextResponse } = require("next/server");
const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { alias: { "@": path.join(root, "src") } });
const { normalizeThemePreference, resolveThemePreference, resolvedThemeDomMetadata, themeCookieSeedValue, themeOptions } = jiti("../src/lib/themePreferences.ts");
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

test("Rounded follows device light and dark with exact DOM metadata and no first-paint flash", () => {
  assert.deepEqual(themeOptions.at(-1), { title: "Material (follows device)", value: "rounded" });
  for (const scheme of ["light", "dark"]) {
    const theme = `rounded-${scheme}`;
    assert.equal(resolveThemePreference("rounded", scheme), theme);
    assert.equal(normalizeThemePreference("rounded", true), "rounded");
    const metadata = { classes: [scheme, "rounded", theme], themeColor: scheme === "light" ? "#fcfcfc" : "#000000" };
    assert.deepEqual(resolvedThemeDomMetadata[theme], metadata);
    assert.deepEqual(boot("rounded", scheme === "dark", true), { classes: metadata.classes, theme, color: metadata.themeColor });
  }
});

test("saved Material resolves as system below 768px and as Material from 768px without changing the cookie", () => {
  for (const width of [390, 767, 768, 1440]) for (const dark of [false, true]) {
    const theme = width < 768 ? (dark ? "amoled" : "porcelain") : (dark ? "rounded-dark" : "rounded-light");
    const metadata = resolvedThemeDomMetadata[theme];
    assert.deepEqual(boot("rounded", dark, true, width), { classes: metadata.classes, theme, color: metadata.themeColor });
  }
});

test("flag-off renders a saved Material choice as system and keeps the cookie for when the flag returns", () => {
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

test("all four old themes preserve resolution and boot output regardless of flag and device", () => {
  const expected = {
    porcelain: { classes: ["light", "porcelain"], themeColor: "#ffffff" },
    graphite: { classes: ["dark", "graphite"], themeColor: "#232326" },
    amoled: { classes: ["dark", "amoled"], themeColor: "#000000" },
    dia: { classes: ["light", "dia"], themeColor: "#f6f4ef" },
  };
  for (const [theme, metadata] of Object.entries(expected)) {
    assert.deepEqual(resolvedThemeDomMetadata[theme], metadata);
    for (const enabled of [false, true]) for (const width of [390, 767, 768, 1440]) for (const scheme of ["light", "dark"]) {
      assert.equal(normalizeThemePreference(theme, enabled), theme);
      assert.equal(resolveThemePreference(theme, scheme), theme);
      assert.equal(themeCookieSeedValue(theme), undefined);
      assert.deepEqual(boot(theme, scheme === "dark", enabled, width), { classes: metadata.classes, theme, color: metadata.themeColor });
    }
  }
});

test("both theme pickers and the live listener use the ticket flag; server render gates the cookie", () => {
  for (const enabled of [false, true]) {
    const commands = getAllCommands({ context: "Others" }, false, enabled).flatMap(group => group.commandLists);
    assert.equal(commands.some(command => command.key === "roundedTheme"), enabled);
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
      "@/hooks/useFlag": { useFlag: () => enabled },
      "@/lib/contexts/mobileContext": { useMobileView: () => isMobile },
      "@/lib/flags/keys": { HTPR_7328_ROUNDED_THEME_FLAG: "htpr-7328-rounded-theme" },
      "lucide-react": { Check: () => null },
      "@/hooks/MultiPages/HTC/useDarkMode": { default: () => ({ currentTheme: "system" }) },
      "@/lib/themePreferences": { themeOptions },
      "@/utils/undoActions/helperFuncs": { cn: () => "" },
      "./SettingsCard": { default: "section" },
      "./SettingsSectionShell": { default: "section" },
    });
    const picker = appearance().props.children.props.children;
    assert.deepEqual(picker.props.options, themeOptions.filter(({ value }) => value !== "rounded" || (enabled && !isMobile)));
    const source = fs.readFileSync(path.join(root, "src/components/Modals/commands/HTC/commands.tsx"), "utf8");
    const parsed = ts.createSourceFile("commands.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const names = new Set(["getCommands", "getRoundedCommands", "getLegacyCommands"]);
    const statements = [];
    const visit = (node) => {
      if ((ts.isVariableStatement(node) && node.declarationList.declarations.some(item => names.has(item.name.getText(parsed)))) ||
          (ts.isIfStatement(node) && node.expression.getText(parsed) === "roundedEnabled")) statements.push(node.getText(parsed));
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    assert.equal(statements.length, 4);
    const code = ts.transpileModule(statements.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const getCommands = new Function("useCallback", "getAllCommands", "roundedEnabled", "isMobile", "keepAiChatClosedKeywords", "aiChatAutoOpenCommandName", "blockerCommentEnabled", "shareKeyLabels", "removeImageGeneration", `${code}; return getCommands;`)((callback) => callback, getAllCommands, enabled, isMobile, "", "", false, false, false);
    for (const options of [undefined, { context: "Others" }, { context: "Task", kanbanSelectAllEnabled: true }]) {
      assert.deepEqual(getCommands(options), getAllCommands(options, options?.kanbanSelectAllEnabled, enabled && !isMobile));
    }
    const dispatcherSource = fs.readFileSync(path.join(root, "src/components/commands.tsx"), "utf8");
    const dispatcher = ts.createSourceFile("commands.tsx", dispatcherSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let themeWriter;
    const findThemeWriter = (node) => {
      if (ts.isIfStatement(node) && node.expression.getText(dispatcher) === "!roundedEnabled") themeWriter = node.getText(dispatcher);
      ts.forEachChild(node, findThemeWriter);
    };
    findThemeWriter(dispatcher);
    assert.ok(themeWriter);
    const themeWriterCode = ts.transpileModule(`let switchCommandTheme = switchToTheme; ${themeWriter}; const write = switchCommandTheme;`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const write = new Function("roundedEnabled", "switchToTheme", `${themeWriterCode}; return write;`)(enabled, theme => normalizeThemePreference(theme, enabled));
    for (const option of themeOptions) assert.equal(write(option.value), normalizeThemePreference(option.value, enabled));
    for (const theme of [undefined, "unknown", "light", "dark", ...themeOptions.map(option => option.value)]) for (const dark of [false, true]) {
      let written;
      let refreshes = 0;
      let resolvedPreference;
      const useDarkMode = load("src/hooks/MultiPages/HTC/useDarkMode.tsx", {
        "next/navigation": { useRouter: () => ({ refresh: () => { refreshes++; } }) },
        "nookies": { parseCookies: () => ({ theme }), default: { set: (...args) => { written = args; } } },
        "react": { useEffect: () => {}, useState: () => [dark ? "dark" : "light", () => {}] },
        "@/hooks/useFlag": { useFlag: () => enabled },
        "@/lib/contexts/mobileContext": { useMobileView: () => isMobile },
        "@/lib/flags/keys": { HTPR_7328_ROUNDED_THEME_FLAG: "htpr-7328-rounded-theme" },
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

test("listener reapplies Material or system on width and device scheme changes without rewriting saved preferences", () => {
  for (const enabled of [false, true]) for (const stored of themeOptions.map(option => option.value)) {
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
      "@/hooks/useFlag": { useFlag: () => enabled, useFlagLoaded: () => true },
      "@/lib/flags/keys": { HTPR_7328_ROUNDED_THEME_FLAG: "htpr-7328-rounded-theme" },
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
