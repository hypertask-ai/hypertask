const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.join(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const {
  clusterByBoard,
  filterAgents,
  listTeams,
  listBoards,
  parseAgentFilters,
  resolveAgentFilters,
  agentFiltersToQuery,
  agentGroupingStorageKey,
  getAgentPreferenceStorage,
  hasAgentContentFilters,
  readRememberedAgentGrouping,
  writeRememberedAgentGrouping,
  statusOf,
  isWorking,
  defaultAgentFilters,
  sortByActivity,
  viewAgents,
} = jiti(path.join(root, "src/lib/agents/registerView.ts"));

const TEAM_A = "team-a";
const TEAM_B = "team-b";

const board = (id, name, teamId, teamName) => ({ id, name, teamId, teamName });

const agent = (id, boards, extra = {}) => ({
  id,
  displayName: id,
  revokedAt: null,
  heartbeatAt: null,
  lastPostedAt: null,
  boards,
  ...extra,
});

const PRODUCT = board(1, "Product", TEAM_A, "Hypertask");
const ANDROID = board(2, "Android", TEAM_A, "Hypertask");
const CLIENT = board(3, "Client work", TEAM_B, "Northwind");

test("an agent on two boards appears under both", () => {
  // Picking one "primary" board would invent a relationship the data does not
  // have, and would hide the agent from the other board's owner.
  const clusters = clusterByBoard([agent("multi", [PRODUCT, ANDROID])]);
  assert.deepEqual(
    clusters.map((c) => c.board.name),
    ["Android", "Product"],
  );
  for (const cluster of clusters) {
    assert.deepEqual(cluster.agents.map((a) => a.id), ["multi"]);
  }
});

test("an agent on no visible board still shows, in its own cluster", () => {
  // Half the live agents have no board the caller can see. Dropping them is
  // how an agent silently vanishes from the register that is supposed to list
  // every agent you own.
  const clusters = clusterByBoard([
    agent("boardless", []),
    agent("onboard", [PRODUCT]),
  ]);
  const last = clusters[clusters.length - 1];
  assert.equal(last.board, null, "board-less agents need a cluster of their own");
  assert.deepEqual(last.agents.map((a) => a.id), ["boardless"]);
  // ...and it comes after the real boards, not before them.
  assert.equal(clusters[0].board.name, "Product");
});

test("a team filter keeps only agents that reach that team", () => {
  const agents = [
    agent("a", [PRODUCT]),
    agent("b", [CLIENT]),
    agent("c", [PRODUCT, CLIENT]),
    agent("boardless", []),
  ];
  const kept = filterAgents(agents, { ...defaultAgentFilters, teamId: TEAM_A });
  assert.deepEqual(kept.map((a) => a.id), ["a", "c"]);
});

test("a team filter also drops the other team's boards from the clusters", () => {
  // The agent is kept because it works in team A, but its team B board must
  // not appear while team A is selected.
  const filters = { ...defaultAgentFilters, teamId: TEAM_A };
  const clusters = clusterByBoard([agent("c", [PRODUCT, CLIENT])], filters);
  assert.deepEqual(clusters.map((c) => c.board.name), ["Product"]);
});

test("active:on hides switched-off agents, active:off shows only them", () => {
  // "Active" follows the card's switch, not the clock: a quiet agent is still
  // switched on, and hiding it would make the toggle contradict the list.
  const on = agent("on", [PRODUCT]);
  const off = agent("off", [PRODUCT], { revokedAt: "2026-08-01T00:00:00.000Z" });
  const quiet = agent("quiet", [PRODUCT]);
  const agents = [on, off, quiet];

  assert.deepEqual(
    filterAgents(agents, { ...defaultAgentFilters, active: "on" }).map((a) => a.id),
    ["on", "quiet"],
  );
  assert.deepEqual(
    filterAgents(agents, { ...defaultAgentFilters, active: "off" }).map((a) => a.id),
    ["off"],
  );
  // The default view hides nothing.
  assert.equal(filterAgents(agents, defaultAgentFilters).length, 3);
});

test("teams and boards are offered from what the caller can actually see", () => {
  const agents = [agent("a", [PRODUCT, CLIENT]), agent("b", [])];
  assert.deepEqual(listTeams(agents), [
    { id: TEAM_A, name: "Hypertask" },
    { id: TEAM_B, name: "Northwind" },
  ]);
  // Narrowing to a team narrows the board list with it, so the two selects
  // cannot combine into an empty page.
  assert.deepEqual(listBoards(agents, TEAM_A), [{ id: 1, name: "Product" }]);
  assert.deepEqual(listBoards(agents, null).map((b) => b.name), [
    "Client work",
    "Product",
  ]);
});

test("filters survive a round trip through the URL", () => {
  // Bookmarkability is the whole point of the page, so a filtered view has to
  // be a link someone else can open.
  const filters = { teamId: TEAM_B, boardId: 3, active: "on", group: "none" };
  const query = agentFiltersToQuery(filters);
  assert.deepEqual(parseAgentFilters(new URLSearchParams(query)), filters);
  // An unfiltered register keeps a clean URL.
  assert.equal(agentFiltersToQuery(defaultAgentFilters), "");
  assert.deepEqual(parseAgentFilters(new URLSearchParams("")), defaultAgentFilters);
  // Junk in the URL falls back rather than rendering an empty page.
  assert.deepEqual(
    parseAgentFilters(new URLSearchParams("board=abc&active=maybe")),
    defaultAgentFilters,
  );
});

test("the last agent sort is remembered per account without overriding a shared link", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  assert.equal(readRememberedAgentGrouping(storage, 6), null);
  assert.equal(writeRememberedAgentGrouping(storage, 6, "none"), true);
  assert.equal(values.get(agentGroupingStorageKey(6)), "none");
  assert.equal(readRememberedAgentGrouping(storage, 6), "none");
  assert.equal(readRememberedAgentGrouping(storage, 7), null);

  assert.equal(resolveAgentFilters(new URLSearchParams(""), "none").group, "none");
  assert.equal(
    resolveAgentFilters(new URLSearchParams("group=none"), "board").group,
    "none",
    "an explicit bookmark must win over this browser's preference",
  );
  const explicitBoard = resolveAgentFilters(
    new URLSearchParams("group=board"),
    "none",
  );
  const updatedQuery = agentFiltersToQuery(
    { ...explicitBoard, active: "on" },
    { preserveDefaultGrouping: true },
  );
  assert.equal(new URLSearchParams(updatedQuery).get("group"), "board");
  assert.equal(
    resolveAgentFilters(new URLSearchParams(updatedQuery), "none").group,
    "board",
    "changing another filter must not make an explicit board link local-state dependent",
  );
  assert.equal(
    hasAgentContentFilters({ ...defaultAgentFilters, group: "none" }),
    false,
    "sorting alone must preserve the unfiltered agent summary",
  );
  assert.equal(
    hasAgentContentFilters({ ...defaultAgentFilters, active: "on" }),
    true,
  );
});

test("agent sort persistence fails closed when browser storage is unavailable or corrupt", () => {
  const unavailable = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  const corrupt = { getItem: () => "newest", setItem: () => {} };
  const blockedBrowser = {};
  Object.defineProperty(blockedBrowser, "localStorage", {
    get: () => {
      throw new Error("SecurityError");
    },
  });

  assert.equal(getAgentPreferenceStorage(blockedBrowser), null);
  assert.equal(readRememberedAgentGrouping(null, 6), null);
  assert.equal(writeRememberedAgentGrouping(null, 6, "none"), false);
  assert.equal(readRememberedAgentGrouping(unavailable, 6), null);
  assert.equal(writeRememberedAgentGrouping(unavailable, 6, "none"), false);
  assert.equal(readRememberedAgentGrouping(corrupt, 6), null);
  assert.equal(resolveAgentFilters(new URLSearchParams(""), null).group, "board");
});

test("a team and a board that contradict each other keep nothing", () => {
  // Reachable by hand-editing the URL. If the two filters are checked against
  // different boards the agent survives, then clustering finds no board that
  // satisfies both and files it under "No board" — an agent with boards
  // showing as board-less.
  const agents = [agent("split", [PRODUCT, CLIENT])];
  const filters = { ...defaultAgentFilters, teamId: TEAM_A, boardId: CLIENT.id };
  assert.deepEqual(filterAgents(agents, filters), []);
  // The honest combination still works.
  assert.equal(
    filterAgents(agents, { ...filters, boardId: PRODUCT.id }).length,
    1,
  );
});

test("the palette's Disabled agents link parses back to the off filter", () => {
  // The parser falls back to "all" for anything it does not recognise, so a
  // stale link in commands.tsx opens an unfiltered register and the command
  // silently does nothing. Only the round trip catches that.
  const fs = require("node:fs");
  const source = fs.readFileSync(path.join(root, "src/components/commands.tsx"), "utf8");
  const link = source.match(/router\.push\("(\/agents\?[^"]+)"\)/)?.[1];
  assert.ok(link, "expected a filtered /agents link for the Disabled agents command");
  const query = link.slice(link.indexOf("?"));
  assert.equal(parseAgentFilters(new URLSearchParams(query)).active, "off");
});

test("status is off when switched off, whatever the heartbeat says", () => {
  const now = Date.parse("2026-08-14T12:00:00.000Z");
  const beat = "2026-08-14T11:59:00.000Z";
  assert.equal(statusOf(agent("x", [], { heartbeatAt: beat }), now), "running");
  assert.equal(
    statusOf(agent("x", [], { heartbeatAt: beat, revokedAt: beat }), now),
    "off",
  );
  assert.equal(
    statusOf(agent("x", [], { heartbeatAt: "2026-08-01T00:00:00.000Z" }), now),
    "quiet",
  );
});

test("archived agents stay out of every view except their own", () => {
  // The whole point of archiving is that the agent stops taking up room in the
  // register. If "All agents" still listed it, archiving would only be a label.
  const live = agent("live", []);
  const filed = agent("filed", [], { archivedAt: "2026-08-14T09:00:00.000Z" });
  const off = agent("off", [], { revokedAt: "2026-08-14T09:00:00.000Z" });
  const agents = [live, filed, off];

  const ids = (active) =>
    filterAgents(agents, { ...defaultAgentFilters, active }).map((a) => a.id);

  assert.deepEqual(ids("all"), ["live", "off"]);
  assert.deepEqual(ids("on"), ["live"]);
  assert.deepEqual(ids("off"), ["off"]);
  assert.deepEqual(ids("archived"), ["filed"]);
});

test("an archived agent that is also switched off appears only under Archived", () => {
  // Archiving a switched-off agent is the common case: it is done with, so it
  // is filed. It must not keep showing under "Switched off" as well.
  const both = agent("both", [], {
    archivedAt: "2026-08-14T09:00:00.000Z",
    revokedAt: "2026-08-14T09:00:00.000Z",
  });
  assert.equal(
    filterAgents([both], { ...defaultAgentFilters, active: "off" }).length,
    0,
  );
  assert.equal(
    filterAgents([both], { ...defaultAgentFilters, active: "archived" }).length,
    1,
  );
});

test("the archived filter survives a round trip through the URL", () => {
  const query = agentFiltersToQuery({
    ...defaultAgentFilters,
    active: "archived",
  });
  assert.equal(
    parseAgentFilters(new URLSearchParams(query.slice(1))).active,
    "archived",
  );
});

test("the spinner stops when the lease expires, not when the fetch is old", () => {
  // A page left open keeps whatever `working` it last fetched. Reading the
  // lease's own expiry is what stops it animating over an agent that finished
  // ten minutes ago.
  const now = Date.parse("2026-08-14T12:00:00.000Z");
  const work = (expiresAt) => ({
    ticket: "HTPR-1",
    title: "Something",
    url: "/detail/project-15/1",
    since: "2026-08-14T11:55:00.000Z",
    expiresAt,
  });
  assert.equal(isWorking(agent("a", [], { working: null }), now), false);
  assert.equal(
    isWorking(agent("a", [], { working: work("2026-08-14T12:04:00.000Z") }), now),
    true,
  );
  assert.equal(
    isWorking(agent("a", [], { working: work("2026-08-14T11:58:00.000Z") }), now),
    false,
  );
});

const NOW = Date.parse("2026-08-17T12:00:00.000Z");
const ago = (mins) => new Date(NOW - mins * 60_000).toISOString();
const lease = (mins) => ({
  ticket: "HTPR-1",
  title: "Something",
  url: "/detail/project-15/1",
  since: ago(1),
  expiresAt: new Date(NOW + mins * 60_000).toISOString(),
});

test("the newest thing an agent did decides where it sits", () => {
  // The register answers "what is happening", so recency leads. A live lease
  // beats every timestamp: it is happening now, not earlier today.
  const idle = agent("idle", [PRODUCT]);
  const yesterday = agent("yesterday", [PRODUCT], { heartbeatAt: ago(1440) });
  const recent = agent("recent", [PRODUCT], { lastPostedAt: ago(5) });
  const working = agent("working", [PRODUCT], {
    heartbeatAt: ago(600),
    working: lease(4),
  });
  assert.deepEqual(
    sortByActivity([idle, yesterday, recent, working], NOW).map((a) => a.id),
    ["working", "recent", "yesterday", "idle"],
  );
});

test("boards are ordered by their most recent agent, not the alphabet", () => {
  // "Product" sorts before "Zebra" alphabetically, but a board nobody has
  // touched in a day should not sit above one an agent is working in.
  const ZEBRA = board(9, "Zebra", TEAM_A, "Hypertask");
  const stale = agent("stale", [PRODUCT], { heartbeatAt: ago(1440) });
  const busy = agent("busy", [ZEBRA], { working: lease(4) });
  const orphan = agent("orphan", [], { working: lease(4) });
  const clusters = viewAgents([stale, busy, orphan], defaultAgentFilters, NOW);
  assert.deepEqual(
    clusters.map((c) => c.board?.name ?? "none"),
    // The board-less catch-all stays last however busy it is.
    ["Zebra", "Product", "none"],
  );
});

test("switching the grouping off gives one flat list, newest first", () => {
  const stale = agent("stale", [PRODUCT], { heartbeatAt: ago(1440) });
  const busy = agent("busy", [ANDROID], { working: lease(4) });
  const middle = agent("middle", [CLIENT], { lastPostedAt: ago(30) });
  const flat = viewAgents(
    [stale, busy, middle],
    { ...defaultAgentFilters, group: "none" },
    NOW,
  );
  assert.equal(flat.length, 1);
  assert.equal(flat[0].board, null);
  assert.deepEqual(flat[0].agents.map((a) => a.id), ["busy", "middle", "stale"]);
});

test("an agent on two boards is still listed under both when grouped", () => {
  // Flattening must not be the only way to see a multi-board agent once, and
  // grouping must not stop being per-board just because it now sorts by time.
  const both = agent("both", [PRODUCT, ANDROID], { lastPostedAt: ago(5) });
  const grouped = viewAgents([both], defaultAgentFilters, NOW);
  assert.equal(grouped.length, 2);
  const flat = viewAgents([both], { ...defaultAgentFilters, group: "none" }, NOW);
  assert.equal(flat[0].agents.length, 1);
});
