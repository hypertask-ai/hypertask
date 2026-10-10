const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createJiti } = require("jiti");
const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true, fsCache: false });
const {
  parseFlagsPageFilters: parse,
  serializeFlagsPageFilters: serialize,
  matchesFlagKind,
  matchesFlagRisk,
  flagDaysWaiting,
  useFlagsPageFilters,
} = jiti(path.join(root, "src/app/admin/flags/useFlagsPageFilters.ts"));
const { clusterFeatureFlagsByReleaseDate: cluster, countFeatureFlagsByAudience: count } = jiti(path.join(root, "src/lib/flags/cluster.ts"));
const { FEATURE_FLAG_RELEASE_RISKS: risks } = jiti(path.join(root, "src/lib/flags/releaseRisk.ts"));
const { matchesFeatureFlagSearch } = jiti(path.join(root, "src/lib/flags/discovery.ts"));
const modes = ["OWNER_ONLY", "OWNER_AND_QA", "EVERYONE", "OFF"];
const tabs = ["all", "unreleased", "only-me", "owner-and-qa", "everyone", "off"];
const kinds = ["feature", "improvement", "bugfix"];
const fixture = (key, kind, mode, shippedOn) => ({ key, kind, mode, shippedOn, description: "Slack integration", updatedAt: new Date("2000-01-01"), ticketId: null, ticketTitle: null });

test("URL parse/serialize round trips every tab, type combination, query and sort", () => {
  for (const tab of tabs) {
    for (let mask = 0; mask < 8; mask++) {
      for (const sort of ["risk", "newest", "oldest"]) {
        for (const risk of ["", "none", "small", "new"]) {
        const types = kinds.filter((_, index) => mask & (1 << index)).map(kind => kind === "bugfix" ? "bug" : kind).join(",");
        const state = parse(new URLSearchParams({ tab, type: types, q: "slack + café & alerts", sort, risk }).toString());
        assert.deepEqual(parse(serialize(state)), state);
        }
      }
    }
  }
});

test("defaults are omitted; unknown values fail safely; unrelated query and anchors remain usable", () => {
  assert.equal(serialize(parse("")), "");
  assert.equal(serialize(parse("tab=all&type=&q=&sort=risk")), "");
  assert.deepEqual(parse("tab=toString&type=unknown&sort=invalid&risk=invalid"), parse(""));
  assert.deepEqual(parse("tab=__proto__&type=feature,unknown,feature,improvement"), { ...parse(""), kinds: ["feature", "improvement"] });
  assert.equal(serialize(parse("q=hello"), "other=keep&tab=off&q=old"), "other=keep&q=hello");
  assert.equal(serialize(parse("type=improvement,feature")), "type=feature%2Cimprovement");
});

test("all type combinations intersect every audience and all-word search", () => {
  const rows = modes.flatMap(mode => kinds.map(kind => fixture(`${mode}-${kind}`, kind, mode, "2026-10-01")));
  rows.push({ ...fixture("unrelated", "feature", "OWNER_ONLY", "2026-10-01"), description: "Calendar" });
  for (const tab of tabs) {
    for (let mask = 0; mask < 8; mask++) {
      const selected = kinds.filter((_, index) => mask & (1 << index));
      const filters = { ...parse(`tab=${tab}&q=slack integration`), kinds: selected };
      const actual = cluster(rows.filter(row => matchesFlagKind(row, selected) && matchesFeatureFlagSearch(row, filters.search)), "desc", filters.audience, { unreleasedOnly: true }).flatMap(([, rows]) => rows);
      const expected = rows.filter(row => row.key !== "unrelated" && (!selected.length || selected.includes(row.kind)) && (tab === "all" || (tab === "unreleased" ? (row.mode === "OWNER_ONLY" || row.mode === "OWNER_AND_QA") : row.mode === filters.audience)));
      assert.deepEqual(actual, expected);
    }
  }
  assert.equal(matchesFlagKind({ kind: undefined }, ["feature"]), true);
});

test("oldest first uses production day, not update time, and puts missing days last", () => {
  const rows = [fixture("new", "feature", "OWNER_ONLY", "2026-10-08"), fixture("unknown", "feature", "OWNER_ONLY", null), fixture("old", "improvement", "OWNER_AND_QA", "2026-09-01")];
  const ordered = cluster(rows, "asc", "UNRELEASED", { shippedOnly: true, unreleasedOnly: true }).flatMap(([, rows]) => rows);
  assert.deepEqual(ordered.map(row => row.key), ["old", "new", "unknown"]);
  assert.deepEqual(ordered.map(row => flagDaysWaiting(row, new Date(2026, 9, 9))), [38, 1, null]);
  assert.deepEqual(cluster(rows, "desc", "ALL").flatMap(([, rows]) => rows).map(row => row.key), ["new", "old", "unknown"]);
  assert.equal(rows[0].key, "new", "sorting must not mutate input");
});

test("days waiting counts calendar days including DST, clamps future days, and hides released or unknown dates", () => {
  const now = new Date(2026, 9, 9, 23, 59);
  for (const mode of modes) {
    assert.equal(flagDaysWaiting({ mode, shippedOn: "2026-10-08" }, now), (mode === "EVERYONE" || mode === "OFF") ? null : 1);
  }
  for (const shippedOn of [null, "bad", "2026-02-30", "2026-13-01"]) {
    assert.equal(flagDaysWaiting({ mode: "OWNER_AND_QA", shippedOn }, now), null);
  }
  assert.equal(flagDaysWaiting({ mode: "OWNER_AND_QA", shippedOn: "2026-10-09" }, now), 0);
  assert.equal(flagDaysWaiting({ mode: "OWNER_AND_QA", shippedOn: "2026-10-10" }, now), 0);
  const oldTz = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    assert.equal(flagDaysWaiting({ mode: "OWNER_AND_QA", shippedOn: "2026-03-07" }, new Date(2026, 2, 9)), 2);
  } finally {
    if (oldTz === undefined) delete process.env.TZ;
    else process.env.TZ = oldTz;
  }
});

async function withFilters(query, enabled, run) {
  const dom = new JSDOM('<div id="root"></div>', { url: `http://localhost/admin/flags${query}#flag-test` });
  const names = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = names.map(name => [name, Object.getOwnPropertyDescriptor(global, name)]);
  let reactRoot;
  let api;
  function Harness() {
    api = useFlagsPageFilters(enabled);
    return React.createElement("output", null, JSON.stringify(api.filters));
  }
  try {
    for (const name of names) Object.defineProperty(global, name, { value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : name === "window" ? dom.window : dom.window[name], configurable: true, writable: true });
    reactRoot = require("react-dom/client").createRoot(document.getElementById("root"));
    await React.act(async () => reactRoot.render(React.createElement(Harness)));
    const invoke = async (method, arg) => React.act(async () => api[method](arg));
    const travel = async direction => React.act(async () => {
      const arrived = new Promise(resolve => window.addEventListener("popstate", resolve, { once: true }));
      window.history[direction]();
      await arrived;
    });
    await run({ get: () => api.filters, invoke, travel, window: dom.window });
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  }
}

test("load and back/forward restore URL state; tab, type, risk and sort each push exactly once", async () => {
  await withFilters("?tab=unreleased&type=feature,improvement&risk=none&q=slack&sort=oldest", true, async ({ get, invoke, travel, window }) => {
    const original = get();
    assert.deepEqual(original, parse(window.location.search));
    const initial = window.history.length;
    await invoke("change", { ...get(), audience: "OFF" });
    await invoke("change", { ...get(), kinds: ["bugfix"] });
    await invoke("change", { ...get(), risk: "new" });
    await invoke("change", { ...get(), sort: "desc" });
    assert.equal(window.history.length, initial + 4);
    await travel("back");
    assert.equal(get().sort, "asc");
    await travel("back");
    assert.equal(get().risk, "none");
    await travel("back");
    assert.deepEqual(get().kinds, original.kinds);
    await travel("back");
    assert.deepEqual(get(), original);
    await travel("forward");
    assert.equal(get().audience, "OFF");
    assert.equal(window.location.hash, "#flag-test");
  });
});

for (const finish of ["blur", "debounce"]) {
  test(`search replaces while typing and commits one entry on ${finish}, with original view reachable`, async () => {
    await withFilters("?q=before", true, async ({ get, invoke, travel, window }) => {
      const initial = window.history.length;
      for (const search of ["s", "sl", "sla", "slack"]) {
        await invoke("changeSearch", search);
        assert.equal(window.history.length, initial);
        assert.equal(new URLSearchParams(window.location.search).get("q"), search);
      }
      if (finish === "blur") await invoke("commitSearch");
      else await React.act(async () => new Promise(resolve => setTimeout(resolve, 500)));
      assert.equal(window.history.length, initial + 1);
      await invoke("commitSearch");
      assert.equal(window.history.length, initial + 1, "blur after debounce must not add another entry");
      await travel("back");
      assert.equal(get().search, "before");
      await travel("forward");
      assert.equal(get().search, "slack");
    });
  });
}

test("unchanged search adds no entry and pending search is cancelled on navigation", async () => {
  await withFilters("", true, async ({ get, invoke, travel, window }) => {
    const initial = window.history.length;
    await invoke("changeSearch", "draft");
    await invoke("changeSearch", "");
    await invoke("commitSearch");
    assert.equal(window.history.length, initial);
    await invoke("change", { ...get(), audience: "OFF" });
    await invoke("changeSearch", "draft");
    await travel("back");
    await React.act(async () => new Promise(resolve => setTimeout(resolve, 500)));
    assert.equal(get().search, "");
    assert.equal(get().audience, "ALL");
    assert.equal(window.location.search, "");
  });
});

test("flag off ignores query state and keeps all controls local without history mutations", async () => {
  await withFilters("?tab=off&type=bug&q=slack&sort=oldest", false, async ({ get, invoke, window }) => {
    assert.deepEqual(get(), { ...parse(""), sort: "desc" });
    const original = window.location.href;
    const initial = window.history.length;
    await invoke("change", { ...get(), audience: "UNRELEASED", sort: "asc" });
    await invoke("changeSearch", "local");
    await invoke("commitSearch");
    assert.equal(window.location.href, original);
    assert.equal(window.history.length, initial);
    assert.equal(get().search, "local");
  });
});


test("flagged Unreleased list and count exclude Off; legacy callers stay unchanged", () => {
  const rows = modes.map(mode => fixture(mode, "feature", mode, "2026-10-01"));
  assert.equal(count(rows, true).UNRELEASED, 2);
  assert.deepEqual(cluster(rows, "asc", "UNRELEASED", { unreleasedOnly: true }).flatMap(([, rows]) => rows).map(row => row.mode), ["OWNER_ONLY", "OWNER_AND_QA"]);
  assert.equal(count(rows).UNRELEASED, 3);
  assert.equal(cluster(rows, "desc", "UNRELEASED").flatMap(([, rows]) => rows).length, 3);
  assert.deepEqual(cluster(rows, "asc", "OFF", { unreleasedOnly: true }).flatMap(([, rows]) => rows).map(row => row.mode), ["OFF"]);
});

test("risk filters combine with types and all mode tabs; default risk sort is safe first then oldest", () => {
  const byRisk = value => Object.keys(risks).find(key => risks[key].risk === value);
  const rows = [
    fixture(byRisk("new"), "feature", "OWNER_AND_QA", "2026-09-01"),
    fixture(byRisk("none"), "improvement", "OWNER_ONLY", "2026-10-03"),
    fixture(byRisk("small"), "bugfix", "OFF", "2026-09-02"),
    fixture("no-risk", "feature", "OWNER_ONLY", "2026-08-01"),
  ];
  const secondNone = Object.keys(risks).find(key => risks[key].risk === "none" && key !== byRisk("none"));
  rows.push(fixture(secondNone, "improvement", "OWNER_AND_QA", "2026-09-04"));
  assert.deepEqual(cluster(rows, parse("").sort, "ALL", { shippedOnly: true }).flatMap(([, rows]) => rows).map(row => row.key), [secondNone, byRisk("none"), byRisk("small"), byRisk("new"), "no-risk"]);
  for (const tab of tabs) {
    for (const risk of [null, "none", "small", "new"]) {
      const filters = { ...parse(`tab=${tab}`), risk, kinds: ["feature", "improvement"] };
      const actual = cluster(rows.filter(row => matchesFlagKind(row, filters.kinds) && matchesFlagRisk(row, risk)), "risk", filters.audience, { unreleasedOnly: true }).flatMap(([, rows]) => rows);
      const expected = rows.filter(row => filters.kinds.includes(row.kind) && (!risk || risks[row.key]?.risk === risk) && (tab === "all" || (tab === "unreleased" ? ["OWNER_ONLY", "OWNER_AND_QA"].includes(row.mode) : row.mode === filters.audience)));
      assert.deepEqual(actual.map(row => row.key).sort(), expected.map(row => row.key).sort());
    }
  }
});

test("a control change commits a pending search once before pushing the control", async () => {
  await withFilters("?q=before", true, async ({ get, invoke, travel, window }) => {
    const initial = window.history.length;
    await invoke("changeSearch", "slack");
    await invoke("change", { ...get(), risk: "small" });
    assert.equal(window.history.length, initial + 2);
    await travel("back");
    assert.equal(get().search, "slack");
    assert.equal(get().risk, null);
    await travel("back");
    assert.equal(get().search, "before");
  });
});
