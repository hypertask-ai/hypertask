const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { NextRequest, NextResponse } = require("next/server");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/theme-preferences-entry.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  },
);
const {
  nextThemeForDarkModeToggle,
  normalizeThemePreference,
  resolvedThemeDomMetadata,
  resolveInitialThemeColor,
  resolveThemePreference,
  themeCookieSeedValue,
  themeOptions,
} = jiti(path.join(root, "src/lib/themePreferences.ts"));
const authConfig = jiti(path.join(root, "src/lib/configs/auth.config.ts"));
const { seedResponseThemeCookie } = jiti(
  path.join(root, "src/lib/auth/themeCookie.ts"),
);
const { buildThemeBootScript } = jiti(
  path.join(root, "src/lib/themeBootScript.ts"),
);
const { getAllCommands } = jiti(
  path.join(root, "src/components/Modals/commands/HTC/AllCommands.ts"),
);

const expectedThemes = [
  { title: "Follow system", value: "system" },
  { title: "Light · Porcelain", value: "porcelain" },
  { title: "Dark · Graphite", value: "graphite" },
  { title: "OLED black · AMOLED", value: "amoled" },
  { title: "Paper · Dia", value: "dia" },
];

test("theme preferences use one clear label and order", () => {
  assert.deepEqual([...themeOptions], expectedThemes);
});

test("system mode follows the standard light and dark palettes", () => {
  assert.equal(resolveThemePreference("system", "light"), "porcelain");
  assert.equal(resolveThemePreference("system", "dark"), "amoled");
  assert.equal(resolveThemePreference(undefined, "dark"), "amoled");
  assert.equal(resolveThemePreference("amoled", "light"), "amoled");
});

test("new sessions use the system preference", () => {
  const defaultTheme = authConfig.default.cookies.defaultTheme;

  assert.equal(defaultTheme, "system");
  assert.equal(resolveThemePreference(defaultTheme, "light"), "porcelain");
  assert.equal(resolveThemePreference(defaultTheme, "dark"), "amoled");
});

test("legacy cookies remain compatible and invalid cookies fall back safely", () => {
  assert.equal(normalizeThemePreference("light"), "porcelain");
  assert.equal(normalizeThemePreference("dark"), "graphite");
  assert.equal(normalizeThemePreference("dia"), "dia");
  assert.equal(normalizeThemePreference("unknown"), undefined);
});

test("auth cookie seeding preserves explicit preferences and defaults invalid values", () => {
  assert.equal(themeCookieSeedValue("graphite"), undefined);
  assert.equal(themeCookieSeedValue("dark"), undefined);
  assert.equal(themeCookieSeedValue("amoled"), undefined);
  assert.equal(themeCookieSeedValue("system"), undefined);
  assert.equal(themeCookieSeedValue(undefined), "system");
  assert.equal(themeCookieSeedValue("unknown"), "system");
});

test("response cookie seeding preserves explicit themes and uses a one-week default", () => {
  const seedTheme = (existingTheme) => {
    const request = new NextRequest("https://app.hypertask.ai", {
      headers:
        existingTheme === undefined
          ? undefined
          : { cookie: `theme=${existingTheme}` },
    });
    const response = NextResponse.json({ ok: true });
    const seeded = seedResponseThemeCookie(request, response);
    return { response, seeded };
  };

  const explicit = seedTheme("graphite");
  assert.equal(explicit.seeded, false);
  assert.equal(explicit.response.cookies.get("theme"), undefined);

  const invalid = seedTheme("unknown");
  assert.equal(invalid.seeded, true);
  assert.equal(invalid.response.cookies.get("theme")?.value, "system");
  assert.match(invalid.response.headers.get("set-cookie"), /Max-Age=604800/);
  assert.match(invalid.response.headers.get("set-cookie"), /Path=\//);
  assert.match(invalid.response.headers.get("set-cookie"), /SameSite=strict/i);

  const missing = seedTheme(undefined);
  assert.equal(missing.seeded, true);
  assert.equal(missing.response.cookies.get("theme")?.value, "system");
});

test("dark mode toggle switches between the approved dark and light themes", () => {
  assert.equal(nextThemeForDarkModeToggle("dark"), "porcelain");
  assert.equal(nextThemeForDarkModeToggle("light"), "amoled");
});

test("theme boot normalizes invalid cookies before first paint", () => {
  const classes = new Set(["light", "system"]);
  const attributes = {};
  const documentElement = {
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
    },
    setAttribute: (name, value) => {
      attributes[name] = value;
    },
  };

  vm.runInNewContext(
    buildThemeBootScript("theme", "porcelain", "amoled"),
    {
      document: { cookie: "theme=unknown", documentElement },
      window: { matchMedia: () => ({ matches: true }) },
    },
  );

  assert.deepEqual([...classes].sort(), ["amoled", "dark"]);
  assert.equal(attributes["data-theme"], "amoled");
});

test("resolved themes expose matching Android status bar colors", () => {
  assert.equal(resolvedThemeDomMetadata.porcelain.themeColor, "#ffffff");
  assert.equal(resolvedThemeDomMetadata.dia.themeColor, "#f6f4ef");
  assert.equal(resolvedThemeDomMetadata.graphite.themeColor, "#232326");
  assert.equal(resolvedThemeDomMetadata.amoled.themeColor, "#000000");
});

test("initial documents use a dark fallback for unresolved system themes", () => {
  assert.equal(resolveInitialThemeColor("system"), "#000000");
  assert.equal(resolveInitialThemeColor("porcelain"), "#ffffff");
  assert.equal(resolveInitialThemeColor("dia"), "#f6f4ef");
});

test("theme boot synchronizes the Android status bar before first paint", () => {
  const cases = [
    { cookie: "theme=porcelain", systemDark: true, expected: "#ffffff" },
    { cookie: "theme=dia", systemDark: true, expected: "#f6f4ef" },
    { cookie: "theme=graphite", systemDark: false, expected: "#232326" },
    { cookie: "theme=amoled", systemDark: false, expected: "#000000" },
    { cookie: "theme=system", systemDark: false, expected: "#ffffff" },
    { cookie: "theme=system", systemDark: true, expected: "#000000" },
  ];

  for (const { cookie, systemDark, expected } of cases) {
    let themeColor;
    const themeColorMeta = {
      setAttribute: (name, value) => {
        if (name === "content") themeColor = value;
      },
    };
    const documentElement = {
      classList: { add: () => {}, remove: () => {} },
      setAttribute: () => {},
    };

    vm.runInNewContext(buildThemeBootScript("theme", "porcelain", "amoled"), {
      document: {
        cookie,
        documentElement,
        querySelector: (selector) =>
          selector === 'meta[name="theme-color"]' ? themeColorMeta : null,
      },
      window: { matchMedia: () => ({ matches: systemDark }) },
    });

    assert.equal(themeColor, expected, cookie);
  }
});

test("Ctrl+K exposes five direct theme choices without duplicate routes", () => {
  const groups = getAllCommands({ context: "Others" });
  const appearance = groups.find((group) => group.group === "Appearance");
  const settings = groups.find((group) => group.group === "Settings");
  const themeCommands = appearance.commandLists.slice(0, expectedThemes.length);

  assert.deepEqual(
    themeCommands.map(({ key, name }) => ({ key, name })),
    [
      { key: "systemTheme", name: "Follow system" },
      { key: "lightTheme", name: "Light · Porcelain" },
      { key: "darkTheme", name: "Dark · Graphite" },
      { key: "amoledTheme", name: "OLED black · AMOLED" },
      { key: "paperTheme", name: "Paper · Dia" },
    ],
  );
  assert.ok(themeCommands.every(({ keywords }) => keywords.includes("theme")));
  assert.ok(!appearance.commandLists.some(({ key }) => key === "setTheme"));
  assert.ok(
    !appearance.commandLists.some(({ key }) => key === "toggleDarkMode"),
  );

  const appearanceSettings = settings.commandLists.find(
    ({ key }) => key === "settingsAppearance",
  );
  assert.ok(!appearanceSettings.keywords.split(" ").includes("theme"));
});

test("pre-paint and live listeners resolve system mode through the shared model", () => {
  const layout = fs.readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");
  const listener = fs.readFileSync(
    path.join(root, "src/lib/contexts/ThemeListener.tsx"),
    "utf8",
  );
  assert.match(layout, /resolveThemePreference\("system", "dark"\)/);
  assert.match(layout, /buildThemeBootScript\(/);
  assert.ok(
    layout.indexOf('name="theme-color"') <
      layout.indexOf("buildThemeBootScript("),
  );
  assert.match(listener, /resolveThemePreference\(/);
  assert.match(listener, /resolvedThemeDomMetadata\[resolved\]\.themeColor/);
  assert.doesNotMatch(listener, /match\.matches \? "amoled"/);
});

test("retired numeric theme modes redirect to Appearance settings", () => {
  const commands = fs.readFileSync(
    path.join(root, "src/components/commands.tsx"),
    "utf8",
  );

  assert.match(
    commands,
    /case CommandMode\.SetTheme:\s*case CommandMode\.ToggleDarkMode:[\s\S]*?openSettings\("appearance"\)/,
  );
  assert.match(
    commands,
    /showCommands\.mode !== CommandMode\.SetTheme[\s\S]*?showCommands\.mode !== CommandMode\.ToggleDarkMode[\s\S]*?openSettings\("appearance"\)/,
  );
});
