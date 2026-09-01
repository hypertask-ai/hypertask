const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");
const { QueryClient } = require("@tanstack/query-core");

const root = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const jiti = createJiti(__filename, {
  interopDefault: true,
  moduleCache: false,
  alias: { "@": path.join(root, "src") },
});

const {
  boardReadModelKey,
  createBoardReadModelRevocation,
  isBoardReadModelRevocationV1,
  createBoardReadModelSnapshot,
  isBoardReadModelSnapshotV1,
  materializeBoardReadModelSnapshot,
} = jiti(path.join(root, "src/lib/boardSync/contract.ts"));
// moduleCache on: these two share one revocationTombstone instance, the way a
// browser bundle does. The default jiti above re-evaluates per import.
const jitiShared = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { revokeBoardAccess: revokeBoardAccessShared } = jitiShared(
  path.join(root, "src/hooks/Homepage/useGetBoards.ts"),
);
const { publishPreparedLocalBoard: publishPreparedLocalBoardShared } =
  jitiShared(path.join(root, "src/hooks/Homepage/useSyncedBoardReadModel.ts"));
// Loading clear.ts here would pull in indexedDbReadModel's BroadcastChannel and
// keep the test process alive, so clear the quarantine the same way it does.
const { clearBoardRevocationTombstone: clearSharedRevocation } = jitiShared(
  path.join(root, "src/lib/boardSync/revocationTombstone.ts"),
);
const { resolveBoardSyncPilotEnabled } = jiti(
  path.join(root, "src/lib/boardSync/pilot.ts"),
);
const {
  canUseProjectScopedBoardAuthorization,
  isBoardAccessDeniedError,
  isProjectsAuthorizationRequestCurrent,
  isRevocationStillActiveBoard,
  normalizeRequestedProjectId,
  purgeRevokedBoardTaskQueries,
  revokeBoardAccess,
  shouldForceFreshProjectAuthorization,
  shouldRequestProjectsAuthorizationForScope,
} = jiti(path.join(root, "src/hooks/Homepage/useGetBoards.ts"));
const {
  buildAuthorizedLocalPublication,
  didNetworkResultPublishAfterAuthorization,
  isBoardAuthorizationProofCurrent,
  publishPreparedLocalBoard,
} = jiti(path.join(root, "src/hooks/Homepage/useSyncedBoardReadModel.ts"));
const { resolveAuthorizedLocalFallback } = jiti(
  path.join(root, "src/lib/boardSync/startupRace.ts"),
);

const fixture = JSON.parse(read("tests/fixtures/board-sync-v1.json"));
const landingPageSource = read("src/app/[...boardURL]/LandingPage.tsx");
const pilotStateInitialization =
  landingPageSource.match(
    /const \[syncedBoardPilotEnabled,[\s\S]*?const localDatabasePilotEnabled/,
  )?.[0] ?? "";
const pilotPreferenceEffect =
  landingPageSource.match(
    /useEffect\(\(\) => \{\s*persistBoardSyncPilotPreference\(pilotParameter\)[\s\S]*?\}, \[pilotParameter\]\)/,
  )?.[0] ?? "";
const syncedBoardReadModelEnabledExpression =
  landingPageSource.match(
    /useSyncedBoardReadModel\(\{\s*enabled:\s*([\s\S]*?),\s*accountId:/,
  )?.[1] ?? "";
const projectsAllKey = ["projectsAll"];
const fixtureActiveKey = `${fixture.accountId}:${fixture.projectId}`;
const fixtureLocalPayload = {
  ...fixture,
  project: { ...fixture.project, section: [] },
};
const useFakeLocalStorage = () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  return {
    store,
    restore: () => {
      delete globalThis.localStorage;
    },
  };
};
// A fresh instance has an empty quarantine set, like the page after a reload.
const reloadedRevocationTombstone = () =>
  createJiti(__filename, {
    interopDefault: true,
    moduleCache: false,
    alias: { "@": path.join(root, "src") },
  })(path.join(root, "src/lib/boardSync/revocationTombstone.ts"));

const createQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });
const createDeferred = () => {
  let resolve;
  const promise = new Promise((release) => {
    resolve = release;
  });
  return { promise, resolve };
};
const createLocalPublicationInput = ({
  queryClient = createQueryClient(),
  proof = {},
  prepareLocalRead = async () => fixtureLocalPayload,
  getCurrentScope = () => ({
    activeKey: fixtureActiveKey,
    enabled: true,
    accountId: fixture.accountId,
    projectId: fixture.projectId,
  }),
  claimPublication = () => true,
  onPublished,
} = {}) => ({
  queryClient,
  proof: {
    accountId: fixture.accountId,
    projectId: fixture.projectId,
    authorizedProjectIds: [fixture.projectId],
    generation: 1,
    requestId: `indexeddb:${fixtureActiveKey}:1`,
    queryUpdateCountAtAuthorization: 0,
    isCurrent: () => true,
    ...proof,
  },
  prepareLocalRead,
  getCurrentScope,
  claimPublication,
  onPublished,
});

test("route project ids require a positive integer", () => {
  assert.equal(normalizeRequestedProjectId(fixture.projectId), fixture.projectId);
  assert.equal(normalizeRequestedProjectId(String(fixture.projectId)), fixture.projectId);
  assert.equal(normalizeRequestedProjectId(0), null);
  assert.equal(normalizeRequestedProjectId(""), null);
  assert.equal(normalizeRequestedProjectId(null), null);
  assert.equal(normalizeRequestedProjectId(undefined), null);
  assert.equal(normalizeRequestedProjectId(-1), null);
  assert.equal(normalizeRequestedProjectId("1.5"), null);
});

test("fresh authorization removes revoked board-task side caches", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const accountId = fixture.accountId;
  const authorizedKey = ["boardTasks", accountId, fixture.projectId];
  const revokedKey = ["boardTasks", accountId, fixture.projectId + 1];
  const otherAccountKey = ["boardTasks", accountId + 1, fixture.projectId + 1];
  queryClient.setQueryData(authorizedKey, { tasks: [], allViews: [] });
  queryClient.setQueryData(revokedKey, { tasks: [{ id: 99 }], allViews: [] });
  queryClient.setQueryData(otherAccountKey, { tasks: [{ id: 100 }], allViews: [] });

  await purgeRevokedBoardTaskQueries(queryClient, accountId, [fixture.projectId]);

  assert.ok(queryClient.getQueryData(authorizedKey));
  assert.equal(queryClient.getQueryData(revokedKey), undefined);
  assert.ok(queryClient.getQueryData(otherAccountKey));
  queryClient.clear();
});

test("authorized network success never waits for a slower local publication", async () => {
  const neverSettles = new Promise(() => undefined);
  const winner = await Promise.race([
    resolveAuthorizedLocalFallback({
      boardPayload: { tasks: [], allViews: [] },
      localBoardPublication: neverSettles,
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("network inherited local latency")), 50),
    ),
  ]);

  assert.equal(winner, false);
});

test("an unavailable network payload waits for the authorized local fallback", async () => {
  let releaseLocal;
  const localBoardPublication = new Promise((resolve) => {
    releaseLocal = resolve;
  });
  let settled = false;
  const fallback = resolveAuthorizedLocalFallback({
    boardPayload: null,
    localBoardPublication,
  }).then((result) => {
    settled = true;
    return result;
  });

  await Promise.resolve();
  assert.equal(settled, false);
  releaseLocal(true);
  assert.equal(await fallback, true);
});

test("the v1 snapshot is account scoped and normalizes task entities", () => {
  const duplicate = { ...fixture.tasks[0], title: "Newest title" };
  const snapshot = createBoardReadModelSnapshot({
    accountId: fixture.accountId,
    projectId: fixture.projectId,
    payload: {
      project: fixture.project,
      tasks: [fixture.tasks[0], duplicate, { id: 99, projectId: 999 }],
      allViews: fixture.allViews,
    },
    savedAt: fixture.savedAt,
  });

  assert.ok(snapshot);
  assert.deepEqual(snapshot.taskOrder, [fixture.tasks[0].id]);
  assert.equal(
    snapshot.tasksById[String(fixture.tasks[0].id)].title,
    "Newest title",
  );
  assert.equal(snapshot.tasksById["99"], undefined);
  assert.equal(
    isBoardReadModelSnapshotV1(snapshot, fixture.accountId, fixture.projectId),
    true,
  );
  assert.equal(
    isBoardReadModelSnapshotV1(
      snapshot,
      fixture.accountId + 1,
      fixture.projectId,
    ),
    false,
  );
  assert.deepEqual(materializeBoardReadModelSnapshot(snapshot).tasks, [
    duplicate,
  ]);
  assert.deepEqual(snapshot.allViews, fixture.allViews);
  assert.deepEqual(
    materializeBoardReadModelSnapshot(snapshot).allViews,
    fixture.allViews,
  );
});

test("schema mismatch and incomplete task entities fail closed", () => {
  const snapshot = createBoardReadModelSnapshot({
    accountId: fixture.accountId,
    projectId: fixture.projectId,
    payload: fixture,
    savedAt: fixture.savedAt,
  });
  assert.ok(snapshot);
  assert.equal(
    isBoardReadModelSnapshotV1({ ...snapshot, schemaVersion: 2 }),
    false,
  );
  assert.equal(
    isBoardReadModelSnapshotV1({ ...snapshot, tasksById: {} }),
    false,
  );
});

test("LandingPage resolves the board-sync pilot before the first layout-effect pass", () => {
  assert.match(
    pilotStateInitialization,
    /useState\(\s*\(\) =>\s*getBoardSyncPilotEnabled\(pilotParameter\),?\s*\)/,
  );
  assert.match(
    pilotStateInitialization,
    /\[pilotPreferenceResolved, setPilotPreferenceResolved\] = useState\(true\)/,
  );
  assert.match(pilotPreferenceEffect, /persistBoardSyncPilotPreference/);
  assert.match(
    pilotPreferenceEffect,
    /setSyncedBoardPilotEnabled\(getBoardSyncPilotEnabled\(pilotParameter\)\)/,
  );
});

test("LandingPage starts the board read model without waiting for surface initialization", () => {
  assert.equal(
    syncedBoardReadModelEnabledExpression.trim(),
    "localDatabasePilotEnabled",
  );
  assert.doesNotMatch(
    syncedBoardReadModelEnabledExpression,
    /surfaceInitializedFor/,
  );
});

test("deployment and browser kill switches override enrollment", () => {
  assert.equal(
    resolveBoardSyncPilotEnabled({
      parameter: "0",
      storedPreference: "1",
      environmentEnabled: true,
    }),
    false,
  );
  assert.equal(
    resolveBoardSyncPilotEnabled({
      parameter: "1",
      storedPreference: "0",
      environmentEnabled: false,
    }),
    false,
  );
  assert.equal(resolveBoardSyncPilotEnabled({ storedPreference: "1" }), true);
  assert.equal(
    resolveBoardSyncPilotEnabled({
      storedPreference: "0",
      environmentEnabled: true,
    }),
    false,
  );
  assert.equal(
    resolveBoardSyncPilotEnabled({ environmentEnabled: true }),
    true,
  );
  assert.equal(
    resolveBoardSyncPilotEnabled({ environmentEnabled: false }),
    false,
  );
  assert.equal(
    resolveBoardSyncPilotEnabled({
      storedPreference: "1",
      environmentEnabled: false,
    }),
    false,
  );
});

test("local publication waits for authorization and matching board identity", () => {
  const input = {
    accountId: fixture.accountId,
    projectId: fixture.projectId,
    payload: fixture,
  };

  assert.equal(
    buildAuthorizedLocalPublication({
      ...input,
      authorizedProjectIds: [],
    }),
    null,
  );
  assert.equal(
    buildAuthorizedLocalPublication({
      ...input,
      authorizedProjectIds: [fixture.projectId],
      payload: {
        ...fixture,
        project: { ...fixture.project, id: fixture.projectId + 1 },
      },
    }),
    null,
  );
});

test("authorization proof is bound to its originating account and route", () => {
  const proof = {
    accountId: fixture.accountId,
    projectId: fixture.projectId,
    authorizedProjectIds: [fixture.projectId],
    generation: 1,
    requestId: "request-1",
    queryUpdateCountAtAuthorization: 3,
    isCurrent: () => true,
  };

  assert.equal(
    isBoardAuthorizationProofCurrent({
      proof,
      accountId: fixture.accountId,
      projectId: fixture.projectId,
    }),
    true,
  );
  assert.equal(
    isBoardAuthorizationProofCurrent({
      proof,
      accountId: fixture.accountId + 1,
      projectId: fixture.projectId,
    }),
    false,
  );
  assert.equal(
    isBoardAuthorizationProofCurrent({
      proof: { ...proof, generation: 2, isCurrent: () => false },
      accountId: fixture.accountId,
      projectId: fixture.projectId,
    }),
    false,
  );
  assert.equal(
    isBoardAuthorizationProofCurrent({
      proof,
      accountId: fixture.accountId,
      projectId: fixture.projectId + 1,
    }),
    false,
  );
});

test("an account-scoped snapshot publishes before any network authorization callback", async () => {
  const queryClient = createQueryClient();
  let publicationCount = 0;

  const published = await publishPreparedLocalBoard(createLocalPublicationInput({
    queryClient,
    onPublished: () => {
      publicationCount += 1;
    },
  }));

  assert.equal(published, true);
  assert.equal(publicationCount, 1);
  assert.equal(queryClient.getQueryData(projectsAllKey).dataOrigin, "indexeddb");
  assert.deepEqual(
    queryClient
      .getQueryData(projectsAllKey)
      .updatedProjects.map((project) => project.id),
    [fixture.projectId],
  );
  queryClient.clear();
});

test("a network publication that lands during the local read is never overwritten", async () => {
  const queryClient = createQueryClient();
  const localRead = createDeferred();
  const publication = publishPreparedLocalBoard(createLocalPublicationInput({
    queryClient,
    prepareLocalRead: () => localRead.promise,
  }));
  const networkResult = {
    accountId: fixture.accountId,
    dataOrigin: "network",
    updatedProjects: [
      {
        ...fixture.project,
        tasks: [{ ...fixture.tasks[0], title: "Fresh network task" }],
      },
    ],
    notificationsCount: { all: 0, unseen: 0 },
  };
  queryClient.setQueryData(projectsAllKey, networkResult);
  localRead.resolve(fixture);

  assert.equal(await publication, false);
  assert.equal(queryClient.getQueryData(projectsAllKey), networkResult);
  queryClient.clear();
});

test("a snapshot stored for another account never publishes", async () => {
  const queryClient = createQueryClient();
  const crossAccountSnapshot = createBoardReadModelSnapshot({
    accountId: fixture.accountId + 1,
    projectId: fixture.projectId,
    payload: fixture,
    savedAt: fixture.savedAt,
  });
  const published = await publishPreparedLocalBoard(createLocalPublicationInput({
    prepareLocalRead: async () =>
      isBoardReadModelSnapshotV1(
        crossAccountSnapshot,
        fixture.accountId,
        fixture.projectId,
      )
        ? materializeBoardReadModelSnapshot(crossAccountSnapshot)
        : null,
    queryClient,
  }));

  assert.equal(published, false);
  assert.equal(queryClient.getQueryData(projectsAllKey), undefined);
  queryClient.clear();
});

test("a proof from an older route generation cannot publish after its read resolves", async () => {
  const queryClient = createQueryClient();
  let latestGeneration = 1;
  const localRead = createDeferred();
  const publication = publishPreparedLocalBoard(createLocalPublicationInput({
    queryClient,
    proof: { isCurrent: () => latestGeneration === 1 },
    prepareLocalRead: () => localRead.promise,
  }));
  latestGeneration = 2;
  localRead.resolve(fixture);

  assert.equal(await publication, false);
  assert.equal(queryClient.getQueryData(projectsAllKey), undefined);
  queryClient.clear();
});

test("concurrent local proofs publish one copy of the snapshot", async () => {
  const queryClient = createQueryClient();
  let claimedKey = null;
  let publicationCount = 0;
  const input = createLocalPublicationInput({
    queryClient,
    claimPublication: (key) => {
      if (claimedKey === key) return false;
      claimedKey = key;
      return true;
    },
    onPublished: () => {
      publicationCount += 1;
    },
  });

  const results = await Promise.all([
    publishPreparedLocalBoard(input),
    publishPreparedLocalBoard(input),
  ]);

  assert.deepEqual(results, [true, true]);
  assert.equal(publicationCount, 1);
  queryClient.clear();
});

test("a network denial purges the board and IndexedDB entry before a soft redirect", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const accountId = fixture.accountId;
  const projectId = fixture.projectId;
  const otherProjectId = projectId + 1;
  queryClient.setQueryData(["boardTasks", accountId, projectId], fixture);
  queryClient.setQueryData(["boardTasks", accountId, otherProjectId], {
    project: { id: otherProjectId },
    tasks: [],
    allViews: [],
  });
  queryClient.setQueryData(["projectsAll"], {
    accountId,
    dataOrigin: "indexeddb",
    index: 0,
    updatedProjects: [fixture.project, { id: otherProjectId }],
    notificationsCount: { all: 0, unseen: 0 },
  });
  const localEntries = new Set([
    `${accountId}:${projectId}`,
    `${accountId}:${otherProjectId}`,
  ]);
  const events = [];
  const router = {
    replace: (href) => events.push(`replace:${href}`),
  };

  assert.equal(isBoardAccessDeniedError({ response: { status: 403 } }), true);
  assert.equal(isBoardAccessDeniedError({ response: { status: 500 } }), false);

  await revokeBoardAccess({
    queryClient,
    accountId,
    projectId,
    clearLocalBoard: async (clearedAccountId, clearedProjectId) => {
      events.push(`clear:${clearedAccountId}:${clearedProjectId}`);
      return localEntries.delete(`${clearedAccountId}:${clearedProjectId}`);
    },
    router,
  });

  assert.equal(
    queryClient.getQueryData(["boardTasks", accountId, projectId]),
    undefined,
  );
  assert.ok(
    queryClient.getQueryData(["boardTasks", accountId, otherProjectId]),
  );
  assert.deepEqual(
    queryClient
      .getQueryData(["projectsAll"])
      .updatedProjects.map((project) => project.id),
    [otherProjectId],
  );
  assert.equal(localEntries.has(`${accountId}:${projectId}`), false);
  assert.equal(localEntries.has(`${accountId}:${otherProjectId}`), true);
  assert.deepEqual(events, [
    `clear:${accountId}:${projectId}`,
    "replace:/",
  ]);
  queryClient.clear();
});

test("a fresh project payload can authorize only its current route", () => {
  const input = {
    payload: fixture,
    projectId: fixture.projectId,
    isCurrent: () => true,
    resolvedRequest: null,
    scopeKey: `${fixture.accountId}:${fixture.projectId}`,
    generation: 4,
  };

  assert.equal(canUseProjectScopedBoardAuthorization(input), true);
  assert.equal(
    canUseProjectScopedBoardAuthorization({
      ...input,
      payload: {
        ...fixture,
        project: { ...fixture.project, id: fixture.projectId + 1 },
      },
    }),
    false,
  );
  assert.equal(
    canUseProjectScopedBoardAuthorization({
      ...input,
      isCurrent: () => false,
    }),
    false,
  );
});

test("only an unresolved account-and-board scope forces a fresh task proof", () => {
  const scopeKey = `${fixture.accountId}:${fixture.projectId}`;
  const otherScopeKey = `${fixture.accountId}:${fixture.projectId + 1}`;

  assert.equal(
    shouldForceFreshProjectAuthorization({
      scopeKey,
      projectAuthorization: null,
      resolvedAuthorization: null,
    }),
    true,
  );
  assert.equal(
    shouldForceFreshProjectAuthorization({
      scopeKey,
      projectAuthorization: { scopeKey },
      resolvedAuthorization: null,
    }),
    false,
  );
  assert.equal(
    shouldForceFreshProjectAuthorization({
      scopeKey,
      projectAuthorization: null,
      resolvedAuthorization: { scopeKey },
    }),
    false,
  );
  assert.equal(
    shouldForceFreshProjectAuthorization({
      scopeKey,
      projectAuthorization: { scopeKey: otherScopeKey },
      resolvedAuthorization: { scopeKey: otherScopeKey },
    }),
    true,
  );
});

test("account-wide authorization wins when it resolves before the project proof", () => {
  const scopeKey = `${fixture.accountId}:${fixture.projectId}`;
  const input = {
    payload: fixture,
    projectId: fixture.projectId,
    isCurrent: () => true,
    scopeKey,
    generation: 7,
  };

  assert.equal(
    canUseProjectScopedBoardAuthorization({
      ...input,
      resolvedRequest: { scopeKey, generation: 7 },
    }),
    false,
  );
  assert.equal(
    canUseProjectScopedBoardAuthorization({
      ...input,
      resolvedRequest: { scopeKey, generation: 6 },
    }),
    true,
    "an older account proof must not suppress the current route generation",
  );
  assert.equal(
    canUseProjectScopedBoardAuthorization({
      ...input,
      resolvedRequest: {
        scopeKey: `${fixture.accountId}:${fixture.projectId + 1}`,
        generation: 7,
      },
    }),
    true,
    "another route's proof must not suppress this route",
  );
});

test("a newer denied request supersedes an older authorized response", () => {
  const oldGeneration = 1;
  const newerGeneration = 2;

  assert.equal(
    isProjectsAuthorizationRequestCurrent({
      generation: newerGeneration,
      latestGeneration: newerGeneration,
      aborted: false,
      mounted: true,
    }),
    true,
  );
  assert.equal(
    isProjectsAuthorizationRequestCurrent({
      generation: oldGeneration,
      latestGeneration: newerGeneration,
      aborted: false,
      mounted: true,
    }),
    false,
  );
});

test("same-account navigation always obtains route-scoped authorization", () => {
  const input = {
    required: true,
    scopeKey: `${fixture.accountId}:${fixture.projectId + 1}`,
    latestGeneration: 4,
  };

  assert.equal(
    shouldRequestProjectsAuthorizationForScope({
      ...input,
      resolvedRequest: {
        scopeKey: `${fixture.accountId}:${fixture.projectId}`,
        generation: 3,
      },
      inFlightRequest: null,
    }),
    true,
  );
  assert.equal(
    shouldRequestProjectsAuthorizationForScope({
      ...input,
      resolvedRequest: null,
      inFlightRequest: { scopeKey: input.scopeKey, generation: 4 },
    }),
    false,
  );
  assert.equal(
    shouldRequestProjectsAuthorizationForScope({
      ...input,
      resolvedRequest: { scopeKey: input.scopeKey, generation: 4 },
      inFlightRequest: null,
    }),
    false,
  );
  assert.equal(
    shouldRequestProjectsAuthorizationForScope({
      ...input,
      resolvedRequest: { scopeKey: input.scopeKey, generation: 3 },
      inFlightRequest: { scopeKey: input.scopeKey, generation: 3 },
    }),
    true,
    "A→B→A must not trust invalidated A markers",
  );
});

test("a network result published during local read keeps retry authority", () => {
  const incompleteNetworkResult = {
    accountId: fixture.accountId,
    dataOrigin: "network",
    networkRequestId: "request-1",
    updatedProjects: [{ ...fixture.project, tasks: undefined }],
    notificationsCount: { all: 0, unseen: 0 },
  };

  assert.equal(
    didNetworkResultPublishAfterAuthorization({
      updateCountAtAuthorization: 4,
      currentUpdateCount: 5,
      current: incompleteNetworkResult,
      accountId: fixture.accountId,
    }),
    true,
  );
  assert.equal(
    didNetworkResultPublishAfterAuthorization({
      updateCountAtAuthorization: 4,
      currentUpdateCount: 5,
      current: { ...incompleteNetworkResult, networkRequestId: "request-2" },
      accountId: fixture.accountId,
    }),
    true,
    "any newer same-account network publication must outrank stale local data",
  );
  assert.equal(
    didNetworkResultPublishAfterAuthorization({
      updateCountAtAuthorization: 4,
      currentUpdateCount: 4,
      current: incompleteNetworkResult,
      accountId: fixture.accountId,
    }),
    false,
  );
  assert.equal(
    didNetworkResultPublishAfterAuthorization({
      updateCountAtAuthorization: 4,
      currentUpdateCount: 5,
      current: { ...incompleteNetworkResult, accountId: fixture.accountId + 1 },
      accountId: fixture.accountId,
    }),
    false,
    "another account cannot suppress this account's authorized local read",
  );
});

test("a pre-authorization network cache cannot suppress the local fast path", () => {
  const payload = {
    ...fixture,
    project: { ...fixture.project, section: [] },
  };
  const staleTasks = fixture.tasks.map((task) => ({
    ...task,
    title: "Stale network title",
  }));
  const staleViews = fixture.allViews.map((view) => ({
    ...view,
    title: "Stale network view",
  }));
  const priorNetworkResult = {
    accountId: fixture.accountId,
    dataOrigin: "network",
    networkRequestScopeKey: `${fixture.accountId}:${fixture.projectId}`,
    networkRequestGeneration: 1,
    index: 0,
    updatedProjects: [
      {
        ...fixture.project,
        section: [],
        tasks: staleTasks,
        project_view: {
          ...fixture.project.project_view,
          allViews: staleViews,
        },
      },
    ],
    notificationsCount: { all: 0, unseen: 0 },
  };

  assert.equal(
    didNetworkResultPublishAfterAuthorization({
      updateCountAtAuthorization: 4,
      currentUpdateCount: 4,
      current: priorNetworkResult,
      accountId: fixture.accountId,
    }),
    false,
  );

  const publication = buildAuthorizedLocalPublication({
    accountId: fixture.accountId,
    projectId: fixture.projectId,
    authorizedProjectIds: [fixture.projectId],
    current: priorNetworkResult,
    payload,
  });
  assert.ok(publication);
  assert.equal(publication.projectsData.dataOrigin, "indexeddb");
  assert.deepEqual(
    publication.projectsData.updatedProjects[0].tasks,
    fixture.tasks,
  );
  assert.deepEqual(
    publication.projectsData.updatedProjects[0].project_view.allViews,
    fixture.allViews,
  );
});

test("authorized local publication is account scoped and network-safe", () => {
  const payload = {
    ...fixture,
    project: { ...fixture.project, section: [] },
  };
  const otherAccountData = {
    accountId: fixture.accountId + 1,
    dataOrigin: "network",
    index: 0,
    updatedProjects: [{ id: 99, title: "Other account" }],
    notificationsCount: { all: 8, unseen: 5 },
  };
  const publication = buildAuthorizedLocalPublication({
    accountId: fixture.accountId,
    projectId: fixture.projectId,
    authorizedProjectIds: [fixture.projectId],
    current: otherAccountData,
    payload,
  });

  assert.ok(publication);
  assert.equal(publication.projectsData.accountId, fixture.accountId);
  assert.equal(publication.projectsData.dataOrigin, "indexeddb");
  assert.deepEqual(
    publication.projectsData.updatedProjects.map((project) => project.id),
    [fixture.projectId],
  );
  assert.deepEqual(publication.projectsData.notificationsCount, {
    all: 0,
    unseen: 0,
  });
  assert.deepEqual(
    publication.projectsData.updatedProjects[0].tasks,
    fixture.tasks,
  );

  const networkWon = buildAuthorizedLocalPublication({
    accountId: fixture.accountId,
    projectId: fixture.projectId,
    authorizedProjectIds: [fixture.projectId],
    current: {
      accountId: fixture.accountId,
      dataOrigin: "network",
      index: 0,
      updatedProjects: [publication.projectsData.updatedProjects[0]],
      notificationsCount: { all: 0, unseen: 0 },
    },
    payload,
  });
  assert.ok(networkWon);
  assert.equal(networkWon.projectsData.dataOrigin, "indexeddb");
});

test("local publication drops project metadata absent from fresh authorization", () => {
  const payload = {
    ...fixture,
    project: { ...fixture.project, section: [] },
  };
  const publication = buildAuthorizedLocalPublication({
    accountId: fixture.accountId,
    projectId: fixture.projectId,
    authorizedProjectIds: [fixture.projectId],
    current: {
      accountId: fixture.accountId,
      dataOrigin: "network",
      index: 0,
      updatedProjects: [
        { ...fixture.project, section: [] },
        { id: 99, title: "Previously authorized" },
      ],
      notificationsCount: { all: 0, unseen: 0 },
    },
    payload,
  });

  assert.ok(publication);
  assert.deepEqual(
    publication.projectsData.updatedProjects.map((project) => project.id),
    [fixture.projectId],
  );
});

test("an already hydrated local board still drops revoked metadata", () => {
  const hydrated = buildAuthorizedLocalPublication({
    accountId: fixture.accountId,
    projectId: fixture.projectId,
    authorizedProjectIds: [fixture.projectId],
    current: {
      accountId: fixture.accountId,
      dataOrigin: "indexeddb",
      index: 0,
      updatedProjects: [
        {
          ...fixture.project,
          tasks: fixture.tasks,
          project_view: {
            ...fixture.project.project_view,
            allViews: fixture.allViews,
          },
        },
        { id: 99, title: "Revoked board" },
      ],
      notificationsCount: { all: 0, unseen: 0 },
    },
    payload: fixture,
  });

  assert.ok(hydrated);
  assert.deepEqual(
    hydrated.projectsData.updatedProjects.map((project) => project.id),
    [fixture.projectId],
  );
});

test("the product integration restores, reconciles, measures, and clears", () => {
  const landing = read("src/app/[...boardURL]/LandingPage.tsx");
  const hook = read("src/hooks/Homepage/useSyncedBoardReadModel.ts");
  const boardsHook = read("src/hooks/Homepage/useGetBoards.ts");
  const homepageApi = read("src/utils/api/Homepage/index.ts");
  const indexedDb = read("src/lib/boardSync/indexedDbReadModel.ts");
  const localReadModelClear = read("src/lib/localReadModels/clear.ts");
  const readinessPhases = read("src/lib/analytics/boardReadinessPhases.ts");
  const performanceEvents = read("src/lib/analytics/productPerformance.ts");
  const pilot = read("src/lib/boardSync/pilot.ts");
  const signout = read("src/hooks/MultiPages/HTC/useSignout.ts");

  assert.match(landing, /useSyncedBoardReadModel\(/);
  assert.match(landing, /usePreparedBoardReadModel\(/);
  assert.ok(
    landing.indexOf("usePreparedBoardReadModel({") <
      landing.indexOf("useGetAllBoards(user"),
  );
  assert.match(landing, /accountId: user\.id/);
  assert.match(landing, /projectId: requestedProjectId/);
  assert.match(landing, /authorization\.accountId === user\.id/);
  assert.match(landing, /authorization\.projectId === requestedProjectId/);
  assert.match(landing, /authorizedProjectIds: projectIds/);
  assert.match(
    landing,
    /const localCache = queryClient\.getQueryData<IProjectsAll>[\s\S]*?localCache\?\.accountId === authorization\.accountId &&\s*localCache\.dataOrigin === "indexeddb"[\s\S]*?authorizedLocalProjects = localCache\.updatedProjects\.filter[\s\S]*?authorizedLocalProjects\.length !== localCache\.updatedProjects\.length[\s\S]*?queryClient\.setQueryData<IProjectsAll>[\s\S]*?updatedProjects: current\.updatedProjects\.filter/,
    "fresh authorization must remove revoked metadata from the local cache even when the route is denied",
  );
  assert.match(
    landing,
    /MOBILE_BOARD_SWITCHER_QUERY_KEY\(authorization\.accountId\)[\s\S]*?switcherCache\.filter\(\(project\) =>[\s\S]*?projectIds\.includes\(project\.id\)[\s\S]*?queryClient\.setQueryData\(switcherKey, authorizedSwitcherProjects\)/,
    "fresh route authorization must also purge revoked metadata from the independent switcher cache",
  );
  assert.match(
    landing,
    /purgeRevokedBoardTaskQueries\([\s\S]*?authorization\.accountId,[\s\S]*?projectIds/,
    "fresh authorization must purge revoked task payloads from the side cache",
  );
  assert.match(
    boardsHook,
    /cancelQueries\(revokedBoardTasks, \{ revert: false \}\)[\s\S]*?removeQueries\(revokedBoardTasks\)/,
  );
  assert.match(
    landing,
    /const switcherCancellation = queryClient\.cancelQueries[\s\S]*?void switcherCancellation[\s\S]*?queryClient\.invalidateQueries\([\s\S]*?queryKey: switcherKey,[\s\S]*?refetchType: "active"/,
    "a mounted switcher request cancelled by fresh authorization must restart",
  );
  assert.equal(
    (landing.match(/return authorizeAndPublishLocalBoard\(/g) ?? []).length,
    1,
  );
  assert.match(landing, /latestBoardAuthorizationProofRef/);
  assert.match(landing, /latestBoardAuthorizationProofRef\.current = null/);
  assert.match(landing, /pilotPreferenceResolved/);
  assert.match(landing, /pilotExplicitlyDisabled/);
  assert.match(landing, /pilotWasExplicitlyDisabledRef/);
  assert.match(landing, /void refetchProjects\(\)/);
  assert.match(landing, /publishedAuthorizationKeyRef/);
  assert.match(landing, /publishAuthorizedLocalBoard\(proof\)/);
  assert.match(
    landing,
    /if \(!localDatabasePilotEnabled\) \{\s*publishedAuthorizationKeyRef\.current = null/,
  );
  assert.match(
    landing,
    /viewSurface:\s*requestedSurface === "board" \|\| requestedSurface === "table"\s*\? requestedSurface\s*:\s*boardLayout/,
  );
  assert.match(
    landing,
    /previous\.origin === "indexeddb" && origin === "network"/,
  );
  assert.match(landing, /userChangedSurface/);
  assert.match(landing, /userSurfaceChangeVersionRef/);
  assert.match(landing, /userChangeVersionAtApply/);
  assert.match(
    landing,
    /userSurfaceChangeVersionRef\.current > previous\.userChangeVersionAtApply/,
  );
  assert.match(landing, /boardLayout === "table"/);
  assert.match(landing, /<TableView/);
  assert.match(landing, /queryData\?\.accountId === user\.id/);
  assert.match(
    landing,
    /currentBoardAccessStatus === "local" \|\|\s*\(currentBoardAccessStatus === "authorized" &&\s*\(!projectsError \|\| activeBoardPayloadUnavailable\)\)/,
  );
  assert.match(
    landing,
    /projectsErrorCause instanceof ActiveBoardPayloadUnavailableError/,
    "only a post-authorization board-payload failure may retain local access",
  );
  assert.doesNotMatch(
    landing,
    /if \(!projectsError \|\| dataFetching\) return[\s\S]*?status: "denied"/,
    "a transport error must not be promoted to a definitive access denial",
  );
  assert.match(landing, /const currentNetworkResultSettled =/);
  assert.match(landing, /queryData\.networkRequestScopeKey === boardAccessKey/);
  assert.match(
    landing,
    /queryData\.networkRequestGeneration === networkAccess\.generation/,
  );
  assert.match(
    landing,
    /queryData\.networkRequestId === networkAccess\.requestId/,
  );
  assert.match(
    landing,
    /requestedProjectId == null \|\|\s*queryData\.updatedProjects\.some/,
  );
  assert.match(landing, /networkDataAuthorizedForRoute/);
  assert.match(landing, /queryData\.dataOrigin === "indexeddb"/);
  assert.match(landing, /if \(!pilotExplicitlyDisabled\) return/);
  assert.match(landing, /cached\.dataOrigin !== "indexeddb"/);
  assert.match(landing, /queryData\?\.dataOrigin === "network"/);
  assert.doesNotMatch(landing, /projectsFetchedAfterMount/);
  assert.match(
    landing,
    /networkReady: hasAccountOwnedNetworkData && !dataFetching && !projectsError/,
  );
  assert.match(landing, /boardAccess\.status/);
  assert.match(
    landing,
    /setBoardAccess\(\(current\) =>[\s\S]*?current\.key === boardAccessKey[\s\S]*?status: "pending"/,
    "the route reset effect must not overwrite a faster proof for the same route",
  );
  assert.match(
    landing,
    /setNetworkAccess\(\(current\) =>[\s\S]*?current\.key === boardAccessKey[\s\S]*?requestId: null/,
    "the route reset effect must preserve the matching proof generation",
  );
  assert.match(boardsHook, /previousData\?\.accountId === user\.id/);
  assert.match(boardsHook, /queryClient\.resetQueries\(\{/);
  assert.match(boardsHook, /accountIdRef\.current !== user\.id/);
  assert.match(
    homepageApi,
    /authorizationDecision = await options\?\.onProjectsAuthorized\?\.\([\s\S]*?localBoardPublication[\s\S]*?const boardPayload = await boardPayloadPromise[\s\S]*?resolveAuthorizedLocalFallback\(\{/,
    "network success must not wait for local publication, while network failure still preserves an authorized local fallback",
  );
  assert.match(boardsHook, /requestGenerationRef/);
  assert.match(boardsHook, /projectsAuthorizationRequestSequence/);
  assert.match(boardsHook, /useLayoutEffect\(\(\) => \{/);
  assert.match(boardsHook, /optionsRef\.current = options/);
  assert.match(boardsHook, /projectId: renderedProjectId/);
  assert.doesNotMatch(
    boardsHook,
    /const optionsRef = useRef\(options\);\s*optionsRef\.current = options/,
  );
  assert.doesNotMatch(
    boardsHook,
    /currentScopeRef\.current = \{\s*accountId: user\.id,[\s\S]*?\};\s*const requestGenerationRef/,
  );
  assert.match(boardsHook, /queryUpdateCountAtAuthorization/);
  assert.match(boardsHook, /resolvedAuthorizationRequestRef/);
  assert.match(boardsHook, /inFlightRequestRef/);
  assert.match(boardsHook, /networkRequestScopeKey: requestScopeKey/);
  assert.match(boardsHook, /networkRequestGeneration: generation/);
  assert.match(boardsHook, /networkRequestId: requestId/);
  assert.match(boardsHook, /generation,\s*requestId,/);
  assert.match(
    boardsHook,
    /queryKey: BOARD_TASKS_KEY\(Number\(projectId\), user\.id\)/,
  );
  assert.match(
    boardsHook,
    /rawBoardPayloadPromise = requestProjectId[\s\S]*?needsProjectAuthorization[\s\S]*?fetchBoardTasks\([\s\S]*?requestAccountId,[\s\S]*?signal,[\s\S]*?: queryClient\.fetchQuery/,
    "the authorization proof must use its outer request while later authorized loads may consume the shared task cache",
  );
  const authorizationFetchBranch = boardsHook.slice(
    boardsHook.indexOf("? needsProjectAuthorization"),
    boardsHook.indexOf(": queryClient.fetchQuery"),
  );
  assert.doesNotMatch(
    authorizationFetchBranch,
    /setQueryData/,
    "a late proof response must not repopulate a board cache purged by account-wide denial",
  );
  assert.match(
    boardsHook,
    /rawBoardPayloadPromise = requestProjectId[\s\S]*?needsProjectAuthorization[\s\S]*?fetchBoardTasks\([\s\S]*?signal,[\s\S]*?: queryClient\.fetchQuery[\s\S]*?staleTime: BOARD_TASKS_STALE_TIME_MS[\s\S]*?canUseProjectScopedBoardAuthorization[\s\S]*?!needsProjectAuthorization[\s\S]*?onActiveBoardAuthorized/,
    "only a request-bound exact-board response may establish the first project proof",
  );
  assert.match(
    boardsHook,
    /isProjectAuthorizationCurrent[\s\S]*?resolvedAuthorizationRequestRef\.current[\s\S]*?isCurrent: isProjectAuthorizationCurrent/,
    "a later account-wide allow or deny decision must invalidate an in-flight project proof",
  );
  assert.match(
    boardsHook,
    /void Promise\.resolve\(\)[\s\S]*?onActiveBoardAuthorized[\s\S]*?return payload/,
    "project-scoped local publication must not add IndexedDB latency to the authorized network payload",
  );
  assert.match(
    landing,
    /onActiveBoardAuthorized:[\s\S]*?authorizedProjectIds: \[projectId\][\s\S]*?onProjectsAuthorized:/,
    "project-scoped publication must expose only the board that was just authorized",
  );
  assert.match(
    landing,
    /onActiveBoardAuthorized:[\s\S]*?const localBoardPublished = await publishAuthorizedLocalBoard\([\s\S]*?if \(!localBoardPublished \|\| !authorization\.isCurrent\(\)\) return false[\s\S]*?setBoardAccess\(\{ key: boardAccessKey, status: "authorized" \}\)[\s\S]*?return true/,
    "a current project-scoped proof must authorize without repainting an already-published snapshot",
  );
  assert.match(
    landing,
    /onActiveBoardDenied:[\s\S]*?authorization\.accountId === user\.id[\s\S]*?await revokeActiveBoard\(authorization\.accountId, projectId, authorization\)/,
  );
  assert.match(
    boardsHook,
    /isBoardAccessDeniedError\(error\)[\s\S]*?onActiveBoardDenied[\s\S]*?if \(activeBoardDenialError\) throw activeBoardDenialError/,
    "a boardTasks 403 must revoke and must not publish a later metadata result",
  );
  assert.match(
    landing,
    /onProjectsAuthorized:[\s\S]*?await revokedBoardTaskPurge[\s\S]*?localBoardPublication: publishAuthorizedLocalBoard/,
    "account-wide cleanup must finish before starting the non-blocking local publication race",
  );
  assert.doesNotMatch(
    boardsHook.slice(
      boardsHook.indexOf("export const useWarmProjectsAllQuery"),
    ),
    /queryKey: PROJECTS_ALL_QUERY_KEY|queryKey: PROJECTS_ALL_WARM_QUERY_KEY/,
  );
  assert.match(
    boardsHook,
    /cancelQueries\([\s\S]*?queryKey: PROJECTS_ALL_QUERY_KEY/,
  );
  assert.match(
    boardsHook,
    /cancelQueries\([\s\S]*?PROJECTS_ALL_QUERY_KEY[\s\S]*?\{ revert: false \}/,
    "scope cancellation must not restore a cache entry purged by fresh authorization",
  );
  assert.match(
    boardsHook,
    /resolvedAuthorizationRequestRef\.current = null;\s*projectAuthorizationScopeRef\.current = null;\s*void queryClient\s*\.cancelQueries/,
    "route changes must discard the previous route's project proof before refetching",
  );
  assert.match(
    boardsHook,
    /projects\.activeBoardPayloadLoaded === false[\s\S]*?projects\.authorizedLocalBoardPublished === true[\s\S]*?throw new ActiveBoardPayloadUnavailableError/,
    "a failed task payload must retain an authorized hydrated local board",
  );
  assert.match(
    homepageApi,
    /activeBoardPayloadLoaded:[\s\S]*?boardPayload !== null[\s\S]*?authorizedLocalBoardPublished/,
  );
  assert.match(boardsHook, /query\.refetch\(\{ cancelRefetch: true \}\)/);
  assert.match(
    boardsHook,
    /currentScopeRef\.current\.accountId === requestAccountId/,
  );
  assert.match(
    boardsHook,
    /currentScopeRef\.current\.projectId === requestProjectId/,
  );
  assert.match(boardsHook, /aborted: signal\.aborted/);
  assert.match(boardsHook, /if \(!isCurrent\(\)\) return/);
  assert.match(
    boardsHook,
    /return optionsRef\.current\?\.onProjectsAuthorized\?\./,
  );
  assert.match(hook, /runtimeRef\.current = \{/);
  assert.doesNotMatch(
    hook,
    /const runtimeRef = useRef\(\{[\s\S]*?\}\);\s*runtimeRef\.current = \{/,
  );
  assert.match(homepageApi, /\{ signal: options\?\.signal \}/);
  assert.match(homepageApi, /accountId:user\.id/);
  assert.match(homepageApi, /dataOrigin:"network"/);
  assert.match(hook, /accessStatus !== "authorized"/);
  assert.match(hook, /networkData\.dataOrigin !== "network"/);
  assert.match(hook, /current\?\.accountId === accountId/);
  assert.match(hook, /dataOrigin: "indexeddb"/);
  assert.match(
    hook,
    /readBoardReadModel\(preparedAccountId, preparedProjectId\)/,
  );
  assert.match(
    hook,
    /if \(!hasBoardReadModelMarker\(\)\) return null;/,
    "no marker must skip the local read entirely -- no databases() call, no keyed open",
  );
  assert.doesNotMatch(
    hook,
    /indexedDB\.databases\(\)/,
    "HTPR-5927: the databases() enumeration is gone, replaced by the marker",
  );
  assert.match(hook, /authorizedProjectIds\.includes/);
  assert.match(hook, /proof\.accountId === accountId/);
  assert.match(hook, /proof\.projectId === projectId/);
  assert.match(hook, /proof\.isCurrent\(\)/);
  assert.match(hook, /didNetworkResultPublishAfterAuthorization/);
  assert.match(
    hook,
    /updateCountAtAuthorization:\s*proof\.queryUpdateCountAtAuthorization/,
  );
  assert.match(hook, /\{ updatedAt: 0 \}/);
  assert.doesNotMatch(hook, /"indexeddb_miss",/);
  assert.match(
    landing,
    /pinProjectToUrlView\(projects\[projectIndex\], currentView\)/,
  );
  assert.match(
    landing,
    /const reconciledLayout = userChangedSurface \? boardLayout : resolvedLayout/,
  );
  assert.doesNotMatch(hook, /BOARD_TASKS_KEY/);
  assert.ok(
    hook.indexOf("const payload = await prepareLocalRead()") <
      hook.indexOf("queryClient.setQueryData("),
  );
  assert.match(hook, /writeBoardReadModel\(/);
  assert.match(
    hook,
    /let cancelled = false[\s\S]*?if \(cancelled\) return false[\s\S]*?cancelled = true/,
    "revocation or navigation must cancel an unresolved snapshot write",
  );
  assert.match(readinessPhases, /analytics_surface: "authenticated_app"/);
  assert.match(readinessPhases, /view_surface: completion\.viewSurface/);
  assert.doesNotMatch(hook, /viewSurfaceRef\.current/);
  assert.match(readinessPhases, /readiness_source: completion\.readinessSource/);
  assert.match(performanceEvents, /readiness_measurement_version: 3/);
  assert.match(readinessPhases, /readiness_measurement_version: 3/);
  assert.match(
    landing,
    /requestAnimationFrame\(\(\) => \{[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?emitBoardReadinessAfterPaint/,
    "readiness must be emitted only after the board reaches a painted frame",
  );
  assert.match(
    readinessPhases,
    /readiness_measurement_scope: "project_route_entry"/,
  );
  assert.match(
    hook,
    /Deliberately exclude viewSurface[\s\S]*const activeKey =[\s\S]*`\$\{accountId\}:\$\{projectId\}`/,
  );
  assert.match(hook, /requestId: `indexeddb:\$\{activeKey\}:\$\{generation\}`/);
  assert.match(hook, /void authorizeAndPublishLocalBoard\(proof\)/);
  assert.match(hook, /publishedLocalKeyRef/);
  assert.match(
    hook,
    /const generation = \+\+localProofGenerationRef\.current;[\s\S]*?publishedLocalKeyRef\.current = null;/,
    "route re-entry must reset the publication claim",
  );
  assert.match(
    landing,
    /const proofKey = `\$\{revocationKey\}:\$\{authorization\.requestId\}`[\s\S]*?boardRevocationRef\.current\?\.key === proofKey/,
    "a second denial must not reuse an earlier proof's revocation promise",
  );
  assert.match(hook, /cancelPreparedLocalPublication/);
  assert.match(indexedDb, /BroadcastChannel/);
  assert.match(indexedDb, /database\.onversionchange/);
  assert.match(indexedDb, /operationsDisabled = true/);
  assert.match(indexedDb, /revokeBoardReadModel/);
  assert.match(
    indexedDb,
    /revokeBoardReadModel[\s\S]*?\.put\(createBoardReadModelRevocation\(accountId, projectId\)\)/,
    "revocation must overwrite the snapshot in one put, not delete it",
  );
  assert.match(
    indexedDb,
    /clearBoardReadModelRevocation[\s\S]*?isBoardReadModelSnapshotV1\(record\.result, accountId, projectId\)\) return;[\s\S]*?store\.delete\(key\)/,
    "clearing a revocation must never remove a valid snapshot",
  );
  assert.match(
    localReadModelClear,
    /clearRevokedBoardReadModel[\s\S]*?revokeBoardReadModel/,
  );
  assert.match(
    localReadModelClear,
    /clearRevokedBoardMarker[\s\S]*?clearBoardRevocationTombstone\(accountId, projectId\)[\s\S]*?clearBoardReadModelRevocation\(accountId, projectId\)/,
    "fresh authorization must lift both the session quarantine and the stored stub",
  );
  assert.match(
    hook,
    /cancelPreparedLocalPublication = useCallback\(\(\) => \{[\s\S]*?publishedLocalKeyRef\.current = null;/,
    "cancelling a prepared publication must release its claim",
  );
  assert.match(
    indexedDb,
    /isBoardReadModelRevocationV1\(existing\.result, accountId, projectId\)[\s\S]*?return;[\s\S]*?store\.put\(snapshot\)/,
    "a snapshot write must not overwrite another tab's revocation stub",
  );
  assert.match(
    boardsHook,
    /revokeBoardAccess[\s\S]*?removeQueries\(revokedBoardTasks\)[\s\S]*?clearLocalBoard\(accountId, projectId\)[\s\S]*?router\.replace\("\/"\)/,
  );
  assert.match(
    landing,
    /const isCurrent = \(\) =>\s*isRevocationStillActiveBoard\([\s\S]*?currentBoardKey: boardAccessKeyRef\.current,[\s\S]*?if \(isCurrent\(\)\) cancelPreparedLocalPublication\(\)/,
    "a revocation that lost the route must not cancel the new route's prepared publication",
  );
  assert.match(
    landing,
    /void promise[\s\S]*?\.finally\([\s\S]*?boardRevocationRef\.current === entry\) \{[\s\S]*?boardRevocationRef\.current = null/,
    "a settled revocation must release its memo so a later denial of the same board can redirect",
  );
  assert.match(pilot, /NEXT_PUBLIC_SYNCED_BOARD_CACHE !== "false"/);
  assert.doesNotMatch(indexedDb, /request\.onblocked = \(\) => resolve\(/);
  assert.match(
    signout,
    /localReadModelsCleared = await clearAllLocalReadModels\(\)/,
  );
  assert.match(signout, /if \(!localReadModelsCleared\)/);
  assert.match(signout, /return false/);
  assert.ok(
    signout.indexOf("if (!localReadModelsCleared)") <
      signout.indexOf("await signOutAllAccounts()"),
  );
});

test("a revocation that lost the route touches nothing", async () => {
  const queryClient = createQueryClient();
  const accountId = fixture.accountId;
  const projectId = fixture.projectId;
  const nextProjectId = projectId + 1;
  queryClient.setQueryData(["projectsAll"], {
    accountId,
    dataOrigin: "network",
    index: 0,
    updatedProjects: [{ id: nextProjectId }, fixture.project],
    notificationsCount: { all: 0, unseen: 0 },
  });
  const events = [];

  await revokeBoardAccess({
    queryClient,
    accountId,
    projectId,
    clearLocalBoard: async (clearedAccountId, clearedProjectId) => {
      events.push(`clear:${clearedAccountId}:${clearedProjectId}`);
      return true;
    },
    router: { replace: (href) => events.push(`replace:${href}`) },
    isCurrent: () => false,
  });

  // Reopening a genuinely denied board 403s again and revokes it for real, so
  // a stale denial may skip every destructive step.
  assert.deepEqual(events, []);
  const projectsAll = queryClient.getQueryData(["projectsAll"]);
  // The board the user switched to must keep rendering.
  assert.equal(projectsAll.index, 0);
  assert.deepEqual(
    projectsAll.updatedProjects.map((project) => project.id),
    [nextProjectId, projectId],
  );
  queryClient.clear();
});

test("a revocation drops the denied board from the mobile switcher cache", async () => {
  const queryClient = createQueryClient();
  const accountId = fixture.accountId;
  const projectId = fixture.projectId;
  const otherProjectId = projectId + 1;
  const switcherKey = ["mobileBoardSwitcherProjects", accountId];
  queryClient.setQueryData(switcherKey, [
    { id: projectId },
    { id: otherProjectId },
  ]);

  await revokeBoardAccess({
    queryClient,
    accountId,
    projectId,
    clearLocalBoard: async () => true,
    router: { replace: () => {} },
  });

  assert.deepEqual(
    queryClient.getQueryData(switcherKey).map((project) => project.id),
    [otherProjectId],
    "a denied board must not stay tappable in the board switcher sheet",
  );
  queryClient.clear();
});

test("a board revoked in this session can never publish again", async () => {
  const accountId = fixture.accountId;
  const projectId = fixture.projectId;
  let markerAttempts = 0;

  await revokeBoardAccessShared({
    queryClient: createQueryClient(),
    accountId,
    projectId,
    clearLocalBoard: async () => {
      markerAttempts += 1;
      return false;
    },
    router: { replace: () => {} },
  });

  // One retry covers a transient IndexedDB failure before the stub is given up
  // on; the in-session quarantine fails closed either way.
  assert.equal(markerAttempts, 2);

  const queryClient = createQueryClient();
  assert.equal(
    await publishPreparedLocalBoardShared(
      createLocalPublicationInput({ queryClient }),
    ),
    false,
    "a revoked snapshot must not publish",
  );
  assert.equal(queryClient.getQueryData(projectsAllKey), undefined);

  clearSharedRevocation(accountId, projectId);
  assert.equal(
    await publishPreparedLocalBoardShared(
      createLocalPublicationInput({ queryClient }),
    ),
    true,
    "fresh network authorization lets the board publish again",
  );
  assert.ok(queryClient.getQueryData(projectsAllKey));
  queryClient.clear();
});

test("a revocation landing during the local read blocks that publication", async () => {
  const accountId = fixture.accountId;
  const projectId = fixture.projectId;
  const queryClient = createQueryClient();
  const localRead = createDeferred();

  const publication = publishPreparedLocalBoardShared(
    createLocalPublicationInput({
      queryClient,
      prepareLocalRead: () => localRead.promise,
    }),
  );

  await revokeBoardAccessShared({
    queryClient: createQueryClient(),
    accountId,
    projectId,
    clearLocalBoard: async () => true,
    router: { replace: () => {} },
  });
  // The read started before the revocation, so it still resolves a payload.
  localRead.resolve(fixtureLocalPayload);

  assert.equal(await publication, false);
  assert.equal(queryClient.getQueryData(projectsAllKey), undefined);
  clearSharedRevocation(accountId, projectId);
  queryClient.clear();
});

test("a revoked board stays blocked after a reload", async () => {
  const accountId = fixture.accountId;
  const projectId = fixture.projectId;
  const stub = createBoardReadModelRevocation(accountId, projectId);

  // The stub occupies the snapshot's own key, so revoking overwrites the data.
  assert.equal(stub.key, boardReadModelKey(accountId, projectId));
  // Every read path validates the record it finds. The stub is not a snapshot,
  // so readBoardReadModel returns null with no in-memory state involved.
  assert.equal(isBoardReadModelSnapshotV1(stub, accountId, projectId), false);

  // A reload keeps the store and drops the session quarantine.
  const queryClient = createQueryClient();
  assert.equal(
    await publishPreparedLocalBoard(
      createLocalPublicationInput({
        queryClient,
        prepareLocalRead: async () => null,
      }),
    ),
    false,
  );
  assert.equal(queryClient.getQueryData(projectsAllKey), undefined);
  queryClient.clear();
});

test("a revocation only cancels and redirects while it is the rendered board", () => {
  const revocationKey = `${fixture.accountId}:${fixture.projectId}`;
  const otherBoardKey = `${fixture.accountId}:${fixture.projectId + 1}`;

  assert.equal(
    isRevocationStillActiveBoard({
      proofIsCurrent: () => true,
      currentBoardKey: revocationKey,
      revocationKey,
    }),
    true,
  );
  // The user switched boards while the denial was being processed.
  assert.equal(
    isRevocationStillActiveBoard({
      proofIsCurrent: () => true,
      currentBoardKey: otherBoardKey,
      revocationKey,
    }),
    false,
  );
  // A superseded request never speaks for the rendered board either.
  assert.equal(
    isRevocationStillActiveBoard({
      proofIsCurrent: () => false,
      currentBoardKey: revocationKey,
      revocationKey,
    }),
    false,
  );
});

test("route re-entry publishes again after its claim is reset", async () => {
  // Mirrors the hook's claim: publishedLocalKeyRef plus the reset the route
  // effect performs when activeKey changes.
  const publishedLocalKey = { current: null };
  const claimPublication = (publicationKey) => {
    if (publishedLocalKey.current === publicationKey) return false;
    publishedLocalKey.current = publicationKey;
    return true;
  };
  const queryClient = createQueryClient();
  const input = () =>
    createLocalPublicationInput({ queryClient, claimPublication });

  assert.equal(await publishPreparedLocalBoard(input()), true);
  assert.ok(queryClient.getQueryData(projectsAllKey));

  // Leaving the route drops the published payload.
  queryClient.removeQueries({ queryKey: projectsAllKey, exact: true });
  assert.equal(
    await publishPreparedLocalBoard(input()),
    true,
    "an unreset claim still reports success",
  );
  assert.equal(
    queryClient.getQueryData(projectsAllKey),
    undefined,
    "without a reset that success publishes nothing",
  );

  publishedLocalKey.current = null;
  assert.equal(await publishPreparedLocalBoard(input()), true);
  assert.ok(
    queryClient.getQueryData(projectsAllKey),
    "re-entry republishes once the claim is reset",
  );
  queryClient.clear();
});

test("a revocation stub is told apart from a snapshot and from junk", () => {
  const accountId = fixture.accountId;
  const projectId = fixture.projectId;
  const stub = createBoardReadModelRevocation(accountId, projectId);
  const snapshot = createBoardReadModelSnapshot({
    accountId,
    projectId,
    payload: fixtureLocalPayload,
  });

  assert.equal(isBoardReadModelRevocationV1(stub, accountId, projectId), true);
  assert.equal(
    isBoardReadModelRevocationV1(stub, accountId, projectId + 1),
    false,
  );
  assert.equal(isBoardReadModelRevocationV1(snapshot), false);
  // A corrupt record must stay overwritable, so it must not read as a stub.
  assert.equal(isBoardReadModelRevocationV1({ ...stub, key: "junk" }), false);
  assert.equal(isBoardReadModelRevocationV1({ ...stub, revokedAt: 1 }), false);
  assert.equal(isBoardReadModelRevocationV1(null), false);
  assert.equal(isBoardReadModelRevocationV1([stub]), false);
});

test("a stub that could not be written falls back to a durable flag", async () => {
  const localStorage = useFakeLocalStorage();
  try {
    const accountId = fixture.accountId;
    const projectId = fixture.projectId;

    await revokeBoardAccessShared({
      queryClient: createQueryClient(),
      accountId,
      projectId,
      clearLocalBoard: async () => false,
      router: { replace: () => {} },
    });

    assert.deepEqual(
      [...localStorage.store.keys()],
      [`hypertask:board-revoked:${accountId}:${projectId}`],
      "one key per board, written whole, so two tabs cannot lose an entry",
    );

    // Simulated reload: new module state, empty quarantine, flag still there.
    const reloaded = reloadedRevocationTombstone();
    assert.equal(
      reloaded.isBoardRevocationTombstoned(accountId, projectId),
      true,
    );
    assert.equal(
      reloaded.isBoardRevocationTombstoned(accountId, projectId + 1),
      false,
    );

    reloaded.clearBoardRevocationTombstone(accountId, projectId);
    assert.equal(localStorage.store.size, 0);
    clearSharedRevocation(accountId, projectId);
  } finally {
    localStorage.restore();
  }
});

test("a stub that was written leaves nothing in localStorage", async () => {
  const localStorage = useFakeLocalStorage();
  try {
    const accountId = fixture.accountId;
    const projectId = fixture.projectId;

    await revokeBoardAccessShared({
      queryClient: createQueryClient(),
      accountId,
      projectId,
      clearLocalBoard: async () => true,
      router: { replace: () => {} },
    });

    assert.equal(
      localStorage.store.size,
      0,
      "the in-DB stub is the marker; the normal path writes no fallback",
    );
    clearSharedRevocation(accountId, projectId);
  } finally {
    localStorage.restore();
  }
});
