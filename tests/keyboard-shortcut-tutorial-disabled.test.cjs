const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const {
  KEYBOARD_SHORTCUT_TUTORIAL_ENABLED,
  hasKeyboardShortcutTutorialQuery,
  isKeyboardShortcutTutorialPath,
  removeKeyboardShortcutTutorialQuery,
} = jiti(path.join(root, "src/lib/tutorial/keyboardShortcutTutorial.ts"));
const { getAllCommands } = jiti(
  path.join(root, "src/components/Modals/commands/HTC/AllCommands.ts"),
);
const { CommandMode } = jiti(path.join(root, "src/models/enums.ts"));

test("both keyboard-first tutorial route families are disabled", () => {
  assert.equal(KEYBOARD_SHORTCUT_TUTORIAL_ENABLED, false);
  assert.equal(isKeyboardShortcutTutorialPath("/learn"), true);
  assert.equal(isKeyboardShortcutTutorialPath("/learn/anything"), true);
  assert.equal(isKeyboardShortcutTutorialPath("/interactive-onboarding"), true);
  assert.equal(
    isKeyboardShortcutTutorialPath("/interactive-onboarding/landing"),
    true,
  );
  assert.equal(isKeyboardShortcutTutorialPath("/project"), false);
  assert.equal(isKeyboardShortcutTutorialPath("/learning"), false);
});

test("stale tutorial query state is detected and removed", () => {
  const params = new URLSearchParams(
    "id=15&tutorial=1&tutorialInbox=1%3A2&tutorialReturn=12&view=board",
  );
  assert.equal(hasKeyboardShortcutTutorialQuery(params), true);

  removeKeyboardShortcutTutorialQuery(params);
  assert.equal(hasKeyboardShortcutTutorialQuery(params), false);
  assert.equal(params.toString(), "id=15&view=board");
});

test("the command palette exposes references and product tours, not the broken tutorial", () => {
  const commands = getAllCommands({ context: "Others" }).flatMap(
    (group) => group.commandLists,
  );

  assert.equal(
    commands.some(
      (command) => command.commandMode === CommandMode.InteractiveTutorial,
    ),
    false,
  );
  assert.equal(
    commands.some((command) => command.key === "shortcuts"),
    true,
  );
  assert.equal(
    commands.some((command) => command.key === "startKanbanTutorial"),
    true,
  );
  assert.equal(
    commands.some((command) => command.key === "startTaskWriterTutorial"),
    true,
  );
});

test("onboarding and settings contain no keyboard tutorial launch action", () => {
  const onboarding = read(
    "src/components/PageComponents/Onboarding/OnboardingPageComponent.tsx",
  );
  const settings = read(
    "src/components/Modals/Settings/LearnHypertaskSection.tsx",
  );
  const sidebar = read("src/components/sidebars/RightSidebar/index.tsx");

  assert.doesNotMatch(onboarding, /TutorialOnboardingScreen/);
  assert.doesNotMatch(settings, /Interactive Tutorial/);
  assert.doesNotMatch(sidebar, /InteractiveTutorialLink/);
});

test("the edge and bootstrap API enforce the kill switch", () => {
  const proxy = read("src/proxy.ts");
  const boardApi = read("src/app/api/learn/board/route.ts");

  assert.match(proxy, /isKeyboardShortcutTutorialPath\(currentPath\)/);
  assert.match(
    proxy,
    /hasKeyboardShortcutTutorialQuery\(request\.nextUrl\.searchParams\)/,
  );
  assert.match(boardApi, /KEYBOARD_SHORTCUT_TUTORIAL_ENABLED/);
  assert.match(boardApi, /status: 410/);
});
