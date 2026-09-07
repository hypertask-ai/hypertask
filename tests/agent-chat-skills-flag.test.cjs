const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const modulePath = (relativePath) => path.join(root, relativePath);

test("Agent Chat skill UI follows the feature flag without hiding other skill flows", async () => {
  const stubs = new Map();
  const globals = ["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"];
  const previousGlobals = new Map(
    globals.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)])
  );
  const previousReact = global.React;
  let agentChatSkillsEnabled = true;
  let reactRoot;
  let dom;
  let fetches = 0;

  const stubModule = (relativePath, exports) => {
    const filename = modulePath(relativePath);
    stubs.set(filename, require.cache[filename]);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  };

  try {
    global.React = React;
    stubModule("src/hooks/useFlag.tsx", {
      useFlag: () => agentChatSkillsEnabled,
    });
    stubModule("src/components/Modals/Settings/SettingsToggle.tsx", {
      default: () => React.createElement("span", { "data-settings-toggle": true }),
    });
    stubModule("src/components/Modals/Settings/SettingsSectionShell.tsx", {
      default: ({ children, title }) =>
        React.createElement("section", null, React.createElement("h1", null, title), children),
    });
    stubModule("src/components/Modals/Settings/useSettingsTeam.ts", {
      useSettingsTeam: () => ({ teamId: "team-15", project: { id: 15 } }),
    });
    stubModule("src/lib/state.tsx", {
      useRecoilState: () => [{ id: 15 }, () => undefined],
    });
    stubModule("src/store/index.ts", { currentProjectAtom: {} });
    stubModule("src/assets/AILogo.png", { default: { src: "/ai-logo.png" } });
    stubModule("src/lib/skills/slashSkills.ts", {
      SLASH_MENU_DOM_ID: "slash-command-list",
      fetchSlashSkills: async () => {
        fetches += 1;
        return [{}];
      },
      buildSkillSlashItems: () => [
        {
          title: "Unslop",
          text: "Remove generic AI phrasing",
          type: "Skill",
          aliases: ["unslop"],
          icon: () => null,
        },
      ],
    });

    const jiti = createJiti(__filename, {
      interopDefault: true,
      jsx: true,
      alias: { "@": path.join(root, "src") },
    });
    const SkillLibrary = jiti(
      modulePath("src/components/Modals/Settings/SkillLibrary.tsx")
    ).default;
    const SkillsSection = jiti(
      modulePath("src/components/Modals/Settings/SkillsSection.tsx")
    ).default;
    const BoardSkillsSection = jiti(
      modulePath("src/components/Modals/Settings/BoardSkillsSection.tsx")
    ).default;
    const CommandsList = jiti(
      modulePath("src/components/RTE/Extensions/SlashCommands/CommandsList.tsx")
    ).default;

    const renderSettings = (Component, props = {}) =>
      renderToStaticMarkup(React.createElement(Component, props));

    agentChatSkillsEnabled = true;
    assert.match(renderSettings(SkillLibrary, { scope: "user" }), /Import from GitHub/);
    assert.match(renderSettings(SkillsSection), /Type \/slug in AI chat/);
    assert.match(renderSettings(BoardSkillsSection), /Type \/slug in AI chat/);

    agentChatSkillsEnabled = false;
    const disabledLibrary = renderSettings(SkillLibrary, { scope: "user" });
    assert.doesNotMatch(disabledLibrary, /Import from GitHub/);
    assert.match(disabledLibrary, /New skill/);
    for (const html of [renderSettings(SkillsSection), renderSettings(BoardSkillsSection)]) {
      assert.doesNotMatch(html, /Type \/slug in AI chat/);
      assert.match(html, /Type @hyperai \/slug in a comment/);
    }

    dom = new JSDOM('<div id="root"></div>', {
      url: "https://app.hypertask.ai/agent-chat",
    });
    global.window = dom.window;
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.getElementById("root");
    reactRoot = createRoot(container);
    const propsForMode = (mode) => ({
      command: () => undefined,
      editor: { storage: { slashCommands: { mode } } },
      items: [],
      query: "",
    });

    agentChatSkillsEnabled = true;
    await React.act(async () => {
      reactRoot.render(React.createElement(CommandsList, propsForMode("ai-chat")));
    });
    assert.match(container.textContent, /Unslop/);

    agentChatSkillsEnabled = false;
    await React.act(async () => {
      reactRoot.render(React.createElement(CommandsList, propsForMode("ai-chat")));
    });
    assert.doesNotMatch(container.textContent, /Unslop/);

    await React.act(async () => {
      reactRoot.render(React.createElement(CommandsList, propsForMode("create-comment")));
    });
    assert.match(container.textContent, /Unslop/);
    assert.equal(fetches, 2);
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    dom?.window.close();
    for (const [filename, previous] of stubs) {
      if (previous === undefined) delete require.cache[filename];
      else require.cache[filename] = previous;
    }
    if (previousReact === undefined) delete global.React;
    else global.React = previousReact;
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor === undefined) delete global[name];
      else Object.defineProperty(global, name, descriptor);
    }
  }
});
