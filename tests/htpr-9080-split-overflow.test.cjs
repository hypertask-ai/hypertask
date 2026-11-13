const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule, findElement } = require("./helpers/loadModule.cjs");

const flag = "htpr-9080-split-overflow";

function preferencesRoute(enabled, body, userId = 985) {
  const writes = [];
  const empty = {};
  const route = loadModule("src/app/api/users/preferences/route.ts", {
    "@/lib/ai/htpr7038ModelReset": { ensureHtpr7038ModelReset: async () => "done" },
    "@/lib/auth/currentUser": { loadCurrentUser: async () => ({ userId }) },
    "@/lib/flags": {
      isFeatureEnabled: async (key, id) => {
        if (key !== flag) return false;
        assert.equal(id, userId);
        return enabled;
      },
    },
    "@/lib/mcp/readJsonBody": { readJsonBody: async () => ({ ok: true, body }) },
    "next/server": { NextResponse: { json: (data, options) => ({ data, status: options?.status ?? 200 }) } },
    "next/headers": empty,
    "@/lib/prisma": {
      default: {
        userSetting: {
          update: async ({ where, data }) => {
            writes.push({ where, data });
            return data;
          },
          findUnique: async () => null,
          updateMany: async () => ({}),
        },
      },
    },
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
  return { post: () => route.POST({ headers: {} }), writes };
}

test("Overflow hidden is a new feature that starts at Owner + QA", () => {
  const { default: definition, HTPR_9080_SPLIT_OVERFLOW_FLAG: exported } = loadModule(
    "src/lib/flags/definitions/htpr-9080-split-overflow.ts",
  );
  assert.equal(exported, flag);
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
});

test("split layout refuses anything but a saved boolean, whatever the flag says", async () => {
  for (const enabled of [false, true]) {
    for (const value of [null, undefined, "true", 0, [], {}]) {
      const route = preferencesRoute(enabled, { inboxSplitsOverflowHidden: value });
      assert.equal((await route.post()).status, 400);
      assert.deepEqual(route.writes, []);
    }
  }
});

test("split layout saves only for the signed-in person and only while the flag is on", async () => {
  for (const userId of [985, 77]) {
    for (const enabled of [false, true]) {
      for (const value of [false, true]) {
        const route = preferencesRoute(enabled, { inboxSplitsOverflowHidden: value }, userId);
        assert.equal((await route.post()).status, 200);
        assert.deepEqual(route.writes, [
          { where: { userId }, data: enabled ? { inboxSplitsOverflowHidden: value } : {} },
        ]);
      }
    }
  }
});

function renderModal({ enabled, saved = false, saveWorks = true }) {
  const writes = [];
  const errors = [];
  const SettingsToggle = () => null;
  let preferences = { inboxSplitsOverflowHidden: saved };
  const Modal = loadModule("src/components/notifications/ManageSplitsModal.tsx", {
    react: {
      useState: (initial) => [initial, () => {}],
      useEffect: () => {},
      useMemo: (fn) => fn(),
    },
    reactstrap: { ModalBody: () => null },
    "react-hot-toast": { default: { error: (message) => errors.push(message) } },
    "@tanstack/react-query": {
      useQueryClient: () => ({
        setQueryData: (_, update) => {
          preferences = update(preferences);
        },
        invalidateQueries: async () => {},
      }),
    },
    "@/components/Common/CommonModalComponents": {
      ModalContainerCustom: () => null,
      ModalFooterComp: () => null,
      ModalHeaderComp: () => null,
    },
    "@/components/Modals/Settings/SettingsToggle": {
      default: SettingsToggle,
    },
    "@/hooks/useFlag": { useFlag: (key) => key === flag && enabled },
    "@/hooks/General/useGetUserPreferences": {
      useGetUserPreferences: () => ({ data: preferences }),
      USER_PREFERENCES_QUERY_KEY: ["user-preferences"],
    },
    "@/lib/inboxSplitSettings": { getInboxSplitKey: () => "key" },
    "@/hooks/Inbox/useGetNotifications": {
      inboxDataQueryKey: () => ["inbox"],
      INBOX_QUERY_KEY: ["inbox"],
    },
    "@/lib/inboxSync/optimistic": { updateInboxOptimistically: () => {} },
  }).default;
  const tree = Modal({ userId: 985, tabs: [], splitsNoImportant: [], onClose: () => {} });
  const toggle = findElement(tree, SettingsToggle);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    writes.push({ url, body: JSON.parse(options.body) });
    return { ok: saveWorks };
  };
  return {
    toggle,
    writes,
    errors,
    preferences: () => preferences,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test("the Layout section and square toggle appear only with the flag on", async () => {
  const hidden = renderModal({ enabled: false });
  assert.equal(hidden.toggle, undefined);
  hidden.restore();

  const shown = renderModal({ enabled: true, saved: true });
  assert.equal(shown.toggle.props.label, "Overflow hidden");
  assert.equal(shown.toggle.props.square, true);
  assert.equal(shown.toggle.props.checked, true);
  shown.restore();
});

test("turning the toggle on saves optimistically and keeps the saved value", async () => {
  const modal = renderModal({ enabled: true, saved: false, saveWorks: true });
  modal.toggle.props.onChange();
  assert.equal(modal.preferences().inboxSplitsOverflowHidden, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(modal.writes, [
    { url: "/api/users/preferences", body: { inboxSplitsOverflowHidden: true } },
  ]);
  assert.equal(modal.preferences().inboxSplitsOverflowHidden, true);
  assert.deepEqual(modal.errors, []);
  modal.restore();
});

test("a failed save puts the toggle back and says so", async () => {
  const modal = renderModal({ enabled: true, saved: false, saveWorks: false });
  modal.toggle.props.onChange();
  assert.equal(modal.preferences().inboxSplitsOverflowHidden, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(modal.preferences().inboxSplitsOverflowHidden, false);
  assert.deepEqual(modal.errors, ["Unable to save split layout"]);
  modal.restore();
});
