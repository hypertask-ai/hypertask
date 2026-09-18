const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const stubs = new Map();

function stubModule(filename, exports) {
  stubs.set(filename, require.cache[filename]);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

test("Slack default project select uses the flat settings control style", () => {
  stubModule(require.resolve("@tanstack/react-query"), {
    useQuery: () => ({
      data: {
        install: {
          defaultProjectId: 1,
          slackTeamId: "slack-team",
          slackTeamName: "Workspace",
        },
      },
      error: null,
      isLoading: false,
    }),
    useQueryClient: () => ({
      invalidateQueries: async () => {},
      setQueryData: () => {},
    }),
  });
  stubModule(require.resolve("next/navigation"), {
    useSearchParams: () => new URLSearchParams(),
  });
  stubModule(path.join(root, "src/components/Modals/Settings/SettingsCard.tsx"), {
    default: ({ children }) => React.createElement("div", null, children),
  });
  stubModule(
    path.join(root, "src/components/Modals/Settings/SettingsBillingRow.tsx"),
    {
      BillingActionRow: ({ action }) => React.createElement("div", null, action),
      settingsActionButtonClass: "",
    },
  );
  stubModule(
    path.join(root, "src/components/Modals/Settings/SettingsSectionShell.tsx"),
    {
      default: ({ children }) => React.createElement("section", null, children),
    },
  );
  stubModule(
    path.join(root, "src/components/Modals/Settings/useSettingsTeam.ts"),
    {
      useSettingsTeam: () => ({
        projects: [{ id: 1, name: "Project", teamId: "team-1" }],
        teamId: "team-1",
      }),
    },
  );

  const previousReact = global.React;
  global.React = React;
  try {
    const jiti = createJiti(__filename, {
      interopDefault: true,
      jsx: true,
      alias: { "@": path.join(root, "src") },
    });
    const SlackSection = jiti(
      path.join(root, "src/components/Modals/Settings/SlackSection.tsx"),
    ).default;

    const html = renderToStaticMarkup(React.createElement(SlackSection));
    const select = html.match(
      /<select[^>]*aria-label="Default Slack project"[^>]*>/,
    )?.[0];

    assert.ok(select, "default project select should render for a connected workspace");
    assert.doesNotMatch(select, /\bshadow(?:-|\[)/);
  } finally {
    for (const [filename, previous] of stubs) {
      if (previous === undefined) delete require.cache[filename];
      else require.cache[filename] = previous;
    }
    if (previousReact === undefined) delete global.React;
    else global.React = previousReact;
  }
});
