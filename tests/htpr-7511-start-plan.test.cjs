const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { JSDOM } = require("jsdom");
const { load, root } = require("./helpers/agent-connection.cjs");
process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID_PRO = "price_pro_month";
const jiti = require("jiti")(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const billing = jiti(path.join(root, "src/lib/deriveCurrentBoardBilling.ts"));
const flag = load("src/lib/flags/definitions/htpr-7511-signup-straight-to-board.ts");
const key = flag.HTPR_7511_SIGNUP_STRAIGHT_TO_BOARD_FLAG;
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const freeBoard = () => ({ id: 7, teamId: "team-owned", team: {
  id: "team-owned", stripe_customer_id: "cus_owned", subscriptionPlan: [],
  googleAccount: { userId: 6 }, team_activity: { hasCompletedTrial: false },
} });

async function withButton(fn) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://app.hypertask.ai/project?id=7&view=default#board" });
  const previous = { React: global.React, window: global.window, document: global.document, IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(global, { React, window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = require("react-dom/client");
  const container = dom.window.document.getElementById("root");
  const reactRoot = createRoot(container);
  const state = { userId: 6, enabled: true, flagReady: true, board: freeBoard(), data: undefined, fetching: false, isError: false, error: null };
  const requests = [], pushes = [], invalidations = [];
  let query, refreshes = 0, refetches = 0;
  const axios = {
    post: async (url, body) => {
      requests.push({ url, body });
      if (body.action === "preview") return { data: { canStartPlan: true, trialDays: 7 } };
      if (state.checkout) return state.checkout();
      return { data: { url: "https://checkout.stripe.test/session" } };
    },
    isAxiosError: (error) => Boolean(error?.isAxiosError),
  };
  const router = { push: (url) => pushes.push(url), refresh: () => { refreshes++; } };
  const flagMock = { useFlag: (name) => { assert.equal(name, key); return state.enabled; }, useFlagReady: () => state.flagReady };
  const buttonModule = load("src/components/PageComponents/Kanban/HeaderComponents/StartPlanButton.tsx", {
    axios, "next/navigation": { useRouter: () => router },
    "@tanstack/react-query": {
      useQuery: (options) => { query = options; return { data: state.data, isFetching: state.fetching,
        isError: state.isError, error: state.error, refetch: async () => { refetches++; } }; },
      useQueryClient: () => ({ invalidateQueries: async (options) => { invalidations.push(options.queryKey); } }),
    },
    "@/lib/state": { useRecoilValue: (atom) => atom === "user" ? { id: state.userId } : state.board }, "@/store": { currentProjectAtom: "project", currentUserAtom: "user" },
    "@/hooks/useFlag": flagMock,
    "@/lib/flags/definitions/htpr-7511-signup-straight-to-board": flag,
    "@/lib/deriveCurrentBoardBilling": billing,
  });
  const legacy = load("src/components/Modals/TrialPlan/TrialPlanComponents.tsx", {
    "@/components/Common/IconsGlobal": { IconsGlobal: { Check: () => null } },
    "@/lib/serverActions": { getTeamById: async () => ({ ...state.board.team, totalSeats: 3, googleAccountId: "account" }) },
    "@/lib/subscriptionPlans": { storeSubscriptionPlans: [{ perks: [] }, { perks: [] }] },
    "@/components/PageComponents/Kanban/HeaderComponents/StartPlanButton": buttonModule,
    "@/hooks/useFlag": flagMock,
    "@/lib/flags/definitions/htpr-7511-signup-straight-to-board": flag,
    "next/navigation": { useRouter: () => router },
  });
  const TrialCard = load("src/components/PageComponents/Trial/TrialCard.tsx", {
    "@/components/PageComponents/Kanban/HeaderComponents/StartPlanButton": buttonModule,
    "@/hooks/useFlag": flagMock,
    "@/lib/flags/definitions/htpr-7511-signup-straight-to-board": flag,
    "@/hooks/General/useTrial": () => ({ selectedTime: 0, createCheckout() {}, handleDurationChange() {} }),
    "@/assets/AILogo.png": { src: "fixture.png" }, "next/image": () => null,
  }).default;
  const renderCard = async () => React.act(async () => reactRoot.render(React.createElement(TrialCard, {
    teamInfo: { teamId: "team-owned" }, manageLink: "/manage", plan: { id: "BYOK", name: "BYOK", types: [{ price: "$10", description: "per user/month" }] },
    hasSubscription: { activeStorePlan: "Free" },
  })));
  const render = async (props = {}) => React.act(async () => reactRoot.render(React.createElement(buttonModule.StartPlanButton, { project: state.board, compact: true, ...props })));
  const renderLegacy = async (component) => React.act(async () => reactRoot.render(React.createElement(legacy[component], { teamId: "team-owned" })));
  const click = async () => React.act(async () => container.querySelector("button").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  try {
    await fn({ dom, container, state, render, renderLegacy, renderCard, click, requests, pushes, invalidations,
      getQuery: () => query, refreshes: () => refreshes, refetches: () => refetches, requestCheckout: buttonModule.requestCheckout });
  } finally {
    await React.act(async () => reactRoot.unmount());
    Object.assign(global, previous); dom.window.close();
  }
}

test("no button or trial-copy flash while unknown/loading or flag OFF; Free owner is still allowed after server capability resolves", async () => {
  await withButton(async ({ state, render, container, getQuery }) => {
    await render(); assert.equal(container.querySelector("button"), null);
    assert.doesNotMatch(container.textContent, /7|14|\$20/);
    state.data = { canStartPlan: true, trialDays: 7 }; state.enabled = false;
    await render(); assert.equal(container.querySelector("button"), null); assert.equal(getQuery().enabled, false);
    state.enabled = true; state.board = { id: 7, teamId: "team-owned" };
    await render(); assert.equal(container.querySelector("button"), null); assert.equal(getQuery().enabled, false);
    state.board = freeBoard(); await render();
    assert.equal(container.querySelector("button").textContent, "Start a Hypertask plan");
    assert.match(container.textContent, /\$20 per user\/month after 7 days/);
  });
});

test("paid/comped/internal-comp boards are refused even with stale allowed capability; Free owner is still allowed", async () => {
  await withButton(async ({ state, render, container, getQuery }) => {
    state.data = { canStartPlan: true, trialDays: 7 };
    for (const extra of [
      { compedUntil: "2099-01-01", compedPlan: "Pro" },
      { compedUntil: "2099-01-01", compedPlan: "BYOK" },
      { id: "08f79efd-770e-4e32-9728-65e6d29ec893" },
      { subscriptionPlan: [{ subscriptionId: "sub_paid", subscriptionStatus: "active", priceId: "price_pro_month" }], activeSubscriptionPlanId: "sub_paid" },
    ]) {
      state.board = freeBoard(); Object.assign(state.board.team, extra);
      await render(); assert.equal(container.querySelector("button"), null); assert.equal(getQuery().enabled, false);
    }
    state.board = freeBoard(); await render(); assert.ok(container.querySelector("button"));
  });
});

test("flagged Free member gets only owner guidance, including legacy entry; owner remains allowed", async () => {
  await withButton(async ({ state, render, renderLegacy, container }) => {
    state.board.team.googleAccount.userId = 99;
    state.isError = true; state.error = { isAxiosError: true, response: { data: { message: "Only the team owner can update billing" } } };
    await render();
    assert.equal(container.querySelector("button"), null);
    assert.equal(container.textContent, "Only the team owner can start a plan");
    await renderLegacy("TrialsButton");
    assert.equal(container.querySelector("button"), null);
    assert.equal(container.textContent, "Only the team owner can start a plan");
    state.isError = false; state.board.team.googleAccount.userId = 6;
    state.data = { canStartPlan: true, trialDays: 7 }; await render();
    assert.ok(container.querySelector("button"));
  });
});

test("eligibility preview uses the existing endpoint and exact current board; Google and email owners share the same action", async () => {
  await withButton(async ({ state, render, getQuery, requests, container }) => {
    for (const provider of ["google.com", "password"]) {
      state.board.owner = { id: 6, provider };
      state.data = { canStartPlan: true, trialDays: 7 }; await render();
      const result = await getQuery().queryFn();
      assert.equal(result.trialDays, 7);
      assert.deepEqual(requests.at(-1), { url: "/api/stripe/session/checkout", body: {
        intent: "signup-straight-to-board", action: "preview", teamId: "team-owned",
        boardUrl: "https://app.hypertask.ai/project?id=7&view=default#board",
      } });
      assert.ok(container.querySelector("button"));
    }
  });
});

test("past-trial capability offers monthly checkout without a free-trial claim", async () => {
  await withButton(async ({ state, render, container }) => {
    state.data = { canStartPlan: true, trialDays: 0 }; await render();
    assert.match(container.textContent, /\$20 per user\/month/);
    assert.doesNotMatch(container.textContent, /7 days|free|14/);
    assert.ok(container.querySelector("button"));
  });
});

test("click makes one direct checkout POST, suppresses double clicks and disables while awaiting Stripe", async () => {
  await withButton(async ({ state, render, container, dom, requests, pushes }) => {
    let release;
    state.checkout = () => new Promise((resolve) => { release = resolve; });
    state.data = { canStartPlan: true, trialDays: 7 }; await render();
    await React.act(async () => {
      const button = container.querySelector("button");
      button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(requests.length, 1); assert.equal(container.querySelector("button").disabled, true);
    assert.deepEqual(requests[0], { url: "/api/stripe/session/checkout", body: {
      intent: "signup-straight-to-board", teamId: "team-owned", boardUrl: dom.window.location.href,
    } });
    assert.deepEqual(pushes, []);
    await React.act(async () => release({ data: { url: "https://checkout.stripe.test/direct" } }));
    assert.deepEqual(pushes, ["https://checkout.stripe.test/direct"]);
    assert.doesNotMatch(container.textContent, /trial modal|plan is active/i);
  });
});

test("missing URL and network errors stay on board and offer retry, rather than navigating to undefined", async () => {
  await withButton(async ({ state, render, click, container, pushes, refetches }) => {
    state.data = { canStartPlan: true, trialDays: 7 }; state.checkout = async () => ({ data: {} });
    await render(); await click();
    assert.match(container.querySelector("[role=alert]").textContent, /try again/i);
    assert.equal(container.querySelector("button").disabled, false);
    assert.deepEqual(pushes, []); assert.equal(refetches(), 1);
    state.checkout = async () => { throw new Error("Temporary network failure. Please try again."); };
    await click(); assert.match(container.querySelector("[role=alert]").textContent, /network/);
    state.checkout = null; await click(); assert.deepEqual(pushes, ["https://checkout.stripe.test/session"]);
  });
});

test("completed checkout shows finishing state and refreshes authoritative board data; cancellation grants nothing", async () => {
  await withButton(async ({ state, render, container, invalidations, refreshes, getQuery }) => {
    state.data = { canStartPlan: false, finishing: true }; await render();
    assert.equal(container.querySelector("button"), null);
    assert.match(container.textContent, /Finishing plan setup/);
    assert.ok(invalidations.some((key) => key[0] === "projectsAll"));
    assert.ok(refreshes() > 0);
    assert.equal(getQuery().refetchInterval({ state: { data: state.data } }), 2000);
    state.data = { canStartPlan: true, trialDays: 7 }; await render();
    assert.ok(container.querySelector("button"));
    assert.equal(billing.deriveCurrentBoardBilling(state.board).storePlanId, "Free");
    assert.equal(getQuery().refetchInterval({ state: { data: state.data } }), false);
  });
});

test("legacy labels wait for flags, flagged legacy buttons reuse StartPlanButton, and OFF retains fourteen-day copy", async () => {
  await withButton(async ({ state, renderLegacy, container }) => {
    state.flagReady = false; state.enabled = false;
    await renderLegacy("PlansTable"); assert.doesNotMatch(container.textContent, /14 days/);
    state.flagReady = true; await renderLegacy("PlansTable"); assert.match(container.textContent, /free for 14 days/);
    state.enabled = true; await renderLegacy("PlansTable"); assert.doesNotMatch(container.textContent, /14/);
    state.data = { canStartPlan: true, trialDays: 7 };
    await renderLegacy("TrialsButton"); assert.match(container.textContent, /after 7 days/);
    state.enabled = false; await renderLegacy("TrialsButton"); assert.match(container.textContent, /Start 14 Day Pro Trial/);
  });
});

test("header mounts action beside title under the ticket flag; alternate trial entry uses the same owner capability", () => {
  const header = read("src/components/PageComponents/Kanban/HeaderComponents/header.tsx");
  assert.match(header, /TitleKanbanHeader project=\{project\}[\s\S]*?startPlanEnabled && <StartPlanButton project=\{currentProject\} compact/);
  assert.match(header, /useFlag\(HTPR_7511_SIGNUP_STRAIGHT_TO_BOARD_FLAG\)/);
  const alternate = read("src/components/Modals/TrialPlan/TrialModalV2.tsx");
  assert.match(alternate, /if \(!flagReady\) return null/);
  assert.match(alternate, /if \(startPlanEnabled\) return team\?\.id \? <StartPlanButton teamId=\{team\.id\}/);
  const settings = read("src/components/Modals/Settings/PlansSection.tsx");
  assert.match(settings, /useFlag\(HTPR_7511_SIGNUP_STRAIGHT_TO_BOARD_FLAG\)/);
  assert.match(settings, /plan.id === "Free"[\s\S]*?!planFlagReady \? "Checking plan access…" : startPlanEnabled \? "Free plan" : selectedType.description/);
  assert.doesNotMatch(read("src/components/PageComponents/Kanban/HeaderComponents/StartPlanButton.tsx"), /trialStatus|hasSubscription/);
});


test("the standalone legacy trial card also refuses flagged members and still allows the eligible owner", async () => {
  await withButton(async ({ state, renderCard, container }) => {
    state.board.team.googleAccount.userId = 99;
    state.data = { canStartPlan: true, trialDays: 7 };
    await renderCard();
    assert.equal(container.querySelector("button"), null);
    assert.match(container.textContent, /Only the team owner/);
    state.board.team.googleAccount.userId = 6;
    await renderCard();
    assert.equal(container.querySelector("button").textContent, "Start a Hypertask plan");
    state.enabled = false;
    await renderCard(); assert.match(container.textContent, /Begin Hypertask Trial/);
  });
});
