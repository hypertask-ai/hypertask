const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const { createJiti } = require("jiti");
const { compile } = require("@tailwindcss/node");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-7564-phone-shortcuts-header";
const phoneHelpKey = "htpr-7045-shortcuts-help-phone";
const componentPath = "src/components/sidebars/keyboardShortcuts.tsx";
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const keys = jiti(path.join(root, "src/lib/flags/keys.ts"));
const shortcuts = jiti(path.join(root, "src/lib/constants/shortcuts.ts"));
const phoneLayer = "max-sm:!z-[9990]";

function load(file, dependencies, source = fs.readFileSync(path.join(root, file), "utf8")) {
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

function render(enabled, phoneHelp, legacy = false) {
  const BackDrop = load("src/components/sidebars/BackDropContainer.tsx", {
    react: React,
    "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
  });
  let source = fs.readFileSync(path.join(root, componentPath), "utf8");
  if (legacy) {
    const branch = '<BackDropContainer className={phoneShortcutsHeader ? "max-sm:!z-[9990]" : undefined}>';
    assert.ok(source.includes(branch));
    source = source.replace(branch, "<BackDropContainer>");
  }
  const Component = load(componentPath, {
    react: React,
    "lucide-react": require("lucide-react"),
    "@/lib/flags/keys": keys,
    "@/hooks/useFlag": { useFlag: (key) => key === flagKey ? enabled : key === phoneHelpKey && phoneHelp },
    "@/lib/state": { useRecoilValue: () => false, useRecoilState: () => [true, () => {}] },
    "@/store": { appShellRailAtom: {}, showShortcutsAtom: {} },
    "./BackDropContainer": { __esModule: true, default: BackDrop },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => true },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/lib/constants/keyboard-handler": { KeyCodes: { ESCAPE: 27 } },
    "@/lib/configs/general.config": {
      DIV_ID_CONSTANTS: { keyboardShortcuts: "shortcuts-help" },
      INPUT_ID_CONSTANTS: { KeyboardShortcuts: "shortcuts-search" },
    },
    "@/lib/constants/shortcuts": shortcuts,
  }, source);
  return renderToStaticMarkup(React.createElement(Component));
}

test("phone header fix raises the entire backdrop, not the panel trapped in its stacking context", () => {
  for (const phoneHelp of [false, true]) {
    const off = render(false, phoneHelp);
    assert.equal(off, render(false, phoneHelp, true), "Off preserves exact pre-fix rendered markup");
    const onDoc = new JSDOM(render(true, phoneHelp)).window.document;
    const offDoc = new JSDOM(off).window.document;
    const panel = onDoc.getElementById("shortcuts-help");
    const backdrop = panel.parentElement;
    assert.ok(backdrop.classList.contains(phoneLayer));
    assert.equal(backdrop.style.zIndex, "300", "desktop keeps its original inline layer");
    assert.equal(panel.outerHTML, offDoc.getElementById("shortcuts-help").outerHTML, "panel and controls are unchanged");
    assert.equal(backdrop.className.replace(`${phoneLayer} `, ""), offDoc.getElementById("shortcuts-help").parentElement.className);
    assert.equal(Boolean(panel.querySelector('[aria-label="Close keyboard shortcuts"]')), phoneHelp);
  }
});

test("phone layer is important to override the inline backdrop z-index and never applies on desktop", async () => {
  const compiler = await compile('@import "./src/styles/tailwind-entry.css";', { base: root, onDependency: () => {} });
  const css = compiler.build([phoneLayer]);
  assert.match(css, /@media\s*\(width\s*<\s*640px\)/);
  assert.match(css, /z-index:\s*9990\s*!important/);
  assert.doesNotMatch(css, /z-index:\s*9990\s*;/, "no unscoped non-important layer override");
});

test("phone header flag ships as a small Everyone bugfix", () => {
  const definition = jiti(path.join(root, `src/lib/flags/definitions/${flagKey}.ts`));
  assert.equal(definition.HTPR_7564_PHONE_SHORTCUTS_HEADER_FLAG, flagKey);
  assert.equal(definition.default.key, flagKey);
  assert.equal(definition.default.kind, "bugfix");
  assert.equal(definition.default.defaultMode, "EVERYONE");
  assert.equal(definition.default.shippedOn, "2026-10-22");
  assert.equal(definition.default.releaseRisk.risk, "small");
});
