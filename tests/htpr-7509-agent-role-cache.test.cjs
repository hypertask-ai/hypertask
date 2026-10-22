const assert = require("node:assert/strict");
const test = require("node:test");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const flag = "htpr-7509-agent-role-screen";

test("the mounted agents hook fetches role-bearing rows when the flag changes from Off to On", async () => {
  const view = mount();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
  const previousFetch = global.fetch;
  const state = { enabled: false, calls: [], mounts: 0, current: null };
  const currentUserAtom = {};
  const currentProjectAtom = {};
  const offRows = [
    { id: "reader", displayName: "Reader" },
    { id: "admin", displayName: "Administrator" },
  ];
  const onRows = offRows.map((agent, index) => ({ ...agent, role: index ? "admin" : "read" }));
  let respond;
  const pendingResponse = new Promise(resolve => { respond = resolve; });
  global.fetch = async url => {
    assert.equal(url, "/api/agents?teamId=team");
    state.calls.push(state.enabled);
    if (state.enabled) return pendingResponse;
    return { ok: true, json: async () => ({ success: true, agents: offRows }) };
  };
  const load = loader({
    "@/hooks/useFlag": { useFlag: key => { assert.equal(key, flag); return state.enabled; } },
    "@/lib/flags/keys": { HTPR_7509_AGENT_ROLE_SCREEN_FLAG: flag },
    "@/store": { currentUserAtom, currentProjectAtom },
    "@/lib/state": { useRecoilValue: atom => atom === currentUserAtom ? { id: 6 } : null },
  });
  const { useAgents, agentsQueryKey } = load("src/hooks/MultiPages/useAgents.ts");
  function Probe() {
    state.current = useAgents({ projectId: null, teamId: "team" });
    React.useEffect(() => { state.mounts++; }, []);
    return React.createElement("output", null, JSON.stringify(state.current.agents));
  }
  const render = () => view.render(React.createElement(QueryClientProvider, { client }, React.createElement(Probe)));
  const flush = () => React.act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  try {
    render();
    await flush();
    assert.deepEqual(state.calls, [false]);
    assert.deepEqual(state.current.agents, offRows);
    assert.deepEqual(client.getQueryData(agentsQueryKey(6, "team", false)), offRows);

    state.enabled = true;
    render();
    await flush();
    assert.deepEqual(state.calls, [false, true], "flag activation must start a separate query despite a fresh Off cache");
    assert.equal(state.mounts, 1, "the existing screen must not need a remount");
    assert.equal(state.current.isFetching, true);
    assert.deepEqual(state.current.agents, [], "Off rows must not masquerade as role-bearing On rows while loading");

    await React.act(async () => {
      respond({ ok: true, json: async () => ({ success: true, agents: onRows }) });
    });
    await flush();
    assert.deepEqual(state.current.agents.map(agent => agent.role), ["read", "admin"]);
    assert.deepEqual(client.getQueryData(agentsQueryKey(6, "team", true)), onRows);
    assert.deepEqual(client.getQueryData(agentsQueryKey(6, "team", false)), offRows);
    assert.equal(state.current.isFetching, false);
  } finally {
    respond({ ok: true, json: async () => ({ success: true, agents: onRows }) });
    view.close();
    client.clear();
    global.fetch = previousFetch;
  }
});
