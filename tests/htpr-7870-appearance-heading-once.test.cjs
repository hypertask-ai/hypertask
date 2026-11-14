const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadModule: load } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { alias: { "@": path.join(root, "src") } });
const preferences = jiti("../src/lib/themePreferences.ts");
const key = "htpr-7870-appearance-heading-once";

const render = (enabled, isMobile) => {
  const { default: Appearance } = load("src/components/Modals/Settings/AppearanceSection.tsx", {
    "@/hooks/useThemeVisibility": { useThemeVisibility: () => ({ restore: false, loaded: true }) },
    "@/hooks/useFlag": { useFlag: (flagKey) => flagKey === key && enabled },
    "@/lib/contexts/mobileContext": { useMobileView: () => isMobile, MobileViewContext: React.createContext(isMobile) },
    "@/lib/flags/keys": { HTPR_7328_ROUNDED_THEME_FLAG: "htpr-7328-rounded-theme" },
    "@/lib/flags/definitions/htpr-8054-graphite-2": { HTPR_8054_GRAPHITE_2_FLAG: "htpr-8054-graphite-2" },
    "lucide-react": { Check: () => null },
    "@/hooks/MultiPages/HTC/useDarkMode": { default: () => ({ currentTheme: "system", effectiveTheme: "light", switchToTheme() {} }) },
    "@/lib/themePreferences": preferences,
    "@/utils/undoActions/helperFuncs": { cn: (...classes) => classes.filter(Boolean).join(" ") },
  });
  return renderToStaticMarkup(React.createElement(Appearance));
};

const headings = (markup, tag) => [...markup.matchAll(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "g"))].map((match) => match[1]);

test("HTPR-7870 flag is an improvement that defaults to Everyone", () => {
  const { default: flag, HTPR_7870_APPEARANCE_HEADING_ONCE_FLAG: exported } = jiti(path.join(root, "src/lib/flags/definitions/htpr-7870-appearance-heading-once.ts"));
  assert.equal(exported, key);
  assert.equal(flag.key, key);
  assert.equal(flag.kind, "improvement");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
});

test("HTPR-7870 desktop shows the Appearance heading once and keeps the theme list", () => {
  const markup = render(true, false);
  assert.deepEqual(headings(markup, "h2"), ["Appearance"]);
  assert.deepEqual(headings(markup, "h3"), []);
  assert.match(markup, /Follow system|Light/);
});

test("HTPR-7870 flag off keeps both Appearance labels", () => {
  const markup = render(false, false);
  assert.deepEqual(headings(markup, "h2"), ["Appearance"]);
  assert.deepEqual(headings(markup, "h3"), ["Appearance"]);
});

test("HTPR-7870 phone keeps the card label because the page heading is hidden there", () => {
  const markup = render(true, true);
  assert.deepEqual(headings(markup, "h2"), []);
  assert.deepEqual(headings(markup, "h3"), ["Appearance"]);
});
