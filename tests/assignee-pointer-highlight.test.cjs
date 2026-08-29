const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const jiti = require("jiti")(__filename);

const useHandleMouseGlobal = jiti(
  path.join(__dirname, "../src/hooks/General/useHandleMouse.ts"),
).default;
const assignPickerSource = fs.readFileSync(
  path.join(
    __dirname,
    "../src/components/Modals/AssignToUser/AssignToUser.tsx",
  ),
  "utf8",
);

test("the assignee picker connects each pointer row to its selection state", () => {
  assert.match(
    assignPickerSource,
    /useHandleMouseGlobal\(\{\s*setSelectedIndex,\s*setHoveredIndex,\s*preserveSelectedIndexOnHover: true,\s*\}\)/,
  );
  assert.match(
    assignPickerSource,
    /onMouseEnter=\{\(\) => handleMouseEnter\(index\)\}/,
  );
  assert.match(
    assignPickerSource,
    /hoveredIndex === index \|\|\s*\(hoveredIndex === null && selectedIndex === index\)/,
  );
  assert.equal(
    assignPickerSource.match(/setHoveredIndex\(null\)/g)?.length,
    2,
  );
});

test("the assignee picker highlights the row under the pointer", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;

  let enterAgentRow;
  let enterSelectedRow;
  let leaveAgentRow;
  let moveWithinAgentRow;
  const PickerHarness = () => {
    const [selectedIndex, setSelectedIndex] = React.useState(0);
    const [hoveredIndex, setHoveredIndex] = React.useState(null);
    const { handleMouseEnter, handleMouseLeave, handleMouseMove } =
      useHandleMouseGlobal({
        setSelectedIndex,
        setHoveredIndex,
        preserveSelectedIndexOnHover: true,
      });
    enterAgentRow = () => handleMouseEnter(1);
    enterSelectedRow = () => handleMouseEnter(0);
    leaveAgentRow = handleMouseLeave;
    moveWithinAgentRow = handleMouseMove;

    return React.createElement(
      "div",
      null,
      ["Person", "Agent"].map((label, index) =>
        React.createElement(
          "button",
          {
            "data-active":
              hoveredIndex === index ||
              (hoveredIndex === null && selectedIndex === index),
            "data-hovered-index": hoveredIndex ?? "none",
            "data-selected-index": selectedIndex,
            key: label,
          },
          label,
        ),
      ),
    );
  };

  const container = document.getElementById("root");
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(PickerHarness)));

    const [personRow, agentRow] = container.querySelectorAll("button");
    assert.equal(personRow.dataset.active, "true");
    assert.equal(agentRow.dataset.active, "false");
    assert.equal(agentRow.dataset.selectedIndex, "0");
    assert.equal(agentRow.dataset.hoveredIndex, "none");

    await act(async () => enterSelectedRow());
    await act(async () => leaveAgentRow());
    await act(async () => enterAgentRow());

    assert.equal(agentRow.dataset.hoveredIndex, "1");
    assert.equal(agentRow.dataset.selectedIndex, "0");
    assert.equal(personRow.dataset.active, "false");
    assert.equal(agentRow.dataset.active, "true");

    await act(async () => {
      moveWithinAgentRow();
    });

    assert.equal(agentRow.dataset.hoveredIndex, "1");
    assert.equal(agentRow.dataset.selectedIndex, "0");
    assert.equal(agentRow.dataset.active, "true");

    await act(async () => {
      leaveAgentRow();
    });

    assert.equal(agentRow.dataset.hoveredIndex, "none");
    assert.equal(agentRow.dataset.selectedIndex, "0");
    assert.equal(personRow.dataset.active, "true");
    assert.equal(agentRow.dataset.active, "false");

    await act(async () => {
      moveWithinAgentRow();
    });

    assert.equal(agentRow.dataset.hoveredIndex, "none");
    assert.equal(agentRow.dataset.selectedIndex, "0");
    assert.equal(personRow.dataset.active, "true");
    assert.equal(agentRow.dataset.active, "false");
  } finally {
    try {
      await act(async () => root.unmount());
    } finally {
      dom.window.close();
      delete global.window;
      delete global.document;
      delete global.HTMLElement;
      delete global.IS_REACT_ACT_ENVIRONMENT;
    }
  }
});
