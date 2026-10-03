const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const jiti = require("jiti")(__filename);
const { COMMAND_MENU_ROUTE_HOSTS } = jiti(
  path.join(__dirname, "../src/lib/constants/commandCenterShortcut.ts"),
);
const root = path.join(__dirname, "../src");

// Each page's import chain ends at its palette host. Shared hosts live outside app/.
const hosts = {
  "/project": {
    "app/[...boardURL]/page.tsx": [
      "app/[...boardURL]/LandingPage.tsx",
      "components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx",
    ],
  },
  "/detail": {
    "app/detail/[...slug]/page.tsx": [
      "app/detail/[...slug]/TaskDetailComp.tsx",
      "app/detail/[...slug]/TaskDetailPanels.tsx",
    ],
  },
  "/page": { "app/page/[publicId]/page.tsx": ["app/page/[publicId]/PageEditor.tsx"] },
  "/search": { "app/search/page.tsx": ["app/search/SearchComp.tsx"] },
  "/inbox": {
    "app/inbox/page.tsx": ["app/inbox/Inbox.tsx"],
    "app/inbox/agent/[agentId]/page.tsx": ["app/inbox/agent/AgentInbox.tsx"],
  },
  "/all-tasks": { "app/all-tasks/page.tsx": ["app/all-tasks/AllTasks.tsx"] },
  "/calendar": { "app/calendar/page.tsx": ["components/PageComponents/Calendar/index.tsx"] },
  "/scheduled": { "app/scheduled/page.tsx": ["app/scheduled/index.tsx"] },
  "/reminders": { "app/reminders/page.tsx": ["app/reminders/ReminderPageComponent.tsx"] },
  "/report": {
    "app/report/page.tsx": ["app/report/ReportsOverview.tsx"],
    "app/report/[projectSlug]/[reportSlug]/page.tsx": ["app/report/ReportsOverview.tsx"],
    "app/report/[projectSlug]/velocity/page.tsx": ["app/report/[projectSlug]/velocity/VelocityReport.tsx"],
  },
  "/starred": { "app/starred/page.tsx": ["app/starred/StarredComp.tsx"] },
  "/pinned": { "app/pinned/page.tsx": ["app/pinned/PinnedComp.tsx"] },
  "/archived": { "app/archived/page.tsx": ["app/archived/ArchivedComp.tsx"] },
};

function pagesUnder(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? pagesUnder(file) : entry.name === "page.tsx" ? [file] : [];
  });
}

function assertMount(source) {
  assert.match(source, /<HypertasksCommands(?:\s|\/|>)/);
}

for (const route of COMMAND_MENU_ROUTE_HOSTS) {
  test(`${route}: every page imports a component that mounts the command menu`, () => {
    assert.ok(hosts[route], `Missing host proof for ${route}`);
    const pages = route === "/project" ? ["app/[...boardURL]/page.tsx"] : pagesUnder(`app${route}`);
    assert.deepEqual(pages.sort(), Object.keys(hosts[route]).sort(), `Unverified page under ${route}`);
    for (const page of pages) {
      let source = fs.readFileSync(path.join(root, page), "utf8");
      for (const component of hosts[route][page]) {
        const relativeImport = path.relative(path.dirname(page), component).replace(/\.tsx$/, "");
        const importPath = relativeImport.startsWith(".") ? relativeImport : `./${relativeImport}`;
        const aliasPath = `@/${component.replace(/(?:\/index)?\.tsx$/, "")}`;
        const indexImport = importPath.replace(/\/?index$/, "") || ".";
        assert.ok([importPath, aliasPath, indexImport].some((specifier) => source.includes(`"${specifier}"`)), `${page} must import ${component}`);
        source = fs.readFileSync(path.join(root, component), "utf8");
      }
      assertMount(source);
    }
  });
}

test("the alternative board table layout also mounts the menu", () => {
  assertMount(fs.readFileSync(path.join(root, "components/PageComponents/Kanban/TableView/TableView.tsx"), "utf8"));
});

test("the mount check rejects absent mounts, including My Tasks", () => {
  assertMount("<HypertasksCommands />");
  assert.throws(() => assertMount("<OtherMenu />"), assert.AssertionError);
  for (const file of ["app/my-tasks/page.tsx", "app/my-tasks/MyTasks.tsx"]) {
    assert.throws(() => assertMount(fs.readFileSync(path.join(root, file), "utf8")), assert.AssertionError);
  }
  assert.equal(COMMAND_MENU_ROUTE_HOSTS.includes("/my-tasks"), false);
});
