const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const { createJiti } = require("jiti");
const { chromium } = require("@playwright/test");
const { compile } = require("@tailwindcss/node");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-7045-shortcuts-help-phone";
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const keys = jiti(path.join(root, "src/lib/flags/keys.ts"));
const shortcuts = jiti(path.join(root, "src/lib/constants/shortcuts.ts"));
const legacyPanel = "fixed bg-sidebar text-white-black top-0  right-0 w-[26vw] lg:w-min-[30vw] md:w-min-[32vw] overflow-y-auto h-SVH-full z-[100] pt-[env(safe-area-inset-top)]";
const evidenceDir = process.env.SHORTCUTS_PHONE_EVIDENCE_DIR;

function loadComponent(file, dependencies) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function("require", "exports", js)((name) => {
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  return exports.default;
}

function createComponent(enabled, apple = true, setShowShortcuts = () => {}) {
  const BackDrop = loadComponent("src/components/sidebars/BackDropContainer.tsx", {
    react: React,
    "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
  });
  const Component = loadComponent("src/components/sidebars/keyboardShortcuts.tsx", {
    react: React,
    "lucide-react": require("lucide-react"),
    "@/lib/flags/keys": keys,
    "@/hooks/useFlag": { useFlag: (key) => key === flagKey && enabled },
    "@/lib/state": { useRecoilValue: () => false, useRecoilState: () => [true, setShowShortcuts] },
    "@/store": { appShellRailAtom: {}, showShortcutsAtom: {} },
    "./BackDropContainer": { __esModule: true, default: BackDrop },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => apple },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/lib/constants/keyboard-handler": { KeyCodes: { ESCAPE: 27 } },
    "@/lib/configs/general.config": {
      DIV_ID_CONSTANTS: { keyboardShortcuts: "shortcuts-help" },
      INPUT_ID_CONSTANTS: { KeyboardShortcuts: "shortcuts-search" },
    },
    "@/lib/constants/shortcuts": shortcuts,
  });
  return Component;
}

function render(enabled, apple = true) {
  return renderToStaticMarkup(React.createElement(createComponent(enabled, apple)));
}

async function styles(html) {
  const doc = new JSDOM(html).window.document;
  const candidates = [...new Set([...doc.querySelectorAll("[class]")].flatMap((node) => [...node.classList]))];
  const compiler = await compile('@import "./src/styles/tailwind-entry.css";', { base: root, onDependency: () => {} });
  const fonts = evidenceDir ? [
    ["Plex", "plex.woff2", "normal"], ["Inter", "inter.woff2", "normal"],
    ["Newsreader", "newsreader-normal.woff2", "normal"], ["Newsreader", "newsreader-italic.woff2", "italic"],
  ].map(([family, file, style]) => `@font-face{font-family:${family};font-style:${style};font-weight:100 900;src:url(data:font/woff2;base64,${fs.readFileSync(path.join(evidenceDir, file)).toString("base64")})}`).join("\n") : "";
  return compiler.build(candidates) + fonts + ["porcelain", "graphite", "amoled", "dia"].map((theme) =>
    fs.readFileSync(path.join(root, `src/styles/tailwindThemes/${theme}.css`), "utf8")).join("\n") +
    'html{--font-plex:Plex;--font-inter:Inter;--font-newsreader:Newsreader}body{font-family:inherit}html.dia{font-family:var(--font-inter),sans-serif}';
}

async function measure(page) {
  return page.evaluate(() => {
    const panel = document.getElementById("shortcuts-help");
    const bounds = panel.getBoundingClientRect();
    const rows = [...panel.querySelectorAll("p")].map((label) => {
      const row = label.parentElement;
      const rect = label.getBoundingClientRect();
      return {
        title: label.textContent,
        lines: rect.height / parseFloat(getComputedStyle(label).lineHeight),
        labelWidth: rect.width,
        keys: [...row.querySelectorAll("kbd")].map((key) => {
          const box = key.getBoundingClientRect();
          return { text: key.textContent, left: box.left, right: box.right, width: box.width,
            client: key.clientWidth, scroll: key.scrollWidth, shrink: getComputedStyle(key).flexShrink };
        }),
      };
    });
    return { panel: { left: bounds.left, right: bounds.right, width: bounds.width },
      client: panel.clientWidth, scroll: panel.scrollWidth, rows };
  });
}

function assertPhone(result, width) {
  assert.equal(result.panel.width, width, "phone panel spans viewport");
  assert.equal(result.panel.left, 0);
  assert.equal(result.scroll, result.client, "panel has no horizontal overflow");
  assert.ok(result.rows.some((row) => row.title === "Send comment and stay on task"));
  for (const row of result.rows) {
    assert.ok(row.lines <= 2.01, `${row.title}: at most two label lines`);
    for (const key of row.keys) {
      assert.ok(key.left >= result.panel.left && key.right <= result.panel.right, `${row.title}: ${key.text} fully inside panel`);
      assert.equal(key.scroll, key.client, `${key.text} is not clipped`);
      assert.equal(key.shrink, "0", "badges never shrink on phone");
    }
  }
}

test("flag-on phone layout uses responsive width, wrapping rows and non-shrinking badges; Off preserves exact original classes", () => {
  for (const enabled of [false, true]) {
    const doc = new JSDOM(render(enabled)).window.document;
    const panel = doc.getElementById("shortcuts-help");
    const label = panel.querySelector("p");
    if (!enabled) {
      assert.equal(panel.className, legacyPanel);
      assert.equal(label.parentElement.className, "flex flex-row items-center mb-2 gap-2");
      assert.equal(label.className, "w-[60%] font-normal text-content leading-[16.94px]");
      assert.equal(label.nextElementSibling.className, "flex gap-1 w-[40%]");
      assert.ok(!panel.querySelector("kbd").className.includes("max-sm:"));
    } else {
      assert.ok(panel.classList.contains("max-sm:w-full"));
      assert.ok(panel.classList.contains("w-[26vw]"));
      for (const side of ["left", "right", "bottom"]) {
        assert.ok(panel.className.includes(`env(safe-area-inset-${side})`));
      }
      assert.ok(label.parentElement.classList.contains("max-sm:flex-wrap"));
      assert.ok(label.nextElementSibling.classList.contains("max-sm:shrink-0"));
      assert.ok(panel.querySelector("kbd").classList.contains("max-sm:shrink-0"));
    }
  }
});

test("phone close control is flag-gated and closes once without triggering outside-click handling", async () => {
  const offDoc = new JSDOM(render(false)).window.document;
  assert.equal(offDoc.querySelector('[aria-label="Close keyboard shortcuts"]'), null);

  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: global.window, document: global.document, act: global.IS_REACT_ACT_ENVIRONMENT };
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = require("react-dom/client");
  const mounted = createRoot(document.getElementById("root"));
  const calls = [];
  try {
    const Component = createComponent(true, true, (value) => calls.push(value));
    await React.act(() => mounted.render(React.createElement(Component)));
    const close = document.querySelector('[aria-label="Close keyboard shortcuts"]');
    assert.ok(close);
    assert.equal(close.type, "button");
    for (const className of ["hidden", "max-sm:flex", "h-11", "w-11", "shrink-0"]) {
      assert.ok(close.classList.contains(className), className);
    }
    assert.equal(close.previousElementSibling.id, "shortcuts-search");
    assert.ok(document.getElementById("shortcuts-help").contains(close));
    assert.ok(close.querySelector('svg.lucide-x[aria-hidden="true"]'));
    await React.act(() => close.click());
    assert.deepEqual(calls, [false], "close calls the setter once, not the outside-click handler too");
    await React.act(() => document.body.click());
    assert.deepEqual(calls, [false, false], "positive control: outside clicks still close the panel");
  } finally {
    await React.act(() => mounted.unmount());
    global.window = previous.window;
    global.document = previous.document;
    global.IS_REACT_ACT_ENVIRONMENT = previous.act;
    dom.window.close();
  }
});

test("real component and Tailwind CSS fit phone in all themes and preserve desktop geometry", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const measurements = [];
  if (evidenceDir) fs.mkdirSync(evidenceDir, { recursive: true });
  for (const apple of [true, false]) {
    const layouts = {};
    for (const enabled of [false, true]) {
      const html = render(enabled, apple);
      layouts[enabled] = { html, css: await styles(html) };
    }
    for (const theme of ["porcelain", "graphite", "amoled", "dia"]) {
      const desktop = [];
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        for (const enabled of [false, true]) {
          const { html, css } = layouts[enabled];
          await page.setContent(`<style>${css}</style>${html}`);
          await page.evaluate((theme) => { document.documentElement.className = theme; }, theme);
          await page.evaluate(() => document.fonts.ready);
          const close = page.getByRole("button", { name: "Close keyboard shortcuts", includeHidden: true });
          if (!enabled) {
            assert.equal(await close.count(), 0, "flag Off has no close control");
          } else if (width === 390) {
            assert.equal(await close.isVisible(), true, "phone close control is visible");
            const bounds = await close.boundingBox();
            assert.equal(bounds.width, 44, "phone close target is 44px wide");
            assert.equal(bounds.height, 44, "phone close target is 44px high");
          } else {
            assert.equal(await close.isVisible(), false, "desktop close control stays hidden");
          }
          await page.evaluate(() => {
            const heading = [...document.querySelectorAll("h3")].find((node) => node.textContent === "Task View");
            document.getElementById("shortcuts-help").scrollTop = heading.offsetTop - 24;
          });
          const result = await measure(page);
          measurements.push({ apple, theme, width, enabled, ...result });
          if (evidenceDir && apple && (width === 390 || theme === "porcelain")) {
            await page.screenshot({ path: path.join(evidenceDir, `${width === 390 ? "phone" : "desktop"}-${theme}-${enabled ? "after" : "before"}.png`) });
          }
          if (width === 390 && enabled) assertPhone(result, width);
          if (width === 390 && !enabled) assert.ok(result.panel.width < width / 3, "Off retains the reported narrow panel");
          if (width === 1440) desktop.push(result);
        }
        if (width === 1440) assert.deepEqual(desktop[1], desktop[0], `${theme} desktop is unchanged`);
      }
    }
  }
  const safeHtml = render(true);
  const safeCss = (await styles(safeHtml)).replace(/env\(safe-area-inset-(top|right|bottom|left)\)/g,
    (_, side) => ({ top: "20px", right: "16px", bottom: "24px", left: "12px" })[side]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(`<style>${safeCss}</style>${safeHtml}`);
  await page.evaluate(() => { document.documentElement.className = "porcelain"; });
  await page.evaluate(() => document.fonts.ready);
  const safeResult = await measure(page);
  assertPhone(safeResult, 390);
  const padding = await page.locator("#shortcuts-help").evaluate((panel) => {
    const style = getComputedStyle(panel);
    return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft];
  });
  assert.deepEqual(padding, ["20px", "16px", "24px", "12px"]);
  for (const row of safeResult.rows) for (const key of row.keys) {
    assert.ok(key.left >= 12 && key.right <= 374, "badges respect nonzero safe areas");
  }
  if (evidenceDir) fs.writeFileSync(path.join(evidenceDir, "measurements.json"), JSON.stringify(measurements, null, 2));
});
