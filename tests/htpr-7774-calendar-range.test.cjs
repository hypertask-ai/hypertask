const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { load } = require("./task-route-loader.cjs");

const modalFile = "src/components/Modals/FilterModals/UpdatedAtRange/index.tsx";
const flag = "htpr-7774-inclusive-calendar-range";
const predicates = load("src/utils/helperFunctions/Views/FilterHelperFunctions.ts", {
  "@/utils/helperFunctions/helperFunctions": {},
  "./ViewsHelperFunctions": {},
  "@/lib/constants/builtinViews": {},
});

function modal(mode, enabled = true) {
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
    "@/utils/helperFunctions/Views/FilterHelperFunctions": predicates,
    "@/hooks/MultiPages/Filters/useDateFilter": {},
    "@/hooks/useFlag": { useFlag: (key) => key === flag && enabled },
    "@/lib/flags/keys": { HTPR_7774_INCLUSIVE_CALENDAR_RANGE_FLAG: flag },
  };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, "..", modalFile), "utf8"), {
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

const modes = [
  ["createdAt", "createdAtFilterCondition", "createdAt"],
  ["updatedAt", "dateFilterCondition", "updatedAt"],
  ["dueDate", "dueDateFilterCondition", "dueDate"],
];

for (const [mode, predicate, field] of modes) {
  test(`${mode} custom calendar range includes the entire final day only`, () => {
    const from = new Date(2026, 10, 17);
    const to = new Date(2026, 10, 18);
    const payload = modal(mode).custom({ from, to });
    const matches = (date) => predicates[predicate]({ [field]: date.toISOString() }, [payload]);
    assert.equal(matches(new Date(2026, 10, 18, 12)), true);
    assert.equal(matches(new Date(2026, 10, 18, 23, 59, 59, 999)), true);
    assert.equal(matches(new Date(2026, 10, 17)), true);
    assert.equal(matches(new Date(2026, 10, 19)), false);
    assert.equal(matches(new Date(2026, 10, 16, 23, 59, 59, 999)), false);
    assert.equal(payload.fromDate, from.toISOString());
    assert.equal(payload.toDate, new Date(2026, 10, 18, 23, 59, 59, 999).toISOString());
    assert.equal(to.getHours(), 0);
  });

  test(`${mode} flag off preserves midnight and exact timestamp predicates`, () => {
    const payload = modal(mode, false).custom({ from: new Date(2026, 10, 17), to: new Date(2026, 10, 18) });
    assert.equal(predicates[predicate]({ [field]: new Date(2026, 10, 17, 12).toISOString() }, [payload]), true);
    assert.equal(predicates[predicate]({ [field]: new Date(2026, 10, 18, 12).toISOString() }, [payload]), false);
    const exact = [{ fromDate: "2026-11-18T10:00:00.000Z", toDate: "2026-11-18T11:00:00.000Z" }];
    assert.equal(predicates[predicate]({ [field]: "2026-11-18T10:30:00.000Z" }, exact), true);
    assert.equal(predicates[predicate]({ [field]: "2026-11-18T12:00:00.000Z" }, exact), false);
  });
}

test("single-day and DST calendar ranges end at local day end without mutating selection", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    for (const [month, day] of [[2, 8], [10, 1]]) {
      const date = new Date(2026, month, day);
      const payload = modal("createdAt").custom({ from: date, to: date });
      assert.equal(payload.fromDate, date.toISOString());
      assert.equal(payload.toDate, new Date(2026, month, day, 23, 59, 59, 999).toISOString());
      assert.equal(date.getHours(), 0);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("calendar fix leaves natural-language, dynamic, reset and open-ended selections unchanged", () => {
  const fixture = modal("createdAt");
  fixture.sugar({ date: "2026-11-18T12:00:00.000Z" });
  assert.deepEqual(fixture.results.at(-1), [{
    fromDate: "2026-11-18T12:00:00.000Z", toDate: null,
    selectedDate: "2026-11-18T12:00:00.000Z", condition: "AFTER", dynamicRange: null,
  }]);
  fixture.sugar({ isDynamic: true, dynamicRange: "THIS_WEEK" });
  assert.deepEqual(fixture.results.at(-1), [{
    fromDate: null, toDate: null, selectedDate: null, condition: null, dynamicRange: "THIS_WEEK",
  }]);
  fixture.sugar({ display: "Reset" });
  assert.deepEqual(fixture.results.at(-1), [null, true]);
  const from = new Date(2026, 10, 18);
  assert.deepEqual(modal("createdAt").custom({ from }), {
    fromDate: from.toISOString(), toDate: null, selectedDate: from.toISOString(), condition: null, dynamicRange: null,
  });
});

test("calendar range bugfix defaults to Everyone with a rollback risk declaration", () => {
  const { default: definition } = load(`src/lib/flags/definitions/${flag}.ts`, {});
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason.length > 0);
});
