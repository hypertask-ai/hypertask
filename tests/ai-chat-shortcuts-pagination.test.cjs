const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

function pickerView() {
  const view = mount();
  const source = loader({
    "@/components/Common/CommonModalComponents": {
      ModalContainerCustom: ({ children }) => React.createElement("div", null, children),
      ModalHeaderComp: ({ header }) => React.createElement("h2", null, header),
      ModalInput: ({ id, value, onChange }) => React.createElement("input", { id, value, onInput: onChange, onChange: () => {} }),
      ModalListContainer: ({ children }) => React.createElement("div", null, children),
      ModalRowElementContainer: ({ children, onClick, id }) => React.createElement("button", { id, onClick }, children),
    },
    "@/hooks/General/useHandleMouse": { default: () => ({ handleMouseEnter: () => {}, handleMouseLeave: () => {}, handleMouseMove: () => {}, elRef: React.createRef() }) },
    reactstrap: { ModalBody: ({ children }) => React.createElement("div", null, children) },
    "lucide-react": { Check: () => null },
  });
  const Picker = source("src/components/Modals/OptionPicker/index.tsx").default;
  const press = (key) => React.act(() => document.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
  return { ...view, press, show: (props) => view.render(React.createElement(Picker, props)) };
}

test("filtered chat search keeps keyboard pagination reachable and retains its query", async () => {
  const view = pickerView();
  try {
    let loads = 0;
    let selected;
    const selection = new Promise((resolve) => { selected = resolve; });
    const props = {
      header: "Search chats", options: [{ id: "recent", label: "Recent chat" }],
      onClose: () => assert.fail("pagination must not close search"),
      onSelect: selected, onLoadMore: () => { loads++; },
    };
    view.show(props);
    const input = view.container.querySelector("input");
    React.act(() => { input.value = "Older"; input.dispatchEvent(new window.Event("input", { bubbles: true })); });
    assert.equal(view.container.querySelector("button").textContent, "Load more");
    view.press("Enter");
    assert.equal(loads, 1);
    view.show({ ...props, isLoadingMore: true });
    view.press("Enter");
    assert.equal(loads, 1, "pending pages cannot be requested twice");
    view.show({ ...props, options: [...props.options, { id: "older", label: "Older chat" }], onLoadMore: undefined });
    assert.equal(view.container.querySelector("input").value, "Older");
    assert.deepEqual([...view.container.querySelectorAll("button")].map((button) => button.textContent), ["Older chat"]);
    view.press("Enter");
    assert.deepEqual(await selection, { id: "older", label: "Older chat" });
  } finally { view.close(); }
});

test("ordinary pickers retain their existing options without a pagination row", async () => {
  const view = pickerView();
  try {
    let selected;
    const selection = new Promise((resolve) => { selected = resolve; });
    view.show({ header: "Boards", options: [{ id: 15, label: "Board" }], onClose: () => {}, onSelect: selected });
    assert.deepEqual([...view.container.querySelectorAll("button")].map((button) => button.textContent), ["Board"]);
    view.press("Enter");
    assert.deepEqual(await selection, { id: 15, label: "Board" });
  } finally { view.close(); }
});
