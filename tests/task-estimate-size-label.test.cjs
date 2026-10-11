const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const flag = "htpr-6978-size-label-click";
const estimates = [
  { estimate_index: 0, estimate_value: "No size", estimate_full_value: "No size" },
  { estimate_index: 3, estimate_value: "M", estimate_full_value: "Medium" },
];
const noop = () => {};
const div = ({ children }) => children;

function load(relative, dependencies) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

function picker(enabled, mode = "Task") {
  const writes = [], closes = [], refreshes = [];
  const constants = { __esModule: true, default: { EstimateConstants: estimates, CommentsTQPrefixKey: "comments" } };
  const keys = { HTPR_6978_SIZE_LABEL_CLICK_FLAG: flag, HTPR_6975_TYPED_WRITES_FLAG: "htpr-6975-typed-writes" };
  const useFlag = key => {
    if (key === keys.HTPR_6975_TYPED_WRITES_FLAG) return false;
    assert.equal(key, flag);
    return enabled;
  };
  const hook = load("src/hooks/MultiPages/Tasks/useEstimateModal.ts", {
    "@/hooks/useFlag": { useFlag },
    "@/lib/flags/keys": keys,
    "@/lib/api/typedClient": {},
    "@/hooks/MultiPages/useGetEstimateForTask": { useGetEstimateForTask: () => ({ data: { estimate_index: 3 } }) },
    "@/lib/constants": constants,
    "@/store": { inViewObjectAtom: "task", currentProjectAtom: "project", calendarTaskFiltersAtom: "calendar" },
    "@tanstack/react-query": { useQueryClient: () => ({ refetchQueries: value => refreshes.push(value) }) },
    axios: { __esModule: true, default: { post: async (url, body) => writes.push({ url, body }) } },
    "@/lib/state": { useRecoilValue: atom => atom === "task" ? { taskId: 42 } : {} },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": { getActiveFiltersFromProject: () => ({ addedFilters: [] }) },
  });
  const Label = load("src/components/Modals/TaskEstimate/EstimateLabelComponent.tsx", {
    react: React,
    "@/components/Labels/LabelWrapper": { __esModule: true, default: div },
    "@/lib/constants": constants,
  }).default;
  const Modal = load("src/components/Modals/TaskEstimate/TaskEstimate.tsx", {
    react: { useState: value => [value, noop], useEffect: noop },
    "@/components/Common/CommonModalComponents": {
      ModalContainerCustom: div, ModalHeaderComp: div, ModalInput: div,
      ModalListContainer: div, ModalRowElementContainer: div,
    },
    "@/lib/constants": constants,
    "lucide-react": { Check: div },
    reactstrap: { ModalBody: div },
    "@/lib/constants/keyboard-handler": { KeyCodes: {} },
    "@/hooks/General/useHandleMouse": { __esModule: true, default: () => ({ handleMouseLeave: noop, handleMouseMove: noop }) },
    "@/hooks/MultiPages/Tasks/useEstimateModal": hook,
    "./EstimateLabelComponent": { __esModule: true, default: Label },
    "@/hooks/useFlag": { useFlag },
    "@/lib/flags/keys": keys,
  }).default;
  const tree = Modal({ mode, closeHandler: value => closes.push(value) });
  const rows = tree.props.children[1].props.children[1].props.children;
  return { rows, Label, writes, closes, refreshes };
}

for (const enabled of [true, false]) {
  for (const index of [0, 1]) {
    test(`flag ${enabled ? "ON" : "OFF"}: clicking ${estimates[index].estimate_value} label words`, async () => {
      const { rows, Label, writes, closes, refreshes } = picker(enabled);
      const label = rows[index].props.children[0].props.children[1];
      assert.equal(label.type, Label);
      const wrapper = Label.type(label.props);
      let prevented = false, stopped = false;
      const click = () => wrapper.props.onClick({
        preventDefault: () => { prevented = true; },
        stopPropagation: () => { stopped = true; },
      });
      if (enabled) click();
      else {
        assert.equal(label.props.onClick, undefined);
        assert.throws(click, /onClick is not a function/);
      }
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(prevented, true);
      assert.equal(stopped, true);
      assert.deepEqual(writes, enabled ? [{ url: "/api/estimate/setEstimate", body: {
        taskId: 42, estimate_index: estimates[index].estimate_index, estimate_value: estimates[index].estimate_value,
      } }] : []);
      assert.deepEqual(closes, enabled ? [true] : []);
      assert.deepEqual(refreshes, enabled ? [{ queryKey: ["comments", 42] }] : []);
    });
  }
  test(`flag ${enabled ? "ON" : "OFF"}: row clicks still set size`, async () => {
    const { rows, writes, closes } = picker(enabled);
    await rows[1].props.onClick();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].body.estimate_index, 3);
    assert.deepEqual(closes, [true]);
  });
}

for (const mode of ["Filter", "Filter-Calendar", "TaskModalGlobally"]) {
  test(`flag ON: ${mode} label uses its existing selection handler`, () => {
    const { rows, Label, writes, closes } = picker(true, mode);
    const label = rows[1].props.children[0].props.children[1];
    Label.type(label.props).props.onClick({ preventDefault: noop, stopPropagation: noop });
    assert.deepEqual(closes, [estimates[1]]);
    assert.deepEqual(writes, []);
  });
}
