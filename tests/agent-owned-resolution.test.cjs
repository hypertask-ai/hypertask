// HTPR-5381. Agent routes resolve /agents/<ref> before they read or write the
// agent, so that resolution is the ownership boundary: a foreign id or slug
// must not resolve for a caller who does not own it.
//
// Behavioural, not source-text — the query filter is the whole guard, and a
// dropped `userId` in the where clause is exactly what this catches.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const owner = 6;
const stranger = 7;

const agents = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    userId: owner,
    displayName: "Board Maintainer",
    createdAt: new Date("2026-01-01T00:00:00Z"),
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    userId: owner,
    displayName: "Board Maintainer",
    createdAt: new Date("2026-02-01T00:00:00Z"),
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    userId: stranger,
    displayName: "Cost Engineer",
    createdAt: new Date("2026-01-15T00:00:00Z"),
  },
];

const queries = [];

stubModule("src/lib/prisma.ts", {
  default: {
    agent: {
      findMany: async ({ where }) => {
        queries.push(where);
        return agents
          .filter((agent) => agent.userId === where.userId)
          .map(({ id, displayName, createdAt }) => ({
            id,
            displayName,
            createdAt,
          }));
      },
    },
  },
});

const jiti = require("jiti")(path.join(root, "tests/agent-owned-resolution.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  cache: false,
});

const {
  ownedAgentNames,
  ownedAgentSlugs,
  ownedSlugsAfterRename,
  resolveOwnedAgent,
  resolveOwnedAgentFrom,
} = jiti(
  path.join(root, "src/lib/agents/ownedSlugs.ts")
);

test("an owner resolves their own agent by id and by slug", async () => {
  assert.deepEqual(await resolveOwnedAgent(owner, agents[0].id), {
    id: agents[0].id,
    slug: "board-maintainer",
  });
  assert.deepEqual(await resolveOwnedAgent(owner, "board-maintainer"), {
    id: agents[0].id,
    slug: "board-maintainer",
  });
});

test("a same-name agent keeps its own URL instead of stealing the older one", async () => {
  assert.deepEqual(await resolveOwnedAgent(owner, agents[1].id), {
    id: agents[1].id,
    slug: "board-maintainer-2",
  });
  assert.deepEqual(await resolveOwnedAgent(owner, "board-maintainer-2"), {
    id: agents[1].id,
    slug: "board-maintainer-2",
  });
});

test("another account's agent id does not resolve", async () => {
  assert.equal(await resolveOwnedAgent(owner, agents[2].id), null);
});

test("another account's agent slug does not resolve", async () => {
  assert.equal(await resolveOwnedAgent(owner, "cost-engineer"), null);
});

test("resolution is always scoped to the calling owner", async () => {
  queries.length = 0;
  await resolveOwnedAgent(owner, agents[0].id);
  await ownedAgentSlugs(owner);

  assert.ok(queries.length > 0);
  for (const where of queries) assert.deepEqual(where, { userId: owner });
});

test("an unknown or empty reference resolves to nothing", async () => {
  for (const ref of ["", "   ", "no-such-agent", "not-a-uuid-or-slug"]) {
    assert.equal(
      await resolveOwnedAgent(owner, ref),
      null,
      `${JSON.stringify(ref)} must not resolve`
    );
  }
});

test("slugs are listed only for the owner's own agents", async () => {
  const slugs = await ownedAgentSlugs(owner);

  assert.deepEqual(
    [...slugs.entries()],
    [
      [agents[0].id, "board-maintainer"],
      [agents[1].id, "board-maintainer-2"],
    ]
  );
  assert.equal(slugs.has(agents[2].id), false);
});

// HTPR-6509: PATCH loads the owned list once and reuses it for the resolve and
// for the slug it returns after a rename. Both must match what a fresh query
// would have produced, or the page redirects to the wrong URL.
test("resolving from a loaded list matches resolving by query", async () => {
  const owned = await ownedAgentNames(owner);
  for (const ref of [
    agents[0].id,
    agents[1].id,
    agents[2].id,
    "board-maintainer",
    "board-maintainer-2",
    "cost-engineer",
    "",
    "no-such-agent",
  ]) {
    assert.deepEqual(
      resolveOwnedAgentFrom(owned, ref),
      await resolveOwnedAgent(owner, ref),
      `${JSON.stringify(ref)} must resolve the same way`
    );
  }
});

test("slugs after a rename match a reload of the renamed list", async () => {
  const owned = await ownedAgentNames(owner);
  const renamedId = agents[0].id;
  const original = agents[0].displayName;
  const newName = "QA Agent";
  // The rename frees "board-maintainer" for the younger agent only when the
  // renamed row is patched; a stale list would keep the old slugs.
  const slugs = ownedSlugsAfterRename(owned, renamedId, newName);

  agents[0].displayName = newName;
  try {
    assert.deepEqual([...slugs.entries()], [...(await ownedAgentSlugs(owner)).entries()]);
    assert.equal(slugs.get(renamedId), "qa-agent");
    assert.equal(slugs.get(agents[1].id), "board-maintainer");
  } finally {
    agents[0].displayName = original;
  }
});

test("a rename into a taken name gets the next free slug", async () => {
  const owned = await ownedAgentNames(owner);
  // The younger agent takes the older one's name: it must not steal the URL.
  const slugs = ownedSlugsAfterRename(owned, agents[1].id, "Board Maintainer");
  assert.equal(slugs.get(agents[0].id), "board-maintainer");
  assert.equal(slugs.get(agents[1].id), "board-maintainer-2");

  const renamed = ownedSlugsAfterRename(owned, agents[1].id, "Cost Engineer");
  assert.equal(renamed.get(agents[1].id), "cost-engineer");
});

test("agent PATCH queries the owned list once", () => {
  const route = require("node:fs").readFileSync(
    path.join(root, "src/app/api/agents/[agentId]/route.ts"),
    "utf8"
  );
  const patch = route.slice(
    route.indexOf("export async function PATCH"),
    route.indexOf("export async function DELETE")
  );
  assert.equal(patch.match(/ownedAgentNames\(/g)?.length, 1);
  assert.doesNotMatch(patch, /ownedAgentSlugs\(|resolveAgent\(|resolveOwnedAgent\(/);
  assert.match(patch, /ownedSlugsAfterRename\(owned, agent\.id, agent\.displayName\)/);
});
