const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const test = require("node:test");
const jitiModule = require("jiti");

const root = path.resolve(__dirname, "..");
const modulePath = (relativePath) => path.join(root, relativePath);

test("Settings renders announcement controls and posts", () => {
  const previousReact = global.React;
  const stubs = new Map();
  let announcementToggle;
  let toggleMuteCalls = 0;
  const stubModule = (relativePath, exports) => {
    const filename = modulePath(relativePath);
    stubs.set(filename, require.cache[filename]);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  };

  try {
    global.React = React;
    stubModule("src/lib/state.tsx", {
      useRecoilValue: () => ({ id: 6 }),
    });
    stubModule("src/store/index.ts", { currentUserAtom: {} });
    stubModule("src/hooks/General/useGetUserPreferences.tsx", {
      useAnnouncementMute: () => ({
        muted: false,
        toggleMute: () => {
          toggleMuteCalls += 1;
        },
      }),
    });
    stubModule("src/hooks/MultiPages/Sidebar/useGetAnnouncements.ts", {
      useGetAnnouncements: () => ({ data: [{ id: 1, readAt: null }] }),
    });
    stubModule("src/components/sidebars/Announcements/index.tsx", {
      AnnouncementPosts: ({ allPosts }) =>
        React.createElement("div", { "data-announcement-count": allPosts.length }),
    });
    stubModule("src/components/Modals/Settings/SettingsCard.tsx", {
      default: ({ children }) => React.createElement("div", null, children),
    });
    stubModule("src/components/Modals/Settings/SettingsSectionShell.tsx", {
      default: ({ children, title }) =>
        React.createElement(
          "section",
          null,
          React.createElement("h1", null, title),
          children,
        ),
    });
    stubModule("src/components/Modals/Settings/SettingsToggle.tsx", {
      default: ({ checked, label, onChange }) => {
        announcementToggle = onChange;
        return React.createElement("input", {
          "aria-label": label,
          checked,
          readOnly: true,
          type: "checkbox",
        });
      },
    });

    const jiti = jitiModule.createJiti
      ? jitiModule.createJiti(__filename, {
          interopDefault: true,
          jsx: true,
          alias: { "@": path.join(root, "src") },
        })
      : jitiModule(__filename, {
          interopDefault: true,
          jsx: true,
          alias: { "@": path.join(root, "src") },
        });
    const AnnouncementsSection = jiti(
      modulePath("src/components/Modals/Settings/AnnouncementsSection.tsx"),
    ).default;
    const html = renderToStaticMarkup(React.createElement(AnnouncementsSection));

    assert.match(html, /<h1>Latest updates<\/h1>/);
    assert.match(html, /aria-label="Announcement alerts"[^>]*checked/);
    assert.match(html, /data-announcement-count="1"/);
    assert.equal(typeof announcementToggle, "function");
    announcementToggle();
    assert.equal(toggleMuteCalls, 1);
  } finally {
    for (const [filename, previous] of stubs) {
      if (previous === undefined) delete require.cache[filename];
      else require.cache[filename] = previous;
    }
    if (previousReact === undefined) delete global.React;
    else global.React = previousReact;
  }
});

test("the mobile top bar renders no announcements action", () => {
  const previousReact = global.React;
  const stubs = new Map();
  const stubModule = (relativePath, exports) => {
    const filename = modulePath(relativePath);
    stubs.set(filename, require.cache[filename]);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  };

  try {
    global.React = React;
    stubModule("src/lib/state.tsx", { useSetRecoilState: () => () => {} });
    stubModule("src/store/index.ts", { calendarBoardsSidebarOpenAtom: {} });
    stubModule("src/hooks/RecoilRoot/useHypertasksRecoilStates.ts", {
      default: () => ({ toggleShowCommands: () => {} }),
    });
    stubModule("src/components/Modals/Settings/settingsNavigation.ts", {
      useSettingsNavigation: () => ({ openSettings: () => {} }),
    });
    stubModule("src/lib/configs/general.config.ts", { MOBILE_TARGET: "target" });
    stubModule("src/components/Common/UserAvatar.tsx", {
      default: ({ alt }) => React.createElement("span", { "aria-label": alt }),
    });

    const jiti = jitiModule.createJiti
      ? jitiModule.createJiti(__filename, {
          interopDefault: true,
          jsx: true,
          alias: { "@": path.join(root, "src") },
        })
      : jitiModule(__filename, {
          interopDefault: true,
          jsx: true,
          alias: { "@": path.join(root, "src") },
        });
    const MobileTopBarActions = jiti(
      modulePath("src/components/Global/MobileTopBarActions.tsx"),
    ).default;
    const html = renderToStaticMarkup(
      React.createElement(MobileTopBarActions, {
        currentUser: {
          displayName: "Valentin",
          email: "valentin@example.com",
          photoURL: null,
        },
        onCalendar: false,
      }),
    );

    assert.match(html, /aria-label="Menu"/);
    assert.match(html, /aria-label="Settings"/);
    assert.doesNotMatch(html, /aria-label="Latest updates"/);
  } finally {
    for (const [filename, previous] of stubs) {
      if (previous === undefined) delete require.cache[filename];
      else require.cache[filename] = previous;
    }
    if (previousReact === undefined) delete global.React;
    else global.React = previousReact;
  }
});
