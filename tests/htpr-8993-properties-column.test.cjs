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

test("4px corners stay off Dia and Rounded rails and chips ignore the outline flag", async () => {
  const { chromium } = require("@playwright/test");
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
  const markup = (theme, outlines) => `<!doctype html><html class="${theme}" ${outlines ? "data-task-box-outlines" : ""}>
    <head><style>${css}</style></head>
    <body><div data-task-detail-path>
      <div id="rail" data-task-properties-rail data-properties-rail-corners="4">
        <span id="chip" data-task-property-chip></span>
      </div>
    </div></body></html>`;
  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage();
    const radius = async (theme, outlines) => {
      await tab.setContent(markup(theme, outlines));
      return tab.evaluate(() => ({
        rail: getComputedStyle(document.getElementById("rail")).borderRadius,
        chip: getComputedStyle(document.getElementById("chip")).borderRadius,
      }));
    };
    assert.deepEqual(await radius("porcelain", true), { rail: "4px", chip: "4px" });
    assert.deepEqual(await radius("dia", true), { rail: "10px", chip: "4px" });
    assert.deepEqual(await radius("rounded rounded-light", true), { rail: "20px", chip: "4px" });
    assert.deepEqual(await radius("porcelain", false), { rail: "0px", chip: "4px" });
  } finally {
    await browser.close();
  }
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
