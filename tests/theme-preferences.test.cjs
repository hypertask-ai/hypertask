const test = require("node:test");
const assert = require("node:assert/strict");
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
  availableThemeOptions,
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
  { title: "Graphite 2", value: "graphite-2" },
  { title: "OLED black · AMOLED", value: "amoled" },
  { title: "Paper · Dia", value: "dia" },
  { title: "Material (follows device)", value: "rounded" },
];

test("theme preferences use one clear label and order", () => {
  assert.deepEqual(availableThemeOptions(true, true), expectedThemes);
  assert.deepEqual(availableThemeOptions(true, false).map(({ value }) => value), ["system", "porcelain", "graphite", "amoled", "dia", "rounded"]);
  assert.deepEqual(availableThemeOptions(false, false).map(({ value }) => value), ["system", "porcelain", "graphite", "amoled", "dia"]);
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
  assert.equal(normalizeThemePreference("dark", true, false), "graphite");
  assert.equal(normalizeThemePreference("dia", true, false), "dia");
  assert.equal(normalizeThemePreference("rounded", true, false), "rounded");
  assert.equal(normalizeThemePreference("rounded", false, false), "system");
  assert.equal(normalizeThemePreference("graphite-2", true, false), "system");
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

test("Ctrl+K exposes direct theme choices without duplicate routes", () => {
  const groups = getAllCommands({ context: "Others" }, false, false, "", "", false, false, false, true);
  const appearance = groups.find((group) => group.group === "Appearance");
  const settings = groups.find((group) => group.group === "Settings");
  const themeCommands = appearance.commandLists.slice(0, expectedThemes.length - 1);

  assert.deepEqual(
    themeCommands.map(({ key, name }) => ({ key, name })),
    [
      { key: "systemTheme", name: "Follow system" },
      { key: "lightTheme", name: "Light · Porcelain" },
      { key: "darkTheme", name: "Dark · Graphite" },
      { key: "graphite2Theme", name: "Graphite 2" },
      { key: "amoledTheme", name: "OLED black · AMOLED" },
      { key: "paperTheme", name: "Paper · Dia" },
    ],
  );
  assert.ok(themeCommands.every(({ keywords }) => keywords.includes("theme")));
  assert.ok(themeCommands[1].keywords.split(" ").includes("white"));
  for (const keyword of ["black", "oled"]) assert.ok(themeCommands[4].keywords.split(" ").includes(keyword));
  assert.ok(!appearance.commandLists.some(({ key }) => key === "setTheme"));
  assert.ok(
    !appearance.commandLists.some(({ key }) => key === "toggleDarkMode"),
  );

  const appearanceSettings = settings.commandLists.find(
    ({ key }) => key === "settingsAppearance",
  );
  assert.ok(!appearanceSettings.keywords.split(" ").includes("theme"));
});


test("restoration isolates legacy choices and individual switches", () => {
  const restored = { restore: true, loaded: true, system: true, porcelain: true, graphite: true, amoled: true, dia: true };
  const values = ["system", "porcelain", "graphite", "graphite-2", "amoled", "dia", "rounded"];
  assert.deepEqual(availableThemeOptions(true, true, restored).map(option => option.value), values);
  assert.deepEqual(availableThemeOptions(true, true, { ...restored, restore: false }).map(option => option.value), values);
  for (const theme of ["system", "porcelain", "graphite", "amoled", "dia"]) {
    const visibility = { ...restored, [theme]: false };
    const options = availableThemeOptions(true, true, visibility);
    assert.deepEqual(options.map(option => option.value), values.filter(value => value !== theme));
    const commands = getAllCommands({ context: "Others" }, false, true, "", "", false, false, false, true, visibility).find(group => group.group === "Appearance").commandLists;
    assert.deepEqual(commands.slice(0, options.length).map(command => command.name), options.map(option => option.title));
  }
  assert.equal(normalizeThemePreference("dark", true, true, true), "graphite");
  assert.equal(normalizeThemePreference("graphite", true, true, true), "graphite");
  assert.equal(normalizeThemePreference("dia", true, true, true), "dia");
  assert.equal(normalizeThemePreference("rounded", true, true, true), "rounded");
  assert.equal(normalizeThemePreference("dark", true, true), "graphite");
  assert.equal(normalizeThemePreference("dia", true, true), "dia");
  assert.equal(normalizeThemePreference("rounded", true, true), "rounded");
});

test("restored boot honors theme switches without changing saved cookies", () => {
  const visibility = { restore: true, loaded: true, system: true, porcelain: true, graphite: true, amoled: true, dia: true };
  for (const [saved, enabled, expected] of [["dark", true, "graphite"], ["graphite", false, "amoled"], ["dia", true, "dia"], ["rounded", true, "rounded-dark"], ["graphite-2", true, "graphite-2"]]) {
    const attributes = {};
    const document = {
      get cookie() { return `theme=${saved}`; },
      set cookie(_) { assert.fail("boot must not write cookies"); },
      documentElement: { classList: { add() {}, remove() {} }, setAttribute(name, value) { attributes[name] = value; } },
      querySelector() { return null; },
    };
    vm.runInNewContext(buildThemeBootScript("theme", "porcelain", "amoled", true, true, { ...visibility, graphite: enabled }), { document, window: { matchMedia: () => ({ matches: true }) } });
    assert.equal(attributes["data-theme"], expected);
    assert.equal(document.cookie, `theme=${saved}`);
  }
});

test("restoration and individual theme switches are owner-and-QA bugfixes", () => {
  for (const name of ["restore-themes", "theme-system", "theme-porcelain", "theme-graphite", "theme-amoled", "theme-dia"]) {
    const flag = jiti(path.join(root, `src/lib/flags/definitions/htpr-8710-${name}.ts`));
    const definition = flag.default ?? flag;
    assert.equal(definition.kind, "bugfix");
    assert.equal(definition.defaultMode, "OWNER_AND_QA");
  }
});
