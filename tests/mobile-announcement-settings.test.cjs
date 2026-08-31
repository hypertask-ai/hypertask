const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const test = require("node:test");
const jitiModule = require("jiti");

const root = path.resolve(__dirname, "..");
const modulePath = (relativePath) => path.join(root, relativePath);
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("mobile announcements live in Settings instead of the top bar", () => {
  const topBarActions = read(
    "src/components/Global/MobileTopBarActions.tsx",
  );
  const settings = read("src/components/Modals/Settings/SettingsShell.tsx");
  const announcements = read(
    "src/components/Modals/Settings/AnnouncementsSection.tsx",
  );
  const desktopRail = read(
    "src/components/PageComponents/Kanban/HeaderComponents/AppShellRail.tsx",
  );

  assert.doesNotMatch(topBarActions, /MobileAnnouncementButton|Rocket/);
  assert.equal(
    fs.existsSync(
      path.join(root, "src/components/Global/MobileAnnouncementButton.tsx"),
    ),
    false,
  );
  assert.match(settings, /useGetAnnouncements\(currentUser\?\.id\)/);
  assert.match(settings, /shouldShowMobileAnnouncementIndicator\(\{/);
  assert.match(settings, /<MobileAnnouncementIndicator/);
  assert.match(
    announcements,
    /Show an unread indicator when new updates are available\./,
  );
  assert.match(desktopRail, /<IconoirRocket/);
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
