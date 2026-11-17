const assert = require("node:assert/strict");
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
