const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { loadModule } = require("./helpers/loadModule.cjs");

const flag = "htpr-9080-split-overflow";
const root = path.resolve(__dirname, "..");

function preferencesApi(enabled, body, userId = 985) {
  const writes = [];
  const empty = {};
  const api = loadModule("src/app/api/users/preferences/route.ts", {
    "@/lib/ai/htpr7038ModelReset": { ensureHtpr7038ModelReset: async () => "done" },
    "@/lib/auth/currentUser": { loadCurrentUser: async () => ({ userId }) },
    "@/lib/flags": { isFeatureEnabled: async (key, id) => {
      assert.equal(key, flag);
      assert.equal(id, userId);
      return enabled;
    } },
    "@/lib/mcp/readJsonBody": { readJsonBody: async () => ({ ok: true, body }) },
    "next/server": { NextResponse: { json: (data, options) => ({ data, status: options?.status ?? 200 }) } },
    "next/headers": empty,
    "@/lib/prisma": { default: { userSetting: {
      update: async ({ where, data }) => { writes.push({ where, data }); return data; },
    } } },
    "@prisma/client": empty,
    "@/utils/controllers/users/fetch_preferences": { invalidateUserPreferenceCache: async () => {} },
    "@/lib/aiModelPreferences": empty,
    "@/lib/aiModelOptions": empty,
    "@/lib/aiThinkingPreference": empty,
    "@/utils/helperFunctions/sanitizeRichHtml": empty,
    "@/lib/dictationProvider": empty,
    "@/lib/configs/allTasks.config": empty,
    "@/models/Calendar/model": empty,
    "@/lib/configs/boardSortMode.config": empty,
  });
  return { post: () => api.POST({ headers: {} }), writes };
}

test("Overflow hidden is an Owner + QA feature", () => {
  const { default: definition } = loadModule("src/lib/flags/definitions/htpr-9080-split-overflow.ts");
  assert.equal(definition.key, flag);
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
});

test("split layout validates booleans even when its flag is off", async () => {
  for (const enabled of [false, true]) {
    for (const value of [null, undefined, "true", 0, [], {}]) {
      const h = preferencesApi(enabled, { inboxSplitsOverflowHidden: value });
      assert.equal((await h.post()).status, 400);
      assert.deepEqual(h.writes, []);
    }
  }
});

test("split layout writes only for the authenticated person and enabled flag", async () => {
  for (const userId of [985, 77]) {
    for (const enabled of [false, true]) {
      for (const value of [false, true]) {
        const h = preferencesApi(enabled, { inboxSplitsOverflowHidden: value, userId: 6 }, userId);
        assert.equal((await h.post()).status, 200);
        assert.deepEqual(h.writes, [{ where: { userId }, data: enabled ? { inboxSplitsOverflowHidden: value } : {} }]);
      }
    }
  }
});

function splitBar({ enabled = true, saved = true, selected = 0 } = {}) {
  const source = fs.readFileSync(path.join(root, "src/app/inbox/Inbox.tsx"), "utf8");
  const component = source.slice(source.indexOf("const SplitTitlesContainer:"), source.indexOf("const ButtonGroup ="));
  const compiled = ts.transpileModule(`${component}\nmodule.exports = SplitTitlesContainer;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const slots = [], effects = [];
  let cursor = 0;
  const hooks = {
    useRef: (value) => { const i = cursor++; return slots[i] ??= { current: value }; },
    useState: (value) => { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], (next) => { slots[i] = next; }]; },
    useEffect: () => {},
    useLayoutEffect: (fn) => effects.push(fn),
    useFlag: (key) => key === flag && enabled,
    useGetUserPreferences: () => ({ data: { inboxSplitsOverflowHidden: saved } }),
    useRecoilState: () => [{ currSplit: selected }],
    HTPR_9080_SPLIT_OVERFLOW_FLAG: flag,
    HTPR_9029_STICKY_SPLITS_FLAG: "sticky",
    globalNotificationFocusAtom: {},
    ChevronLeft: () => null,
    ChevronRight: () => null,
    ButtonGroup: () => null,
    HTMLElement: class {},
    ResizeObserver: class { observe() {} disconnect() {} },
  };
  const mod = { exports: {} };
  new Function("require", "module", ...Object.keys(hooks), compiled)(require, mod, ...Object.values(hooks));
  const render = () => { cursor = 0; effects.length = 0; return mod.exports({ children: ["First", "Last"] }); };
  const tree = render();
  const row = tree.props.children.find((child) => child?.props?.["data-testid"] === "inbox-split-titles");
  const listeners = {};
  const scrolls = [];
  const dom = {
    scrollLeft: 0, clientWidth: 300, scrollWidth: 900, children: [],
    addEventListener: (name, fn) => { listeners[name] = fn; },
    removeEventListener: () => {},
    scrollBy: (options) => scrolls.push(options),
  };
  (row.ref ?? row.props.ref).current = dom;
  for (const effect of effects) effect();
  return { render, row, dom, listeners, scrolls, runEffects: () => effects.forEach((effect) => effect()), HTMLElement: hooks.HTMLElement };
}

test("disabled or unset layout keeps the wrapping row and no arrows", () => {
  for (const options of [{ enabled: false }, { saved: false }, { saved: undefined }]) {
    const h = splitBar({ ...options, saved: options.saved ?? false });
    assert.match(h.row.props.className, /flex-wrap/);
    assert.doesNotMatch(h.row.props.className, /flex-nowrap/);
    assert.equal(h.render().props.children.filter((child) => child?.type === "button").length, 0);
  }
});

test("enabled layout scrolls one nonshrinking line and arrows page the row", () => {
  const h = splitBar();
  assert.match(h.row.props.className, /flex-nowrap overflow-x-auto/);
  assert.match(h.row.props.className, /\[&>div\]:shrink-0/);
  let buttons = h.render().props.children.filter((child) => child?.type === "button");
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].props.disabled, true);
  assert.equal(buttons[1].props.disabled, false);
  buttons[1].props.onClick();
  assert.deepEqual(h.scrolls.pop(), { left: 225, behavior: "smooth" });
  h.dom.scrollLeft = 600;
  h.listeners.scroll();
  buttons = h.render().props.children.filter((child) => child?.type === "button");
  assert.equal(buttons[0].props.disabled, false);
  assert.equal(buttons[1].props.disabled, true);
  buttons[0].props.onClick();
  assert.deepEqual(h.scrolls.pop(), { left: -225, behavior: "smooth" });
});

test("selected split reveals horizontally without moving the inbox vertically", () => {
  const h = splitBar({ selected: 1 });
  const selected = new h.HTMLElement();
  selected.getBoundingClientRect = () => ({ left: 700, right: 800 });
  h.dom.children = [{}, selected];
  h.dom.getBoundingClientRect = () => ({ left: 0, right: 300 });
  h.render();
  h.runEffects();
  assert.equal(h.dom.scrollLeft, 500);
  selected.getBoundingClientRect = () => ({ left: -100, right: 0 });
  h.runEffects();
  assert.equal(h.dom.scrollLeft, 400);
});

test("layout toggle saves optimistically, restores failures, and is absent with flag off", async (t) => {
  for (const enabled of [false, true]) {
    for (const success of [false, true]) {
      let preferences = { inboxSplitsOverflowHidden: false };
      const errors = [], writes = [];
      const SettingsToggle = () => null;
      const queryClient = {
        setQueryData: (_, update) => { preferences = update(preferences); },
        invalidateQueries: async () => {},
      };
      const { default: Modal } = loadModule("src/components/notifications/ManageSplitsModal.tsx", {
        react: { useState: (initial) => [initial, () => {}], useEffect: () => {}, useMemo: (fn) => fn() },
        reactstrap: { ModalBody: () => null },
        "react-hot-toast": { default: { error: (message) => errors.push(message) } },
        "@tanstack/react-query": { useQueryClient: () => queryClient },
        "@/components/Common/CommonModalComponents": { ModalContainerCustom: () => null, ModalFooterComp: () => null, ModalHeaderComp: () => null },
        "@/components/Modals/Settings/SettingsToggle": { default: SettingsToggle },
        "@/hooks/useFlag": { useFlag: () => enabled },
        "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: preferences }), USER_PREFERENCES_QUERY_KEY: ["user-preferences"] },
        "@/lib/inboxSplitSettings": {},
        "@/hooks/Inbox/useGetNotifications": { inboxDataQueryKey: () => ["inbox"], INBOX_QUERY_KEY: ["inbox"] },
        "@/lib/inboxSync/optimistic": {},
      });
      const flatten = (node) => !node ? [] : [node, ...[].concat(node.props?.children ?? []).flatMap(flatten)];
      const toggle = flatten(Modal({ userId: 985, tabs: [], splitsNoImportant: [], onClose: () => {} }))
        .find((node) => node.type === SettingsToggle);
      if (!enabled) { assert.equal(toggle, undefined); continue; }
      assert.equal(toggle.props.label, "Overflow hidden");
      assert.equal(toggle.props.checked, false);
      assert.equal(toggle.props.square, true);
      const fetchMock = t.mock.method(globalThis, "fetch", async (url, options) => {
        writes.push({ url, body: JSON.parse(options.body) });
        return { ok: success };
      });
      toggle.props.onChange();
      assert.equal(preferences.inboxSplitsOverflowHidden, true);
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(writes, [{ url: "/api/users/preferences", body: { inboxSplitsOverflowHidden: true } }]);
      assert.equal(preferences.inboxSplitsOverflowHidden, success);
      assert.deepEqual(errors, success ? [] : ["Unable to save split layout"]);
      fetchMock.mock.restore();
    }
  }
});
