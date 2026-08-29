const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const readSource = (relativePath) =>
  fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

test("the learn endpoint seeds two scoped practice notifications", () => {
  const controller = readSource(
    "src/utils/controllers/tutorial/ensureLearnTutorialInbox.ts",
  );
  const route = readSource("src/app/api/learn/board/route.ts");
  const schema = readSource("src/prisma/schema.prisma");
  const compatibilityMigration = readSource(
    "src/prisma/migrations/20260810033000_backfill_notification_tutorial_marker/migration.sql",
  );

  assert.match(controller, /LEARN_TUTORIAL_INBOX_SIZE = 2/);
  assert.match(
    controller,
    /project: \{ ownerId: userId, title: "Learn Hypertask" \}/,
  );
  assert.match(controller, /TransactionIsolationLevel\.Serializable/);
  assert.match(controller, /hasLegacyTutorialKeyColumn/);
  assert.match(controller, /WHERE "tutorialKey" = \$\{tutorialKey\}/);
  assert.match(controller, /SET "tutorialKey" = \$\{tutorialKey\}/);
  assert.match(controller, /error\.code === "P2002"/);
  assert.match(controller, /error\.meta\?\.code === "23505"/);
  assert.match(controller, /type: "TaskMovedToInbox"/);
  assert.match(controller, /TUTORIAL_NOTIFICATION_MARKER = false/);
  assert.match(controller, /notification\.findFirst\(\{/);
  assert.match(controller, /notification\.create\(\{/);
  assert.match(controller, /notification\.update\(\{/);
  assert.match(
    controller,
    /returnedFromReminders: TUTORIAL_NOTIFICATION_MARKER/,
  );
  assert.match(controller, /task: \{ status: "Normal" \}/);
  assert.match(controller, /status !== "Archive" \|\| archivedAt === null/);
  assert.match(controller, /status !== "Normal" \|\| archivedAt !== null/);
  assert.match(schema, /tutorialKey\s+String\?\s+@unique @ignore/);
  assert.match(compatibilityMigration, /information_schema\.columns/);
  assert.match(compatibilityMigration, /SET "returnedFromReminders" = false/);
  assert.match(compatibilityMigration, /learn-inbox-v1:user=/);
  assert.doesNotMatch(compatibilityMigration, /DROP (?:COLUMN|INDEX)/);
  assert.doesNotMatch(controller, /transaction\.agent\./);
  assert.match(route, /ensureLearnTutorialInbox\(\{/);
  assert.match(route, /validateLearnTutorialInboxTargets\(\{/);
  assert.match(route, /tutorialInboxTargets/);
  assert.match(route, /parsedBody === null/);
  assert.match(route, /Invalid tutorial bootstrap request/);
});

test("tutorial inbox bootstrap retries and discards stale candidates", () => {
  const tutorialHook = readSource("src/hooks/General/useLearnTutorial.ts");

  assert.match(tutorialHook, /inboxBootstrapAttempt >= 2/);
  assert.match(tutorialHook, /500 \* 2 \*\* inboxBootstrapAttempt/);
  assert.match(tutorialHook, /response\.status === 422/);
  assert.match(tutorialHook, /inboxBootstrapIgnoreCandidates\.current = true/);
  assert.match(tutorialHook, /resetInboxBootstrap/);
  assert.match(tutorialHook, /previousTutorialActive/);
  assert.match(tutorialHook, /inboxBootstrapGeneration/);
  assert.match(
    tutorialHook,
    /!hydrated \|\|[\s\S]*!tutorialEligible \|\|[\s\S]*!tutorialState\.active/,
  );
});

test("tutorial inbox rendering is filtered to authenticated notification ids", () => {
  const inbox = readSource("src/app/inbox/Inbox.tsx");
  const split = readSource("src/components/notifications/inboxSplit/index.tsx");

  assert.match(inbox, /queryParams\?\.tutorial === "1"/);
  assert.match(
    inbox,
    /tutorialInboxNotificationIds\.has\(Number\(notification\.id\)\)/,
  );
  assert.match(inbox, /parseLearnTutorialState/);
  assert.doesNotMatch(inbox, /queryParams\?\.tutorialInbox/);
  assert.match(inbox, /data-tutorial-inbox-loaded=/);
  assert.match(
    inbox,
    /notificationsQuery\.isFetched && notificationsQuery\.isSuccess/,
  );
  assert.match(split, /data-tutorial-inbox-notification-id=/);
  assert.match(split, /data-tutorial-inbox-task-id=/);
  assert.match(split, /data-tutorial-inbox-index=/);
});

test("archive completion is published only after persistence succeeds", () => {
  const focusHandler = readSource("src/hooks/Inbox/useGlobalFocusHandler.tsx");
  const archiveRoute = readSource("src/pages/api/notifications/markAsDone.ts");
  assert.match(focusHandler, /persisted = await archiveHandler/);
  assert.match(focusHandler, /Number\.isSafeInteger\(notificationId\)/);
  assert.match(focusHandler, /if \(!notificationResponse\.ok\) return false/);
  assert.match(focusHandler, /notificationId,/);
  assert.match(focusHandler, /source: pathname\?\.startsWith\("\/detail"\)/);
  assert.match(focusHandler, /tutorialArchive \? "&tutorial=1"/);
  assert.match(
    focusHandler,
    /if \(!tutorialArchive\)[\s\S]*removeElementFromState/,
  );
  assert.match(
    focusHandler,
    /if \(!persisted\)[\s\S]*refetchQueries[\s\S]*LEARN_TUTORIAL_INBOX_ARCHIVE_FAILED_EVENT/,
  );
  assert.match(
    readSource("src/hooks/General/useLearnTutorial.ts"),
    /markAsDone\?id=\$\{target\.notificationId\}[\s\S]*source: "detail"/,
  );
  assert.match(archiveRoute, /returnedFromReminders: false/);
  assert.match(archiveRoute, /title: "Learn Hypertask"/);
  assert.match(archiveRoute, /tutorial === "1" && !id/);
  assert.match(
    archiveRoute,
    /where: \{ id: notification_\.id \},[\s\S]*status: "Archive"/,
  );
});

test("Act 4 blocks pointer and unrelated keyboard archive paths", () => {
  const overlay = readSource(
    "src/components/PageComponents/LearnTutorial/TutorialOverlay.tsx",
  );
  const tutorialHook = readSource("src/hooks/General/useLearnTutorial.ts");

  assert.match(
    overlay,
    /scene\.readOnly \|\|[\s\S]*locksInboxPointerInput/,
  );
  assert.match(
    tutorialHook,
    /tutorialState\.scene === "inboxZero"[\s\S]*event\.stopImmediatePropagation\(\)/,
  );
});

test("Act 5 captures a safe return board and chooses an unused column title", () => {
  const learnPage = readSource("src/app/(tutorial space)/learn/page.tsx");
  const route = readSource("src/app/api/learn/board/route.ts");

  assert.match(learnPage, /previousBoard=/);
  assert.match(learnPage, /replace\("project-", ""\)/);
  assert.match(learnPage, /decodeURIComponent\(encodedPreviousBoard\)/);
  assert.match(learnPage, /catch \{[\s\S]*return null/);
  assert.match(learnPage, /\{ returnBoardId \}/);
  assert.match(route, /getProjectWhere\(session\.id\)/);
  assert.match(route, /requestedReturnBoardId !== projectId/);
  assert.match(route, /TUTORIAL_COLUMN_TITLE = "Ready to ship"/);
  assert.match(route, /nextTutorialColumnTitle/);
  assert.match(route, /randomUUID\(\)/);
  assert.match(route, /tutorialReturn=/);
  assert.match(route, /tutorialColumnTitle,/);
});

test("Act 5 advances only after real column persistence succeeds", () => {
  const commands = readSource("src/components/commands.tsx");
  const moveToColumn = readSource(
    "src/components/Modals/commands/moveToColumn.tsx",
  );
  const tutorialHook = readSource("src/hooks/General/useLearnTutorial.ts");

  assert.match(
    commands,
    /response\.status === 200[\s\S]*LEARN_TUTORIAL_COLUMN_CREATED_EVENT/,
  );
  assert.match(commands, /columnId: createdSection\.id/);
  assert.match(commands, /projectId: createdSection\.projectId/);
  assert.match(
    moveToColumn,
    /onSuccess:[\s\S]*LEARN_TUTORIAL_COLUMN_MOVE_EVENT/,
  );
  assert.match(moveToColumn, /toSectionId: section\.id/);
  assert.match(tutorialHook, /pendingColumnCreation\.current/);
  assert.match(tutorialHook, /observeLearnTutorialColumnCreated/);
  assert.match(tutorialHook, /pendingColumnMove\.current/);
  assert.match(tutorialHook, /observeLearnTutorialColumnMove/);
  assert.match(
    tutorialHook,
    /state\.tutorialColumnId !== null[\s\S]*state\.tutorialColumnTitle/,
  );
  assert.match(
    tutorialHook,
    /scene !== "moveTaskCommand"[\s\S]*getElementById\([\s\S]*task\.focus\(\)/,
  );
});

test("Act 5 verifies every real modal and returns from the finale", () => {
  const overlay = readSource(
    "src/components/PageComponents/LearnTutorial/TutorialOverlay.tsx",
  );
  const tutorialHook = readSource("src/hooks/General/useLearnTutorial.ts");

  assert.match(overlay, /locksActFivePointerInput/);
  assert.match(tutorialHook, /getElementById\("boardManager"\)/);
  assert.match(
    tutorialHook,
    /revealSurfaceAfterShortcut\([\s\S]*"board-switcher"/,
  );
  assert.match(tutorialHook, /getElementById\("addColumnModal"\)/);
  assert.match(tutorialHook, /getElementById\("MoveModal"\)/);
  assert.match(
    tutorialHook,
    /revealSurfaceAfterShortcut\("add-column"[\s\S]*getElementById\("addColumnModal"\)/,
  );
  assert.match(
    tutorialHook,
    /revealSurfaceAfterShortcut\("move-to-column"[\s\S]*getElementById\("MoveModal"\)/,
  );
  assert.match(
    tutorialHook,
    /getElementById\("keyboard-shortcut-container"\)/,
  );
  assert.match(tutorialHook, /scene === "finale"[\s\S]*exitTutorial\(\)/);
  assert.match(
    tutorialHook,
    /tutorialState\.returnBoardId[\s\S]*`\/project\?id=\$\{tutorialState\.returnBoardId\}`/,
  );
});
