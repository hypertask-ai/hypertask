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

function boot(cookie, dark, enabled) {
  const classes = new Set(["rounded", "rounded-dark", "system"]);
  const attributes = {};
  let color;
  vm.runInNewContext(buildThemeBootScript("theme", "porcelain", "amoled", enabled), {
    document: {
      cookie: `theme=${cookie}`,
      documentElement: {
        classList: {
          add: (...values) => values.forEach(value => classes.add(value)),
          remove: (...values) => values.forEach(value => classes.delete(value)),
        },
        setAttribute: (key, value) => { attributes[key] = value; },
      },
      querySelector: () => ({ setAttribute: (_, value) => { color = value; } }),
    },
    window: { matchMedia: () => ({ matches: dark }) },
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
    for (const enabled of [false, true]) for (const scheme of ["light", "dark"]) {
      assert.equal(normalizeThemePreference(theme, enabled), theme);
      assert.equal(resolveThemePreference(theme, scheme), theme);
      assert.equal(themeCookieSeedValue(theme), undefined);
      assert.deepEqual(boot(theme, scheme === "dark", enabled), { classes: metadata.classes, theme, color: metadata.themeColor });
    }
  }
});

test("both theme pickers and the live listener use the ticket flag; server render gates the cookie", () => {
  for (const enabled of [false, true]) {
    const commands = getAllCommands({ context: "Others" }, false, false, enabled).flatMap(group => group.commandLists);
    assert.equal(commands.some(command => command.key === "roundedTheme"), enabled);
  }
  const appearance = fs.readFileSync(path.join(root, "src/components/Modals/Settings/AppearanceSection.tsx"), "utf8");
  assert.match(appearance, /useFlag\(HTPR_7328_ROUNDED_THEME_FLAG\)/);
  assert.match(appearance, /roundedEnabled\s*\? themeOptions\s*: themeOptions\.filter\(\(\{ value \}\) => value !== "rounded"\)/);
  const layout = fs.readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");
  assert.match(layout, /isFeatureEnabled\(HTPR_7328_ROUNDED_THEME_FLAG, analyticsSession\?\.id \?\? -1\)/);
  assert.match(layout, /roundedEnabled\s*\? normalizeThemePreference\(theme.value, true\)\s*: normalizeThemePreference\(theme.value\)/);
  assert.match(layout, /systemDarkTheme,\s*roundedEnabled,/);
  const listener = fs.readFileSync(path.join(root, "src/lib/contexts/ThemeListener.tsx"), "utf8");
  assert.match(listener, /normalizeThemePreference\(stored, roundedEnabled\)/);
  assert.match(listener, /\[roundedEnabled, roundedLoaded\]/);
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

test("Material task boxes beat the task box outline layer and the listener restores the device scheme after a server refresh", () => {
  const css = fs.readFileSync(path.join(root, "src/styles/tailwindThemes/rounded.css"), "utf8");
  const layered = css.match(/@layer bootstrap \{\s*(\.rounded:where\(\.rounded-light, \.rounded-dark\)\[data-task-box-outlines\][^{]+)\{([^}]+)\}/);
  assert.ok(layered, "the override must share the outline rule's bootstrap layer");
  for (const target of [".description-container", "[data-task-comment-box]", "[data-task-properties-rail]", '#comment[data-testid="comment-composer"]']) {
    assert.ok(layered[1].includes(target), target);
  }
  assert.match(layered[2], /border-radius: var\(--m3-li\) !important/);
  assert.match(layered[2], /outline-style: none !important/);
  assert.match(css, /--bg-taskDetail-container: var\(--m3-surface\)/);
  const listener = fs.readFileSync(path.join(root, "src/lib/contexts/ThemeListener.tsx"), "utf8");
  assert.match(listener, /new MutationObserver\(applyTheme\)/);
  assert.match(listener, /attributeFilter: \["class", "data-theme"\]/);
  assert.match(listener, /if \(alreadyApplied\) return;/);
});

test("component flag branches preserve theme choices, cookie reads and writes, and command results", () => {
  const ts = require("typescript");
  const load = (file, mocks) => {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    new Function("require", "exports", code)((id) => {
      if (Object.hasOwn(mocks, id)) return { __esModule: true, ...mocks[id] };
      if (id === "react/jsx-runtime") return require(id);
      throw new Error(`Unexpected import: ${id}`);
    }, exports);
    return exports.default;
  };
  for (const enabled of [false, true]) {
    const appearance = load("src/components/Modals/Settings/AppearanceSection.tsx", {
      "@/hooks/useFlag": { useFlag: () => enabled },
      "@/lib/flags/keys": { HTPR_7328_ROUNDED_THEME_FLAG: "htpr-7328-rounded-theme" },
      "lucide-react": { Check: () => null },
      "@/hooks/MultiPages/HTC/useDarkMode": { default: () => ({ currentTheme: "system" }) },
      "@/lib/themePreferences": { themeOptions },
      "@/utils/undoActions/helperFuncs": { cn: () => "" },
      "./SettingsCard": { default: "section" },
      "./SettingsSectionShell": { default: "section" },
    });
    const picker = appearance().props.children.props.children;
    assert.deepEqual(picker.props.options, themeOptions.filter(({ value }) => value !== "rounded" || enabled));
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
    for (const agentLogNameEnabled of [false, true]) {
      const getCommands = new Function("useCallback", "getAllCommands", "roundedEnabled", "agentLogNameEnabled", `${code}; return getCommands;`)((callback) => callback, getAllCommands, enabled, agentLogNameEnabled);
      for (const options of [undefined, { context: "Others" }, { context: "Task", kanbanSelectAllEnabled: true }]) {
        assert.deepEqual(getCommands(options), getAllCommands(options, agentLogNameEnabled, options?.kanbanSelectAllEnabled, enabled));
      }
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
    for (const theme of [undefined, "unknown", "light", "dark", ...themeOptions.map(option => option.value)]) {
      let written;
      let refreshes = 0;
      const useDarkMode = load("src/hooks/MultiPages/HTC/useDarkMode.tsx", {
        "next/navigation": { useRouter: () => ({ refresh: () => { refreshes++; } }) },
        "nookies": { parseCookies: () => ({ theme }), default: { set: (...args) => { written = args; } } },
        "react": { useEffect: () => {}, useState: value => [value, () => {}] },
        "@/hooks/useFlag": { useFlag: () => enabled },
        "@/lib/flags/keys": { HTPR_7328_ROUNDED_THEME_FLAG: "htpr-7328-rounded-theme" },
        "@/lib/themePreferences": jiti("../src/lib/themePreferences.ts"),
      });
      const hook = useDarkMode();
      assert.equal(hook.currentTheme, normalizeThemePreference(theme, enabled));
      for (const option of themeOptions) {
        hook.switchToTheme(option.value);
        assert.deepEqual(written, [null, "theme", normalizeThemePreference(option.value, enabled) ?? "system", { maxAge: 600 * 60 * 24 * 7, path: "/" }]);
      }
      assert.equal(refreshes, themeOptions.length);
    }
  }
});
