const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const pageSource = read("src/app/[...boardURL]/page.tsx");
const bootstrapSource = read("src/lib/boardBootstrap/earlyBoardBootstrap.ts");
const apiSource = read("src/utils/api/Homepage/index.ts");
const boardsHookSource = read("src/hooks/Homepage/useGetBoards.ts");
const landingSource = read("src/app/[...boardURL]/LandingPage.tsx");

test("the authenticated board starts its critical requests before LandingPage hydration", () => {
  const scriptPosition = pageSource.indexOf('id="ht-early-board-bootstrap"');
  const landingPagePosition = pageSource.indexOf(
    "<LandingPage\n        slugs={slugs}",
  );

  assert.ok(
    scriptPosition > -1,
    "the parser-time bootstrap script must render",
  );
  assert.ok(
    scriptPosition < landingPagePosition,
    "the bootstrap script must precede the large client boundary",
  );
  assert.match(pageSource, /projectValidation\.success/);
  assert.match(pageSource, /Number\.isInteger\(accountId\)/);
  assert.match(pageSource, /Number\.isInteger\(projectId\)/);
  assert.match(pageSource, /verifySession\(/);
  assert.match(pageSource, /authenticated=\{authenticated\}/);
});

test("the parser-time script starts both protected requests immediately", async () => {
  const transpiledBootstrap = ts.transpileModule(bootstrapSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const bootstrapModule = { exports: {} };
  new Function("exports", "module", transpiledBootstrap)(
    bootstrapModule.exports,
    bootstrapModule,
  );
  const {
    buildEarlyBoardBootstrapScript,
    consumeEarlyBoardBootstrap,
    discardEarlyBoardBootstrap,
  } = bootstrapModule.exports;
  const calls = [];
  const marks = [];
  const runtimeWindow = {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ url }),
      };
    },
    performance: {
      mark: (name) => marks.push(name),
      getEntriesByName: (name) =>
        marks.filter((candidate) => candidate === name).map(() => ({ name })),
      clearMarks: (name) => {
        for (let index = marks.length - 1; index >= 0; index -= 1) {
          if (marks[index] === name) marks.splice(index, 1);
        }
      },
    },
  };

  vm.runInNewContext(
    buildEarlyBoardBootstrapScript({
      accountId: 6,
      projectId: 15,
    }),
    { window: runtimeWindow, JSON },
  );

  assert.deepEqual(
    calls.map(({ url }) => url),
    ["/api/projects/getAll", "/api/projects/boardTasks"],
  );
  for (const { init } of calls) {
    assert.equal(init.credentials, "include");
    assert.equal(init.method, "POST");
  }
  assert.deepEqual(marks, [
    "ht-board-bootstrap-start",
    "ht-board-auth-available",
    "ht-board-projects-request-start",
    "ht-board-tasks-request-start",
  ]);

  global.window = runtimeWindow;
  try {
    const first = await consumeEarlyBoardBootstrap(
      "projectsAll",
      6,
      15,
    );
    const replay = await consumeEarlyBoardBootstrap(
      "projectsAll",
      6,
      15,
    );
    const wrongBoard = await consumeEarlyBoardBootstrap(
      "boardTasks",
      6,
      16,
    );

    assert.deepEqual(first, { url: "/api/projects/getAll" });
    assert.equal(replay, undefined);
    assert.equal(wrongBoard, undefined);

    delete runtimeWindow.__htEarlyBoardBootstrap;
    vm.runInNewContext(
      buildEarlyBoardBootstrapScript({ accountId: 6, projectId: 15 }),
      { window: runtimeWindow, JSON },
    );
    discardEarlyBoardBootstrap(6, 15, "projectsAll");
    const discardedProjects = await consumeEarlyBoardBootstrap(
      "projectsAll",
      6,
      15,
    );
    const retainedBoardTasks = await consumeEarlyBoardBootstrap(
      "boardTasks",
      6,
      15,
    );
    assert.equal(discardedProjects, undefined);
    assert.deepEqual(retainedBoardTasks, { url: "/api/projects/boardTasks" });
    assert.ok(marks.includes("ht-board-projects-request-early-finish"));
    assert.ok(marks.includes("ht-board-tasks-request-early-finish"));
    assert.ok(marks.includes("ht-board-projects-request-finish"));
    assert.ok(marks.includes("ht-board-tasks-request-finish"));
  } finally {
    delete global.window;
  }
});

test("early requests settle safely and can only be consumed once", () => {
  assert.match(bootstrapSource, /credentials:\"include\"/);
  assert.match(bootstrapSource, /ht-board-auth-available/);
  assert.match(bootstrapSource, /name\+\"-early-finish\"/);
  assert.match(bootstrapSource, /if\(result\.ok\)\{mark\(name\+\"-finish\"\);\}/);
  assert.match(bootstrapSource, /function\(\)\{return \{ok:false\};\}/);
  assert.match(bootstrapSource, /delete bootstrap\.requests\[requestName\]/);
  assert.match(bootstrapSource, /Date\.now\(\) > bootstrap\.expiresAt/);
  assert.match(
    bootstrapSource,
    /bootstrap\.accountId !== accountId[\s\S]*bootstrap\.projectId !== projectId/,
  );
});

test("a parser-time account or project change resets the readiness runtime", () => {
  const transpiledBootstrap = ts.transpileModule(bootstrapSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const bootstrapModule = { exports: {} };
  new Function("exports", "module", transpiledBootstrap)(
    bootstrapModule.exports,
    bootstrapModule,
  );
  const marks = ["ht-board-query-published", "ht-board-first-commit"];
  const clearedTimers = [];
  const runtimeWindow = {
    __htBoardReadinessRuntime: {
      accountId: 6,
      projectId: 15,
      emitted: true,
      fallbackTimer: 99,
    },
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }),
    clearTimeout: (timer) => clearedTimers.push(timer),
    performance: {
      mark: (name) => marks.push(name),
      getEntriesByName: (name) =>
        marks.filter((candidate) => candidate === name).map(() => ({ name })),
      clearMarks: (name) => {
        for (let index = marks.length - 1; index >= 0; index -= 1) {
          if (marks[index] === name) marks.splice(index, 1);
        }
      },
    },
  };

  vm.runInNewContext(
    bootstrapModule.exports.buildEarlyBoardBootstrapScript({
      accountId: 6,
      projectId: 16,
    }),
    { window: runtimeWindow, JSON },
  );

  assert.deepEqual(clearedTimers, [99]);
  assert.equal(runtimeWindow.__htBoardReadinessRuntime.accountId, 6);
  assert.equal(runtimeWindow.__htBoardReadinessRuntime.projectId, 16);
  assert.equal(runtimeWindow.__htBoardReadinessRuntime.generation, 0);
  assert.equal(runtimeWindow.__htBoardReadinessRuntime.emitted, undefined);
  assert.equal(runtimeWindow.__htBoardReadinessRuntime.completion, undefined);
  assert.deepEqual(marks.slice(0, 4), [
    "ht-board-bootstrap-start",
    "ht-board-auth-available",
    "ht-board-projects-request-start",
    "ht-board-tasks-request-start",
  ]);
});

test("successful early request finish is frozen before React consumes it", async () => {
  const transpiledBootstrap = ts.transpileModule(bootstrapSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const bootstrapModule = { exports: {} };
  new Function("exports", "module", transpiledBootstrap)(
    bootstrapModule.exports,
    bootstrapModule,
  );
  const marks = [];
  const runtimeWindow = {
    fetch: async (url) => ({
      ok: true,
      status: 200,
      json: async () => ({ url }),
    }),
    performance: {
      mark: (name) => marks.push(name),
      getEntriesByName: (name) =>
        marks.filter((candidate) => candidate === name).map(() => ({ name })),
      clearMarks: (name) => {
        for (let index = marks.length - 1; index >= 0; index -= 1) {
          if (marks[index] === name) marks.splice(index, 1);
        }
      },
    },
  };

  vm.runInNewContext(
    bootstrapModule.exports.buildEarlyBoardBootstrapScript({
      accountId: 6,
      projectId: 15,
    }),
    { window: runtimeWindow, JSON },
  );
  await new Promise((resolve) => setImmediate(resolve));
  const finishesBeforeConsumption = marks.filter((name) =>
    name.endsWith("-request-finish"),
  );

  global.window = runtimeWindow;
  try {
    await bootstrapModule.exports.consumeEarlyBoardBootstrap(
      "projectsAll",
      6,
      15,
    );
    assert.deepEqual(
      marks.filter((name) => name.endsWith("-request-finish")),
      finishesBeforeConsumption,
    );
    assert.deepEqual(finishesBeforeConsumption, [
      "ht-board-projects-request-finish",
      "ht-board-tasks-request-finish",
    ]);
  } finally {
    delete global.window;
  }
});

test("late parser request completions cannot mark a newer route trace", async () => {
  const transpiledBootstrap = ts.transpileModule(bootstrapSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const bootstrapModule = { exports: {} };
  new Function("exports", "module", transpiledBootstrap)(
    bootstrapModule.exports,
    bootstrapModule,
  );
  const fetchResolvers = [];
  const marks = [];
  const runtimeWindow = {
    fetch: () =>
      new Promise((resolve) => {
        fetchResolvers.push(resolve);
      }),
    performance: {
      mark: (name) => marks.push(name),
      getEntriesByName: (name) =>
        marks.filter((candidate) => candidate === name).map(() => ({ name })),
      clearMarks: () => undefined,
    },
  };

  vm.runInNewContext(
    bootstrapModule.exports.buildEarlyBoardBootstrapScript({
      accountId: 6,
      projectId: 15,
    }),
    { window: runtimeWindow, JSON },
  );
  const staleRequests = Object.values(
    runtimeWindow.__htEarlyBoardBootstrap.requests,
  );
  runtimeWindow.__htBoardReadinessRuntime = {
    accountId: 6,
    projectId: 15,
    routeEntryId: 2,
    generation: 1,
  };
  for (const resolveFetch of fetchResolvers) {
    resolveFetch({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
  }
  await Promise.all(staleRequests);

  assert.equal(
    marks.some((name) => name.endsWith("-early-finish")),
    false,
  );
  assert.equal(
    marks.some((name) => name.endsWith("-request-finish")),
    false,
  );
});

test("a warm persisted board discards unused parser responses", () => {
  assert.match(
    boardsHookSource,
    /discardEarlyBoardBootstrap\(user\.id, projectId, "projectsAll"\)/,
  );
  assert.match(boardsHookSource, /query\.data\.accountId !== user\.id/);
  assert.match(boardsHookSource, /query\.isFetching/);
  assert.match(
    landingSource,
    /isBoardPayloadHydrated\(proj\)[\s\S]*discardEarlyBoardBootstrap\(user\.id, proj\.id, "boardTasks"\)/,
  );
  assert.match(
    landingSource,
    /isBoardTasksPayload\(warm\)[\s\S]*discardEarlyBoardBootstrap\(user\.id, proj\.id, "boardTasks"\)/,
  );
});

test("React Query consumes matching early data and retains the existing fallback", () => {
  assert.match(
    apiSource,
    /consumeEarlyBoardBootstrap<BoardTasksPayload>[\s\S]*axios\.post\(`\/api\/projects\/boardTasks`/,
  );
  assert.match(
    apiSource,
    /consumeEarlyBoardBootstrap<IProject\[]>[\s\S]*axios\.post\(`\/api\/projects\/getAll`/,
  );
  assert.match(apiSource, /Array\.isArray\(earlyProjectsPayload\)/);
  assert.match(apiSource, /isBoardTasksPayload\(earlyPayload\)/);
  assert.match(
    apiSource,
    /isBoardTasksPayload\(earlyPayload\)[\s\S]*markBoardReadinessPhase\("boardRequestFinish", readinessTraceScope\)/,
  );
  assert.match(
    apiSource,
    /axios\.post\(`\/api\/projects\/boardTasks`[\s\S]*finally[\s\S]*markBoardReadinessPhase\("boardRequestFinish", readinessTraceScope\)/,
  );
  assert.match(
    apiSource,
    /axios\.post\(`\/api\/projects\/getAll`[\s\S]*finally[\s\S]*markBoardReadinessPhase\("projectsRequestFinish", readinessTraceScope\)/,
  );
});
