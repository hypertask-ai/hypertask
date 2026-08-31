const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
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
  assert.match(settings, /isFetched: userPreferencesFetched/);
  assert.match(
    settings,
    /userPreferencesFetched &&[\s\S]*!userPreferences\?\.muteAnnouncements/,
  );
  assert.match(
    settings,
    /mobile &&[\s\S]*item\.id === "announcements" &&[\s\S]*hasUnreadAnnouncements/,
  );
  assert.match(settings, /h-\[7px\].*bg-\[#51A4F1\]/);
  assert.match(
    announcements,
    /Show an unread indicator when new updates are available\./,
  );
  assert.match(desktopRail, /<IconoirRocket/);
});
