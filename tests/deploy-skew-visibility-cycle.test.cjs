const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(
  path.resolve(
    __dirname,
    "../src/components/System/deploySkewGuardLogic.ts",
  ),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const mod = { exports: {} };
new Function("module", "exports", javascript)(mod, mod.exports);
const {
  decideHiddenReload,
  decideIdleReload,
  isDeploySkewReloadEligiblePath,
} = mod.exports;

test("deploy skew never auto-reloads a board route", () => {
  assert.equal(isDeploySkewReloadEligiblePath("/project"), false);
  assert.equal(isDeploySkewReloadEligiblePath("/project/15"), false);
  assert.equal(isDeploySkewReloadEligiblePath("/projects"), true);
  assert.equal(isDeploySkewReloadEligiblePath("/inbox"), true);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function reloadState(overrides = {}) {
  const mutable = {
    cycle: 1,
    visibility: "hidden",
    cancelled: false,
    editing: false,
    idle: true,
  };
  return {
    mutable,
    value: {
      expectedVisibilityCycle: 1,
      getVisibilityCycle: () => mutable.cycle,
      getVisibilityState: () => mutable.visibility,
      isCancelled: () => mutable.cancelled,
      isEditing: () => mutable.editing,
      isIdle: () => mutable.idle,
      canReachOrigin: async () => true,
      ...overrides,
    },
  };
}

test("hidden reload proceeds only with reachability from the current cycle", async () => {
  const state = reloadState();
  assert.equal(await decideHiddenReload(state.value), "reload");
});

test("visible then hidden invalidates an in-flight hidden preflight", async () => {
  const reachability = deferred();
  const state = reloadState({
    canReachOrigin: () => reachability.promise,
  });

  const decision = decideHiddenReload(state.value);
  state.mutable.visibility = "visible";
  state.mutable.cycle += 1;
  state.mutable.visibility = "hidden";
  state.mutable.cycle += 1;
  reachability.resolve(true);

  assert.equal(await decision, "skip");
});

test("a stale failed preflight cannot replace the new cycle's grace timer", async () => {
  const reachability = deferred();
  const state = reloadState({
    canReachOrigin: () => reachability.promise,
  });

  const decision = decideHiddenReload(state.value);
  state.mutable.visibility = "visible";
  state.mutable.cycle += 1;
  state.mutable.visibility = "hidden";
  state.mutable.cycle += 1;
  reachability.resolve(false);

  assert.equal(await decision, "skip");
});

test("an unreachable current hidden cycle retries without navigating", async () => {
  const state = reloadState({ canReachOrigin: async () => false });
  assert.equal(await decideHiddenReload(state.value), "retry");
});

test("editing or unmount during hidden preflight cancels reload", async () => {
  for (const mutation of ["editing", "cancelled"]) {
    const reachability = deferred();
    const state = reloadState({ canReachOrigin: () => reachability.promise });
    const decision = decideHiddenReload(state.value);
    state.mutable[mutation] = true;
    reachability.resolve(true);
    assert.equal(await decision, "skip");
  }
});

test("visible idle preflight is invalid after a visibility cycle change", async () => {
  const reachability = deferred();
  const state = reloadState({ canReachOrigin: () => reachability.promise });
  state.mutable.visibility = "visible";

  const decision = decideIdleReload(state.value);
  state.mutable.visibility = "hidden";
  state.mutable.cycle += 1;
  state.mutable.visibility = "visible";
  state.mutable.cycle += 1;
  reachability.resolve(true);

  assert.equal(await decision, "skip");
});

test("visible idle reload rechecks activity after reachability resolves", async () => {
  const reachability = deferred();
  const state = reloadState({ canReachOrigin: () => reachability.promise });
  state.mutable.visibility = "visible";

  const decision = decideIdleReload(state.value);
  state.mutable.idle = false;
  reachability.resolve(true);

  assert.equal(await decision, "skip");
});

test("visible idle reload proceeds with current reachability and inactivity", async () => {
  const state = reloadState();
  state.mutable.visibility = "visible";
  assert.equal(await decideIdleReload(state.value), "reload");
});
