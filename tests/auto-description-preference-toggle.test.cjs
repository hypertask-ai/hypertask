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

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test("rapid description preference toggles persist each cache-derived value in order", async () => {
  const firstRequest = deferred();
  const posts = [];
  let preferenceToggle;
  let cachedPreferences = {
    displayAvatar: "Hidden",
    commentsStacked: false,
    shareReadReceipts: false,
    scrollSetting: "Bottom",
    notification: false,
    notificationPreference: "direct",
    playGifs: true,
    autoDescriptionSuggestions: true,
    dictationLanguage: "en",
    inboxAdvanceOnSend: true,
  };
  const queryClient = {
    setQueryData: (_key, updater) => {
      cachedPreferences = updater(cachedPreferences);
    },
  };
  const axiosStub = {
    post: async (_url, body) => {
      posts.push(body);
      if (posts.length === 1) await firstRequest.promise;
      return { status: 200, data: { settings: body } };
    },
  };

  stubModule(require.resolve("axios"), { default: axiosStub });
  stubModule(require.resolve("@tanstack/react-query"), {
    useQueryClient: () => queryClient,
  });
  stubModule(path.join(root, "src/lib/state.tsx"), {
    useRecoilState: () => [false, () => {}],
  });
  stubModule(path.join(root, "src/store/index.ts"), {
    showTaskHistoryAtom: {},
  });
  stubModule(
    path.join(root, "src/hooks/General/useGetUserPreferences.tsx"),
    {
      USER_PREFERENCES_QUERY_KEY: ["user-preferences"],
      useGetUserPreferences: () => ({ data: cachedPreferences }),
    },
  );
  stubModule(path.join(root, "src/lib/dictationProvider.ts"), {
    DEFAULT_DICTATION_LANGUAGE: "en",
    DICTATION_LANGUAGE_OPTIONS: [{ value: "en", label: "English" }],
  });
  stubModule(
    path.join(
      root,
      "src/components/sidebars/RightSidebar/Single section items.tsx",
    ),
    { ToggleSwitch: () => null },
  );

  const previousReact = global.React;
  global.React = React;
  try {
    const jiti = createJiti(__filename, {
      interopDefault: true,
      jsx: true,
      alias: { "@": path.join(root, "src") },
    });
    const UserPreferenceSidebar = jiti(
      path.join(
        root,
        "src/components/sidebars/RightSidebar/UserPreference.tsx",
      ),
    ).default;
    const ToggleComponent = (props) => {
      if (props.inputId === "auto-description-suggestions-toggle") {
        preferenceToggle = props.onChange;
      }
      return React.createElement("span", { "data-toggle": props.inputId });
    };

    renderToStaticMarkup(
      React.createElement(UserPreferenceSidebar, { ToggleComponent }),
    );
    preferenceToggle();
    preferenceToggle();

    assert.equal(cachedPreferences.autoDescriptionSuggestions, true);
    await Promise.resolve();
    assert.deepEqual(posts, [{ autoDescriptionSuggestions: false }]);

    firstRequest.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(posts, [
      { autoDescriptionSuggestions: false },
      { autoDescriptionSuggestions: true },
    ]);
    assert.equal(cachedPreferences.autoDescriptionSuggestions, true);
  } finally {
    for (const [filename, previous] of stubs) {
      if (previous === undefined) delete require.cache[filename];
      else require.cache[filename] = previous;
    }
    if (previousReact === undefined) delete global.React;
    else global.React = previousReact;
  }
});
