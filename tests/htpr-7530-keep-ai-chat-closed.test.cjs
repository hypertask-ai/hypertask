process.env.FEATURE_FLAG_TYPESCRIPT_PATH = require.resolve("typescript");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const flagKey = "htpr-7530-keep-ai-chat-closed";
const flagModule = { HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG: flagKey, HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG: "htpr-7650-ai-chat-open-switches" };
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function load(file, mocks) {
  const loadedModule = { exports: {} };
  const js = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("require", "module", "exports", js)((name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    assert.ok(name.startsWith("react"), `unmocked dependency: ${name}`);
    return require(name);
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

test("the client-safe flag is an Everyone improvement with release risk", async () => {
  const filename = `src/lib/flags/definitions/${flagKey}.ts`;
  const { parseFlagFile } = await import("../.github/scripts/feature-flag-registry.mjs");
  const { definition } = parseFlagFile(read(filename), filename);
  assert.equal(definition.key, flagKey);
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
});

test("the shared veto ignores a saved value with flag off and waits only when a saved veto needs flag resolution", () => {
  for (const enabled of [false, true]) {
    for (const ready of [false, true]) {
      for (const saved of [false, true]) {
        const { useKeepAiChatClosed } = load("src/hooks/General/useKeepAiChatClosed.ts", {
          "@/hooks/useFlag": { useFlag: (key) => { assert.equal(key, flagKey); return enabled; }, useFlagReady: () => ready },
          "@/lib/state": { useRecoilValue: () => saved }, "@/store": { keepAiChatClosedAtom: "saved" },
          "@/lib/flags/keys": flagModule,
        });
        assert.deepEqual(useKeepAiChatClosed(), { keepAiChatClosed: enabled && saved, ready: !saved || ready });
      }
    }
  }
});

test("Task Page reuses the adjacent SettingsToggle row, preserves the other setting, and hides the new row with flag off", () => {
  const Toggle = () => null;
  const inert = { __esModule: true, default: () => null };
  for (const enabled of [false, true]) {
    for (const saved of [false, true]) {
      const values = { open: true, closed: saved };
      const { default: Section } = load("src/components/Modals/Settings/TaskPageSection.tsx", {
        "@/hooks/General/useAiChatOpenPreferences": { useAiChatOpenPreferences: () => ({ enabled: false }) },
        "@/components/sidebars/RightSidebar/UserPreference": inert,
        "@/lib/state": { useRecoilState: (key) => [values[key], (next) => { values[key] = next(values[key]); }] },
        "@/store": { openAiChatByDefaultAtom: "open", keepAiChatClosedAtom: "closed" },
        "@/hooks/useFlag": { useFlag: (key) => { if (key === flagModule.HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG) return false; if (key === "htpr-8088-manual-chat") return false; assert.equal(key, flagKey); return enabled; } },
        "@/lib/flags/keys": flagModule,
        "@/lib/flags/definitions/htpr-8088-manual-chat": { HTPR_8088_MANUAL_CHAT_FLAG: "htpr-8088-manual-chat" },
        "./SettingsCard": inert, "./SettingsScrollPicker": inert, "./SettingsSectionShell": inert,
        "./SettingsToggle": { __esModule: true, default: Toggle },
      });
      const card = Section().props.children;
      const children = React.Children.toArray(card.props.children).flatMap((child) => child.type === React.Fragment ? React.Children.toArray(child.props.children) : [child]);
      const toggles = children.filter((child) => child.type === Toggle);
      assert.equal(toggles.length, enabled ? 2 : 1);
      assert.equal(toggles[0].props.label, "Open AI chat by default");
      if (enabled) {
        const row = toggles[1];
        assert.equal(children.indexOf(row), children.indexOf(toggles[0]) + 1);
        assert.deepEqual(Object.keys(row.props).sort(), Object.keys(toggles[0].props).sort(), "no extra elements, props or styling");
        assert.equal(row.props.label, "Keep AI chat closed always");
        assert.equal(row.props.inputId, "keep-ai-chat-closed-always");
        assert.equal(row.props.value, saved);
        assert.equal(row.props.checked, saved);
        row.props.onChange();
        assert.equal(values.closed, !saved);
        assert.equal(values.open, true);
        row.props.onChange();
        assert.equal(values.closed, saved);
      } else {
        assert.equal(values.closed, saved, "flag off must not erase the stored value");
      }
    }
  }
});

test("closed automatic chat reserves no empty column, but manually opened chat still reserves its width", () => {
  for (const keepAiChatClosed of [false, true]) {
    for (const ready of [false, true]) {
      const { usePageLoadReservations } = load("src/hooks/General/usePageLoadReservations.ts", {
        "@/hooks/useFlag": { useFlag: () => false },
        "@/lib/flags/definitions/htpr-7650-ai-chat-open-switches": { HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG: "htpr-7650-ai-chat-open-switches" },
        "@/hooks/General/useKeepAiChatClosed": { useKeepAiChatClosed: () => ({ keepAiChatClosed, ready }) },
        "@/lib/state": { useRecoilValue: (key) => ({ pinned: true, open: true, sidebar: true, width: 517 })[key] },
        "@/store": { aiChatPinnedAtom: "pinned", openAiChatByDefaultAtom: "open", isAiChatSidebarModeAtom: "sidebar", aiChatSidebarWidthPxAtom: "width" },
        "@/lib/configs/style.config": { AI_CHAT_SIDEBAR_MIN_PX: 340 },
        "@/components/Global/mobileShellVisibility": { shouldShowMobileTabBar: () => false, shouldShowMobileDock: () => false, shouldShowMobilePrimaryDock: () => false, isTicketPagePath: () => false },
      });
      for (const pathname of ["/project", "/detail/project-15/1", "/inbox"]) {
        for (const showAiChatInterface of [false, true]) {
          const result = usePageLoadReservations({ mbl: false, pathname, authenticatedUserId: 985, currentUserId: 985,
            showAiChatInterface, reserveBoardChat: pathname === "/project", aiChatAutoOpenSuppressed: false,
            commentComposerOpen: false, agentChatHidesMobileShell: false });
          const reserved = showAiChatInterface || (ready && !keepAiChatClosed && pathname !== "/inbox");
          assert.equal(result.sidebarWidthPx, reserved ? 517 : 0);
        }
      }
    }
  }
});

test("the palette adds keep-closed search words only with the ticket flag and never mutates its registry", () => {
  const { createJiti } = require("jiti");
  const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
  const { getAllCommands } = jiti(path.join(root, "src/components/Modals/commands/HTC/AllCommands.ts"));
  for (const enabled of [false, true, false]) {
    const groups = getAllCommands(undefined, undefined, false, enabled ? "keep ai chat closed always" : "");
    const command = groups.flatMap((group) => group.commandLists).find((item) => item.key === "settingsTaskPageOpenAiChatByDefault");
    assert.equal(command.keywords, enabled
      ? "settings open ai chat by default keep ai chat closed always task page"
      : "settings open ai chat by default task page");
    assert.equal(command.payload, "task-page");
  }
});
