const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const flag = "htpr-7577-add-existing-agent";

function controllerHarness({ owner = false, member = true, ownsAgent = true, revoked = false, agentTeamId = "team-a" } = {}) {
  const created = [];
  const agent = { id: "owned-agent", userId: 42, members: [{ project: { teamId: agentTeamId } }] };
  const prisma = {
    project: {
      findFirst: async ({ where }) => {
        assert.deepEqual(where, { id: 15, status: "Normal" });
        return { id: 15, ownerId: owner ? 42 : 99, teamId: "team-a" };
      },
    },
    member: {
      findFirst: async ({ where }) => {
        if (Object.hasOwn(where, "userId")) {
          assert.deepEqual(where, { projectId: 15, userId: 42, agentId: null });
          return member ? { id: 1, userId: 42, agentId: null } : null;
        }
        assert.deepEqual(where, { projectId: 15, agentId: agent.id });
        return null;
      },
      create: async ({ data }) => {
        created.push(data);
        return { id: 2, ...data, agent, user: { id: 42 } };
      },
    },
    agent: {
      findFirst: async ({ where }) => {
        assert.deepEqual(where, { id: agent.id, userId: 42, revokedAt: null });
        return ownsAgent && !revoked ? agent : null;
      },
    },
  };
  const controller = load("src/utils/controllers/agents/boardMembers.ts", {
    "@/lib/prisma": { default: prisma },
    "@/lib/mcp/agents/delegatedAccess": {
      assertAgentBoardInviteScope: () => assert.fail("Human sessions do not need delegated access"),
    },
    "@/lib/agents/publicAgent": { publicAgentSelect: { id: true } },
    "@/lib/agents/visibility": {},
  });
  return {
    created,
    add: () => controller.addAgentToBoard(15, agent.id, 42),
  };
}

test("still allowed: a board owner adds an active agent they own as a plain member", async () => {
  const h = controllerHarness({ owner: true, member: false });
  assert.equal((await h.add()).ok, true);
  assert.deepEqual(h.created, [{ projectId: 15, userId: 42, agentId: "owned-agent" }]);
});

test("still allowed: a plain human board member adds an agent they own", async () => {
  const h = controllerHarness();
  assert.equal((await h.add()).ok, true);
  assert.deepEqual(h.created, [{ projectId: 15, userId: 42, agentId: "owned-agent" }]);
});

test("now refused: a non-member cannot add their agent", async () => {
  const h = controllerHarness({ member: false });
  assert.deepEqual(await h.add(), {
    ok: false, status: 403, message: "You do not have permission to add agents to this board",
  });
  assert.deepEqual(h.created, []);
});

test("now refused: a human member cannot add someone else's agent", async () => {
  const h = controllerHarness({ ownsAgent: false });
  assert.deepEqual(await h.add(), {
    ok: false, status: 403, message: "Agent not found or you do not own this agent",
  });
  assert.deepEqual(h.created, []);
});

test("still refused: a member cannot add their revoked agent", async () => {
  const h = controllerHarness({ revoked: true });
  assert.deepEqual(await h.add(), {
    ok: false, status: 403, message: "Agent not found or you do not own this agent",
  });
  assert.deepEqual(h.created, []);
});

test("still refused: a member cannot add an agent from another team", async () => {
  const h = controllerHarness({ agentTeamId: "team-b" });
  assert.deepEqual(await h.add(), {
    ok: false, status: 403, message: "This agent belongs to another team",
  });
  assert.deepEqual(h.created, []);
});

function routeHarness({ guest = false, session = true } = {}) {
  const calls = [];
  const handler = load("src/pages/api/members/addAgent.ts", {
    "@/lib/auth/getSessionUser": {
      getSessionUser: async () => session ? { userId: 42 } : null,
    },
    "@/lib/demo/guestGuard": {
      isGuestRequest: async () => guest,
      GUEST_FORBIDDEN_MESSAGE: "Guest access is read-only",
    },
    "@/utils/controllers/agents/boardMembers": {
      addAgentToBoard: async (...args) => {
        calls.push(args);
        return { ok: true, member: { id: 2, agent: { id: "owned-agent" } } };
      },
    },
  }).default;
  const request = async (body = { projectId: 15, agentId: "owned-agent" }, method = "POST") => {
    const res = {
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; },
    };
    await handler({ method, headers: {}, body }, res);
    return res;
  };
  return { request, calls };
}

const { isAgentCookieBridgeRequestAllowed } = load("src/lib/auth/agentCookieBridgeRoutes.ts", {});

test("now refused: an agent session acting on its own cannot reach the add-agent route", () => {
  assert.equal(
    isAgentCookieBridgeRequestAllowed({ agentId: "acting-agent" }, "POST", "/api/members/addAgent"),
    false,
  );
});

test("still allowed: a person's session reaches the add-agent route and adds their agent", async () => {
  assert.equal(isAgentCookieBridgeRequestAllowed({}, "POST", "/api/members/addAgent"), true);
  const h = routeHarness();
  const response = await h.request();
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.message, "Success");
  assert.deepEqual(h.calls, [[15, "owned-agent", 42]]);
});

test("still refused: guests cannot add agents", async () => {
  const h = routeHarness({ guest: true });
  const response = await h.request();
  assert.equal(response.statusCode, 403);
  assert.deepEqual(h.calls, []);
});

test("still refused: unauthenticated sessions cannot add agents", async () => {
  const h = routeHarness({ session: false });
  assert.equal((await h.request()).statusCode, 401);
  assert.deepEqual(h.calls, []);
});

const { addExistingAgentGroups } = load("src/lib/agents/addExistingAgentGroups.ts", {});
const board = (id, teamId = "team-a") => ({ id, name: `Board ${id}`, teamId, teamName: teamId });
const agent = (id, overrides = {}) => ({
  id, displayName: id, revokedAt: null, archivedAt: null, boards: [], ...overrides,
});
const group = (agents, keyword = "", boardTeamId = "team-a") =>
  addExistingAgentGroups(agents, 15, boardTeamId, keyword);

test("grouping: active owned agents on another same-team board are addable", () => {
  const sameTeam = agent("Team Bot", { boards: [board(16)] });
  assert.deepEqual(group([sameTeam]), { onThisTeam: [sameTeam], notOnAnyBoard: [], unavailable: [] });
});

test("grouping: active owned agents without boards are addable", () => {
  const unattached = agent("Docs Bot");
  assert.deepEqual(group([unattached]), { onThisTeam: [], notOnAnyBoard: [unattached], unavailable: [] });
});

test("grouping: revoked agents are unavailable with the turn-on reason", () => {
  const off = agent("Off Bot", { revokedAt: "2026-10-22T00:00:00.000Z" });
  assert.deepEqual(group([off]).unavailable, [{ agent: off, reason: "Turn the agent on before adding it" }]);
});

test("grouping: agents belonging to another team are unavailable", () => {
  const other = agent("Other Bot", { boards: [board(17, "team-b")] });
  assert.deepEqual(group([other]).unavailable, [{ agent: other, reason: "Agent belongs to another team" }]);
});

test("grouping: agents whose only boards have no team are unavailable", () => {
  const legacy = agent("Legacy Bot", { boards: [board(17, null)] });
  assert.deepEqual(group([legacy]).unavailable, [{ agent: legacy, reason: "Agent belongs to another team" }]);
});

test("grouping: same-team plus teamless memberships follow the shared team predicate", () => {
  const mixed = agent("Mixed Bot", { boards: [board(16), board(17, null)] });
  assert.deepEqual(group([mixed]).onThisTeam, [mixed]);
});

test("grouping: cross-team mixed memberships cannot slip into the same-team group", () => {
  const mixed = agent("Mixed Bot", { boards: [board(16), board(17, "team-b")] });
  assert.deepEqual(group([mixed]).unavailable, [{ agent: mixed, reason: "Agent belongs to another team" }]);
});

test("grouping: agents already on this board are excluded even when revoked", () => {
  assert.deepEqual(group([
    agent("Member Bot", { boards: [board(15)] }),
    agent("Off Member Bot", { boards: [board(15)], revokedAt: "2026-10-22" }),
  ]), { onThisTeam: [], notOnAnyBoard: [], unavailable: [] });
});

test("grouping: archived agents are excluded from every group", () => {
  assert.deepEqual(group([
    agent("Archived Bot", { archivedAt: "2026-10-22" }),
    agent("Archived Team Bot", { boards: [board(16)], archivedAt: "2026-10-22" }),
    agent("Archived Off Bot", { revokedAt: "2026-10-22", archivedAt: "2026-10-22" }),
  ]), { onThisTeam: [], notOnAnyBoard: [], unavailable: [] });
});

test("grouping: search is case-insensitive across all three groups", () => {
  const agents = [
    agent("Docs Team", { boards: [board(16)] }),
    agent("DOCS Unattached"),
    agent("docs Off", { revokedAt: "2026-10-22" }),
    agent("Unrelated"),
  ];
  const result = group(agents, " dOcS ");
  assert.deepEqual(result.onThisTeam, [agents[0]]);
  assert.deepEqual(result.notOnAnyBoard, [agents[1]]);
  assert.deepEqual(result.unavailable.map(({ agent }) => agent), [agents[2]]);
});

test("grouping: a board without a team cannot offer agents for attachment", () => {
  const unattached = agent("Docs Bot");
  const result = group([unattached], "", null);
  assert.deepEqual(result.onThisTeam, []);
  assert.deepEqual(result.notOnAnyBoard, []);
  assert.deepEqual(result.unavailable, [{ agent: unattached, reason: "Board does not belong to a team" }]);
});

test("flag: access-risk feature is limited to owner and QA by default", () => {
  const definition = load("src/lib/flags/definitions/htpr-7577-add-existing-agent.ts", {}).default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.shippedOn, "2026-10-22");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.equal(definition.releaseRisk.highRisk, "access");
});

async function withPicker({ agents, addError } = {}, run) {
  const path = require("node:path");
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const { JSDOM } = require("jsdom");
  const { createJiti } = require("jiti");
  const root = path.resolve(__dirname, "..");
  const cached = new Map(Object.entries(require.cache));
  const names = ["React", "window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]));
  const calls = [];
  const invalidations = [];
  const successes = [];
  const errors = [];
  const queries = [];
  let closes = 0;
  let reactRoot;
  let dom;
  const stub = (file, exports) => {
    const filename = file.startsWith("src/") ? path.join(root, file) : require.resolve(file);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  };
  try {
    dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/settings/board/agents" });
    dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
    const values = { React, window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
    for (const [name, value] of Object.entries(values)) {
      Object.defineProperty(global, name, { configurable: true, writable: true, value });
    }
    stub("src/lib/state.tsx", { useRecoilValue: () => ({ id: 42 }) });
    stub("src/store/index.ts", { currentUserAtom: {} });
    stub("src/hooks/MultiPages/useAgents.ts", {
      boardAgentsQueryKey: (id) => ["boardAgents", id],
      useAgents: () => ({ addAgentToBoard: {
        isPending: false,
        mutateAsync: async (variables) => {
          calls.push(variables);
          if (addError) throw new Error(addError);
        },
      } }),
    });
    stub("@tanstack/react-query", {
      useQuery: (options) => {
        queries.push(options);
        return { data: agents ?? [], isLoading: false, error: null };
      },
      useQueryClient: () => ({ invalidateQueries: async (options) => invalidations.push(options) }),
    });
    stub("react-hot-toast", { default: { success: (message) => successes.push(message), error: (message) => errors.push(message) } });
    stub("next/link", { default: ({ href, children, className }) => React.createElement("a", { href, className }, children) });
    stub("next/navigation", { useRouter: () => ({ push: () => {} }) });
    stub("src/components/Common/UserAvatar.tsx", { default: () => null });
    stub("src/components/Common/CommonModalComponents/index.tsx", {
      ModalContainerCustom: ({ children }) => React.createElement("div", { "data-modal": true }, children),
      ModalHeaderComp: ({ header }) => React.createElement("h1", null, header),
      ModalInput: (props) => React.createElement("input", props),
      ModalListContainer: ({ children, id }) => React.createElement("ul", { id }, children),
      ModalRowElementContainer: ({ children, id, isSelected, onClick, onMouseEnter, ...props }) => React.createElement("li", {
        id, onClick, onMouseEnter, "data-selected": isSelected, "aria-disabled": props["aria-disabled"],
      }, children),
      HintKey: ({ children }) => React.createElement("kbd", null, children),
    });
    const filename = path.join(root, "src/components/Modals/Settings/AddExistingAgentPicker.tsx");
    delete require.cache[filename];
    const jiti = createJiti(__filename, { interopDefault: true, jsx: true, fsCache: false, alias: { "@": path.join(root, "src") } });
    const Picker = jiti(filename).default;
    const container = document.getElementById("root");
    reactRoot = createRoot(container);
    await React.act(async () => {
      reactRoot.render(React.createElement(Picker, {
        projectId: 15, boardName: "Sandbox", boardTeamId: "team-a", onClose: () => { closes += 1; },
      }));
    });
    const key = async (keyCode) => {
      const target = container.querySelector("input") ?? container.querySelector("li");
      await React.act(async () => target.dispatchEvent(new window.KeyboardEvent("keydown", { keyCode, bubbles: true })));
    };
    const click = async (target) => {
      assert.ok(target);
      await React.act(async () => target.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    };
    await run({ container, calls, invalidations, successes, errors, queries, key, click, closes: () => closes });
  } finally {
    try {
      if (reactRoot) await React.act(async () => reactRoot.unmount());
    } finally {
      dom?.window.close();
      for (const filename of Object.keys(require.cache)) {
        if (!cached.has(filename)) delete require.cache[filename];
      }
      for (const [filename, value] of cached) require.cache[filename] = value;
      for (const [name, descriptor] of previous) {
        if (descriptor === undefined) delete global[name];
        else Object.defineProperty(global, name, descriptor);
      }
    }
  }
}

test("picker: arrow keys wrap over enabled agents only and Enter opens confirmation", async () => {
  await withPicker({ agents: [
    agent("Team Bot", { boards: [board(16)] }), agent("Docs Bot"),
    agent("Off Bot", { revokedAt: "2026-10-22" }),
  ] }, async ({ container, key, calls }) => {
    assert.equal(container.querySelector('[data-selected="true"]').textContent, "Team Bot");
    await key(40);
    assert.equal(container.querySelector('[data-selected="true"]').textContent, "Docs Bot");
    await key(40);
    assert.equal(container.querySelector('[data-selected="true"]').textContent, "Team Bot");
    await key(38);
    assert.equal(container.querySelector('[data-selected="true"]').textContent, "Docs Bot");
    assert.equal(container.querySelector('[aria-disabled="true"] a').getAttribute("href"), "/agents/Off Bot");
    await key(13);
    assert.equal(container.querySelector("h1").textContent, "Add Docs Bot to Sandbox?");
    assert.match(container.querySelector('[data-selected="true"]').textContent, /^Add/);
    assert.deepEqual(calls, []);
  });
});

test("picker: confirmed Add calls the existing mutation, refreshes the board, toasts and closes", async () => {
  await withPicker({ agents: [agent("Docs Bot")] }, async ({ key, calls, invalidations, successes, closes, queries }) => {
    assert.deepEqual(queries[0].queryKey, ["htpr-7577-owned-agents", 42]);
    await key(13);
    await key(13);
    assert.deepEqual(calls, [{ projectId: 15, agentId: "Docs Bot" }]);
    assert.deepEqual(invalidations, [{ queryKey: ["boardAgents", 15] }]);
    assert.deepEqual(successes, ["Docs Bot added to Sandbox"]);
    assert.equal(closes(), 1);
  });
});

test("picker: a server error is shown and confirmation stays open", async () => {
  await withPicker({ agents: [agent("Docs Bot")], addError: "Agent not found or you do not own this agent" }, async ({ container, key, errors, invalidations, closes }) => {
    await key(13);
    await key(13);
    assert.deepEqual(errors, ["Agent not found or you do not own this agent"]);
    assert.equal(container.querySelector("h1").textContent, "Add Docs Bot to Sandbox?");
    assert.equal(closes(), 0);
    assert.deepEqual(invalidations, []);
  });
});

test("picker: Escape closes confirmation without adding an agent", async () => {
  await withPicker({ agents: [agent("Docs Bot")] }, async ({ key, closes, calls }) => {
    await key(13);
    await key(27);
    assert.equal(closes(), 1);
    assert.deepEqual(calls, []);
  });
});

test("picker: Cancel closes without adding an agent", async () => {
  await withPicker({ agents: [agent("Docs Bot")] }, async ({ container, key, click, closes, calls }) => {
    await key(13);
    await click(container.querySelector("#add-existing-agent-1"));
    assert.equal(closes(), 1);
    assert.deepEqual(calls, []);
  });
});

test("picker: with no matching agents only the muted empty line is shown", async () => {
  await withPicker({ agents: [] }, async ({ container }) => {
    assert.equal(container.querySelector("p").textContent, "No agents you own can be added to this board");
    assert.equal(container.querySelector("ul"), null);
    assert.equal(container.querySelector("a"), null);
  });
});

test("picker: when only unavailable agents match, their reason and View agent link stay visible", async () => {
  await withPicker({ agents: [agent("Off Bot", { revokedAt: "2026-10-22" })] }, async ({ container }) => {
    assert.match(container.textContent, /UNAVAILABLE/);
    assert.match(container.textContent, /Turn the agent on before adding it/);
    assert.equal(container.querySelector('[aria-disabled="true"] a').getAttribute("href"), "/agents/Off Bot");
    assert.doesNotMatch(container.textContent, /No agents you own can be added to this board/);
  });
});
