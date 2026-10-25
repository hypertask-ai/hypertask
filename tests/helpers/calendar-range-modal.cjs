const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { load } = require("../task-route-loader.cjs");

const modalFile = "src/components/Modals/FilterModals/UpdatedAtRange/index.tsx";
const flag = "htpr-7774-inclusive-calendar-range";
const { default: definition } = load(`src/lib/flags/definitions/${flag}.ts`, {});

function modal(mode, enabled = definition.defaultMode === "EVERYONE") {
  let screen = "Sugar";
  const results = [];
  const stubs = {
    "react/jsx-runtime": require("react/jsx-runtime"),
    react: {
      useState: () => [screen, (next) => { screen = next; }],
      useCallback: (callback) => callback,
    },
    "date-fns": require("date-fns"),
    reactstrap: {},
    "@/components/Common/Calendar": {},
    "@/components/Common/CommonModalComponents": {},
    "@/hooks/General/useHandleMouse": {},
    "@/utils/generateTime": {},
    "@/components/Common/Tooltip": {},
    "@/utils/helperFunctions/Views/FilterHelperFunctions": {},
    "@/hooks/MultiPages/Filters/useDateFilter": {},
    "@/hooks/useFlag": { useFlag: (key) => key === flag && enabled },
    "@/lib/flags/keys": { HTPR_7774_INCLUSIVE_CALENDAR_RANGE_FLAG: flag },
  };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../..", modalFile), "utf8"), {
    fileName: modalFile,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)((request) => {
    assert.ok(request in stubs, `Unexpected import: ${request}`);
    return stubs[request];
  }, loaded, loaded.exports);
  const render = () => loaded.exports.default({
    mode,
    closeHandler: (...args) => results.push(args),
  }).props.children[1].props.children.props;
  return {
    results,
    sugar: (payload) => render().closebackHandler(payload),
    custom: (payload) => {
      render().closebackHandler({ display: "Pick a custom date range" });
      render().closebackHandler(payload);
      return results.at(-1)[0];
    },
  };
}

module.exports = { modal };
