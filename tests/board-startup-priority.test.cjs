const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const apiSource = read("src/utils/api/Homepage/index.ts");
const boardsHookSource = read("src/hooks/Homepage/useGetBoards.ts");
const landingSource = read("src/app/[...boardURL]/LandingPage.tsx");
const globalProviderSource = read(
  "src/components/ProviderGlobal/GloablProviders.tsx",
);
const favoritesSource = read("src/hooks/MultiPages/useGetAllFavorites.ts");
const projectLabelsSource = read(
  "src/hooks/MultiPages/useGetAllProjectLabels.ts",
);
const viewTabsSource = read(
  "src/components/PageComponents/Kanban/HeaderComponents/ViewTabsBar.tsx",
);
const announcementsSource = read(
  "src/hooks/MultiPages/Sidebar/useGetAnnouncements.ts",
);
const globalStartupSource = read(
  "src/components/ProviderGlobal/useGlobalProvider.ts",
);
const homepageSource = read(
  "src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx",
);
const mobileTitleSheetSource = read(
  "src/components/Global/MobileTitleSheet.tsx",
);
const boardRealtimeSource = read("src/hooks/realtime/useBoardRealtime.ts");
const timeTrackingSource = read("src/hooks/Task Detail/useTimeTracking.ts");
const { createJiti } = require("jiti");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
  moduleCache: false,
});
const {
  MOBILE_BOARD_CONTROLS_RECOVERY_TIMEOUT_MS,
  shouldShowMobileBoardControls,
} = jiti(path.join(root, "src/lib/boardStartup/mobileControls.ts"));

test("visible board payload starts before project metadata settles", () => {
  const functionSource = apiSource.slice(apiSource.indexOf("export const getAllProjects"));
  const boardStart = functionSource.indexOf("const boardPayloadPromise");
  const metadataAwait = functionSource.indexOf(
    "response = await axios.post(`/api/projects/getAll`",
  );

  assert.ok(boardStart >= 0, "active board request must be started");
  assert.ok(
    boardStart < metadataAwait,
    "active board request must not be serialized behind project metadata",
  );
  assert.match(functionSource, /await boardPayloadPromise/);
});

test("usable board data is not serialized behind unrelated count or duplicate transforms", () => {
  const functionSource = apiSource.slice(apiSource.indexOf("export const getAllProjects"));

  assert.doesNotMatch(
    boardsHookSource,
    /notificationCountQueryOptions/,
    "the board query must not start or await the notification-count query",
  );
  assert.doesNotMatch(
    functionSource,
    /await getNotificationCount|notificationCountPromise/,
    "notification badges must not hold the usable board payload",
  );
  assert.match(
    functionSource,
    /if \(projectIndex === index && boardPayload\) continue/,
    "the active board task list must only be hydrated once",
  );
  assert.match(landingSource, /const projects = \[\.\.\.data\.updatedProjects\]/);
  assert.match(
    landingSource,
    /_notifications=\{notificationCount \?\? EMPTY_NOTIFICATION_COUNT\}/,
    "an independent or failed notification query must not crash the board shell",
  );
  assert.doesNotMatch(
    landingSource,
    /JSON\.parse\(JSON\.stringify\(data\.updatedProjects\)\)/,
    "the render path must not serialize the full board payload",
  );
});

test("secondary global startup follows the Board release policy", () => {
  assert.match(
    apiSource,
    /boardPayloadPromise[\s\S]*?\.finally\(\(\) => options\?\.onCriticalBoardRequestSettled\?\.\(\)\)/,
  );
  assert.match(
    boardsHookSource,
    /onCriticalBoardRequestSettled:\s*\(\) => \{[\s\S]*?if \(isCurrent\(\)\)/,
  );
  assert.match(
    globalProviderSource,
    /const startupUserMatchesSession =[\s\S]*?authenticatedUserId !== null && startupUser\?\.id === authenticatedUserId[\s\S]*?hasAuthenticatedUser: startupUserMatchesSession/,
    "logged-out or stale-account routes must not issue authenticated secondary requests",
  );
  assert.doesNotMatch(
    globalProviderSource,
    /startupKey\s*=\s*`\$\{pathname/,
    "same-account board navigation must not re-close the startup gate",
  );

  for (const hook of [
    "useEmojiFrequencyHydration",
    "useGetAllTeamsMinimal",
    "useGetHyperAI",
  ]) {
    assert.match(
      globalProviderSource,
      new RegExp(`${hook}\\([\\s\\S]*?secondaryStartupEnabled`),
      `${hook} must use the secondary startup gate`,
    );
  }

  assert.match(
    landingSource,
    /onCriticalBoardRequestSettled:[\s\S]*?isMobile: isMblForChat[\s\S]*?\? releaseSecondaryStartup\s*: undefined/,
    "mobile must not release secondary work when the network request merely settles",
  );
  assert.match(
    landingSource,
    /completeBoardReadinessTrace\([\s\S]*?readinessCompletion,[\s\S]*?boardReadinessTraceScope,[\s\S]*?\);\s*markBoardUsable\(\);\s*releaseSecondaryStartup\(\);/,
    "mobile secondary work must release only after the usable paint boundary",
  );
  assert.match(
    landingSource,
    /useGetNotificationCount\(user\.id, \{\s*enabled: secondaryStartupEnabled/,
  );
  assert.match(
    landingSource,
    /addLastActivityAt[\s\S]*?secondaryStartupEnabled/,
  );
  assert.match(
    landingSource,
    /useGetAllFavorites[\s\S]*?enabled: secondaryStartupEnabled/,
  );
  assert.match(
    landingSource,
    /useGetAllTeamsMinimal[\s\S]*?enabled: secondaryStartupEnabled/,
  );
  assert.match(
    viewTabsSource,
    /useBoardStartup\(\)[\s\S]*?useGetAllProjectLabels\([\s\S]*?enabled: secondaryStartupEnabled/,
    "view-label decoration must wait until the Board startup gate releases",
  );
  assert.match(
    projectLabelsSource,
    /enabled: Boolean\(projectId\) && \(options\?\.enabled \?\? true\)/,
    "other label consumers must stay enabled by default",
  );
  assert.match(
    homepageSource,
    /useGetAllMembersForAssign[\s\S]*?enabled: secondaryStartupEnabled/,
  );
  assert.match(
    homepageSource,
    /useBoardRunningTimers[\s\S]*?enabled: secondaryStartupEnabled/,
  );
  assert.match(
    homepageSource,
    /useBoardRealtime[\s\S]*?enabled: secondaryStartupEnabled/,
  );
  assert.match(
    landingSource,
    /useDeferredSubscriptionCheck[\s\S]*?enabled: secondaryStartupEnabled/,
  );
  assert.match(
    landingSource,
    /shouldReleaseSecondaryStartupForTerminalBoard[\s\S]*?releaseSecondaryStartup\(\)/,
    "terminal mobile Board states must restore secondary services",
  );
  assert.match(
    landingSource,
    /hasNoBoards:\s*hasAccountOwnedNetworkData &&\s*queryData\?\.updatedProjects\.length === 0/,
    "empty-state recovery must use the account-owned network result, not hidden IndexedDB data",
  );
  assert.match(
    landingSource,
    /accessDenied: currentBoardAccessStatus === "denied"/,
    "unauthorized or missing Boards must release recovery services",
  );
  assert.match(
    landingSource,
    /hasNoSelectedBoard:\s*hasAccountOwnedNetworkData && requestedProjectId == null/,
    "a settled /project route without a selected Board must release secondary services",
  );
  assert.match(
    mobileTitleSheetSource,
    /useGetAllAccessibleBoardList\(currentUser/,
    "recovery navigation must fetch an account-scoped board list on intent",
  );
  assert.match(
    boardRealtimeSource,
    /needsCatchUp\.current[\s\S]*?reconcileActiveBoardQuery\(queryClient, projectId\)/,
    "deferred realtime must reconcile events missed before subscription",
  );
  assert.match(
    timeTrackingSource,
    /if \(!projectEligible \|\| !Array\.isArray\(query\.data\)\)/,
    "the startup gate must preserve valid cached timer data",
  );
  assert.match(
    homepageSource,
    /!_currentProject\.timeTrackingEnabled \|\|\s*!timerDataReady/,
    "running-only rendering must wait until deferred timer data is available",
  );
});

test("optional mobile header work waits until the Board is usable", () => {
  assert.match(
    landingSource,
    /completeBoardReadinessTrace\([\s\S]*?readinessCompletion,[\s\S]*?boardReadinessTraceScope,[\s\S]*?\);\s*markBoardUsable\(\);/,
  );
  assert.match(
    globalProviderSource,
    /const boardUsable\s*=\s*!projectRoute \|\| usableStartupAccountKey === startupAccountKey/,
  );
  assert.match(
    globalProviderSource,
    /value=\{\{[\s\S]*?releaseSecondaryStartup,[\s\S]*?markBoardUsable,[\s\S]*?secondaryStartupEnabled,[\s\S]*?\}\}/,
  );
  assert.equal(MOBILE_BOARD_CONTROLS_RECOVERY_TIMEOUT_MS, 6_000);
  assert.equal(
    shouldShowMobileBoardControls({
      projectRoute: true,
      boardUsable: false,
      recoveryTimedOut: false,
    }),
    false,
  );
  assert.equal(
    shouldShowMobileBoardControls({
      projectRoute: true,
      boardUsable: true,
      recoveryTimedOut: false,
    }),
    true,
    "a successful usable paint must restore every mobile control",
  );
  assert.equal(
    shouldShowMobileBoardControls({
      projectRoute: true,
      boardUsable: false,
      recoveryTimedOut: true,
    }),
    true,
    "failed, empty, and unauthorized Boards must regain recovery navigation",
  );
  assert.equal(
    shouldShowMobileBoardControls({
      projectRoute: false,
      boardUsable: false,
      recoveryTimedOut: false,
    }),
    true,
    "non-Board surfaces must never enter the startup gate",
  );
});

test("board shortcut loads its authorization list only on intent", () => {
  assert.match(globalProviderSource, /const handleKeyPress = async/);
  assert.match(
    globalProviderSource,
    /queryClient[\s\S]*?\.fetchQuery<IProject\[]>/,
  );
  assert.match(
    globalProviderSource,
    /globalAPIHandlers\.getAllProjectsMinimal\("ExtraMinimal"\)/,
  );
  assert.match(
    globalProviderSource,
    /queryKey:\s*\["projectsAllMinimal", currentUser\.id\]/,
    "the shortcut authorization cache must be isolated by account",
  );
});

test("multiple favorites consumers share one fresh startup response", () => {
  assert.match(
    favoritesSource,
    /\["getAllFavorites", userSettingId\]/,
    "favorite data must remain account-scoped while it is fresh",
  );
  assert.match(favoritesSource, /enabled: options\?\.enabled \?\? true/);
  assert.match(favoritesSource, /initialDataUpdatedAt: 0/);
  assert.match(favoritesSource, /staleTime: 60_000/);
  assert.match(favoritesSource, /refetchOnWindowFocus: false/);
});

test("deferred announcements fetch after the startup gate opens", () => {
  assert.match(announcementsSource, /enabled: options\?\.enabled \?\? true/);
  assert.match(announcementsSource, /initialDataUpdatedAt: 0/);
});

test("push messaging loads only from explicit notification surfaces", () => {
  assert.doesNotMatch(globalStartupSource, /useFcmToken/);
  assert.doesNotMatch(globalStartupSource, /retrieveToken/);
});
