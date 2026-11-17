const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadModule } = require("./helpers/loadModule.cjs");

const FLAG = "htpr-8993-properties-column";
const mobile = React.createContext(false);
let flagOn = false;

const flagModule = loadModule(
  "src/lib/flags/definitions/htpr-8993-properties-column.ts",
);
const {
  closeCustomFieldReveal,
  getRevealedCustomFieldId,
  revealCustomField,
} = loadModule("src/lib/taskDetail/rightColumnFields.ts");

const rail = loadModule(
  "src/components/PageComponents/TaskDetail/MainPageComponents/TaskInfoColumnContainer.tsx",
  {
    "@/hooks/useFlag": { useFlag: (key) => key === FLAG && flagOn },
    "@/lib/contexts/mobileContext": { MobileViewContext: mobile },
    "@/utils/undoActions/helperFuncs": {
      cn: (...values) => values.filter(Boolean).join(" "),
    },
  },
).TaskInfoColumnContainer;

const renderRail = () =>
  renderToStaticMarkup(
    React.createElement(rail, null, React.createElement("span", null, "row")),
  );

test("the ticket flag is a bugfix that goes live for everyone", () => {
  assert.equal(flagModule.HTPR_8993_PROPERTIES_COLUMN_FLAG, FLAG);
  assert.equal(flagModule.default.key, FLAG);
  assert.equal(flagModule.default.kind, "bugfix");
  assert.equal(flagModule.default.defaultMode, "EVERYONE");
});

test("the properties box asks for 4px corners only while the flag is on", () => {
  flagOn = true;
  assert.match(renderRail(), /data-properties-rail-corners="4"/);
  flagOn = false;
  assert.doesNotMatch(renderRail(), /data-properties-rail-corners/);
});

test("plain themes get 4px rail corners and themed rails keep theirs", () => {
  const scss = fs.readFileSync(path.join(__dirname, "../src/styles/globals.scss"), "utf8");
  const rail = scss.match(/html\[data-task-box-outlines\]:not\(\.dia\):not\(\.rounded\) \[data-task-detail-path\] \[data-task-properties-rail\]\[data-properties-rail-corners="4"\] \{[^}]+\}/);
  const chip = scss.match(/\[data-task-detail-path\] \[data-task-properties-rail\]\[data-properties-rail-corners="4"\] \[data-task-property-chip\] \{[^}]+\}/);
  assert.ok(rail, "plain-theme rail rule missing");
  assert.match(rail[0], /border-radius:\s*4px !important/);
  assert.ok(chip, "chip rule missing");
  assert.doesNotMatch(chip[0], /data-task-box-outlines/);
  assert.match(chip[0], /border-radius:\s*4px !important/);
});

function specificity(selector) {
  const parts = [selector.replace(/:not\([^)]+\)/g, ""), ...[...selector.matchAll(/:not\(([^)]+)\)/g)].map((match) => match[1])];
  const body = parts.join(" ");
  const classes = (body.match(/\.[\w-]+/g) || []).length;
  const attrs = (body.match(/\[[^\]]+\]/g) || []).length;
  const elements = (body.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return [classes + attrs, elements];
}

function themeMatches(selector, theme) {
  const classes = new Set(theme.split(/\s+/).filter(Boolean));
  for (const match of selector.matchAll(/:not\(\.([\w-]+)\)/g)) {
    if (classes.has(match[1])) return false;
  }
  const plain = selector.replace(/:not\([^)]+\)/g, "");
  for (const match of plain.matchAll(/\.([\w-]+)/g)) {
    if (!classes.has(match[1])) return false;
  }
  return true;
}

function winningRadius(css, theme, outlines, target) {
  const rules = [...css.matchAll(/([^{}]+)\{[^}]*border-radius:\s*([0-9]+px)/g)].map((match) => ({
    selector: match[1].trim(),
    radius: match[2],
  }));
  let best = null;
  let bestScore = null;
  for (const rule of rules) {
    const chipRule = rule.selector.includes("data-task-property-chip");
    if (target === "chip" ? !chipRule : chipRule) continue;
    if (rule.selector.includes("[data-task-box-outlines]") && !outlines) continue;
    if (!themeMatches(rule.selector, theme)) continue;
    const score = specificity(rule.selector);
    const higher = !bestScore
      || score[0] > bestScore[0]
      || (score[0] === bestScore[0] && score[1] > bestScore[1])
      || (score[0] === bestScore[0] && score[1] === bestScore[1]);
    if (higher) {
      best = rule.radius;
      bestScore = score;
    }
  }
  return best || "0px";
}

test("4px corners stay off Dia and Rounded rails and chips ignore the outline flag", () => {
  const scss = fs.readFileSync(path.join(__dirname, "../src/styles/globals.scss"), "utf8");
  const rail = scss.match(/html\[data-task-box-outlines\]:not\(\.dia\):not\(\.rounded\) \[data-task-detail-path\] \[data-task-properties-rail\]\[data-properties-rail-corners="4"\] \{[^}]+\}/)[0];
  const chip = scss.match(/\[data-task-detail-path\] \[data-task-properties-rail\]\[data-properties-rail-corners="4"\] \[data-task-property-chip\] \{[^}]+\}/)[0];
  assert.match(scss, /html\.dia\[data-task-box-outlines\][\s\S]*?border-radius:\s*10px !important/);
  const css = `
    html[data-task-box-outlines] [data-task-detail-path] [data-task-properties-rail] { border-radius: 5px !important; }
    html.dia[data-task-box-outlines] [data-task-detail-path] [data-task-properties-rail] { border-radius: 10px !important; }
    html.rounded[data-task-box-outlines] [data-task-detail-path] [data-task-properties-rail] { border-radius: 20px !important; }
    ${rail}
    [data-task-property-chip] { border-radius: 5px !important; }
    ${chip}
  `;
  const radius = (theme, outlines) => ({
    rail: winningRadius(css, theme, outlines, "rail"),
    chip: winningRadius(css, theme, outlines, "chip"),
  });
  assert.deepEqual(radius("porcelain", true), { rail: "4px", chip: "4px" });
  assert.deepEqual(radius("dia", true), { rail: "10px", chip: "4px" });
  assert.deepEqual(radius("rounded rounded-light", true), { rail: "20px", chip: "4px" });
  assert.deepEqual(radius("porcelain", false), { rail: "0px", chip: "4px" });
});

test("the label token color stays inside the flagged ticket rail", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/components/PageComponents/TaskDetail/MainPageComponents/index.tsx"),
    "utf8",
  );
  const label = source.slice(source.indexOf("export const LocalRightSideInfo"), source.indexOf("export const ClickableSpan"));
  assert.match(label, /text-\[#8E9093\]/);
  assert.doesNotMatch(label, /text-text-light-gray/);
  const scss = fs.readFileSync(path.join(__dirname, "../src/styles/globals.scss"), "utf8");
  const chip = scss.match(/\[data-task-detail-path\] \[data-task-properties-rail\]\[data-properties-rail-corners="4"\] \[data-task-property-chip\] \{[^}]+\}/);
  assert.ok(chip);
  assert.match(chip[0], /color:\s*var\(--color-text-light-gray\)/);
});

test("a revealed field belongs to one ticket only", () => {
  const reveal = revealCustomField(42, "cf-ice");
  assert.equal(getRevealedCustomFieldId(reveal, 42), "cf-ice");
  assert.equal(getRevealedCustomFieldId(reveal, 7), null);
  assert.equal(closeCustomFieldReveal(reveal, 7, "cf-ice"), reveal);
});

test("closing the revealed field hides its row and keeps another field's row", () => {
  const reveal = revealCustomField(42, "cf-ice");
  assert.equal(closeCustomFieldReveal(reveal, 42, "cf-team"), reveal);
  assert.equal(closeCustomFieldReveal(reveal, 42, "cf-ice"), null);
});
