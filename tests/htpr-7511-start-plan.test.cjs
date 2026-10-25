const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { JSDOM } = require("jsdom");
const { load, root } = require("./helpers/agent-connection.cjs");
const { harness, plans } = require("./helpers/start-plan-checkout.cjs");
const jiti = require("jiti")(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const billing = jiti(path.join(root, "src/lib/deriveCurrentBoardBilling.ts"));
const flag = load("src/lib/flags/definitions/htpr-7551-start-plan-checkout.ts");
const key = flag.HTPR_7551_START_PLAN_CHECKOUT_FLAG;
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const freeBoard = () => ({ id: 7, teamId: "team-owned", team: {
  id: "team-owned", stripe_customer_id: "cus_owned", subscriptionPlan: [],
  googleAccount: { userId: 6 }, team_activity: { hasCompletedTrial: false },
} });

async function withButton(fn, backend) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://app.hypertask.ai/project?id=7&view=default#board" });
  const previous = { React: global.React, window: global.window, document: global.document, IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT, fetch: global.fetch };
  Object.assign(global, { React, window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = require("react-dom/client");
  const container = dom.window.document.getElementById("root");
  const reactRoot = createRoot(container);
  const state = { boards: [freeBoard()], userId: 6, enabled: true, flagReady: true, board: freeBoard(), data: undefined, fetching: false, isError: false, error: null };
  const requests = [], pushes = [], invalidations = [];
  let query, refreshes = 0, refetches = 0;
  const axios = {
    post: async (url, body) => {
      requests.push({ url, body });
      if (backend) {
        const result = await backend.checkout(body, state.userId);
        if (result.status !== 200) throw { isAxiosError: true, response: { status: result.status, data: result.body } };
        return { data: result.body };
      }
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
    "@/lib/state": { useRecoilValue: (atom) => atom === "user" ? (state.userId ? { id: state.userId } : null) : state.board }, "@/store": { currentProjectAtom: "project", currentUserAtom: "user" },
    "@/hooks/useFlag": flagMock,
    "@/lib/flags/keys": flag,
    "@/hooks/MultiPages/useGetAllAccessibleBoardList": { useGetAllAccessibleBoardList: (user, options) => {
      state.boardsQuery = { user, options };
      const isPending = state.boards === undefined;
      return { data: state.boards, isError: Boolean(state.boardsError), isPending, refetch: async () => { state.boardRefetches = (state.boardRefetches ?? 0) + 1; },
        isLoading: isPending && options.enabled && Boolean(user?.id) };
    } },
    "@/lib/deriveCurrentBoardBilling": billing,
  });
  const legacy = load("src/components/Modals/TrialPlan/TrialPlanComponents.tsx", {
    "@/components/Common/IconsGlobal": { IconsGlobal: { Check: () => null } },
    "@/lib/serverActions": { getTeamById: async () => ({ ...state.board.team, totalSeats: 3, googleAccountId: "account" }) },
    "@/lib/subscriptionPlans": { storeSubscriptionPlans: [{ perks: [] }, { perks: [] }] },
    "@/components/PageComponents/Kanban/HeaderComponents/StartPlanButton": buttonModule,
    "@/hooks/useFlag": flagMock,
    "@/lib/flags/keys": flag,
    "next/navigation": { useRouter: () => router },
  });
  const trialHook = load("src/hooks/General/useTrial.ts", {
    axios, "next/navigation": { useRouter: () => router },
    "@/lib/constants/APIRouteConstants": { CHECKOUT_SESSION_API_ENDPOINT: "/api/stripe/session/checkout" },
    "@/lib/constants/constants": { createCheckoutParam: (teamInfo, plan, selectedTime, mode, returnUrl, cancelUrl) => ({
      teamId: teamInfo.teamId, stripe_customer_id: teamInfo.stripe_customer_id, googleAccountId: teamInfo.googleAccountId,
      quantity: teamInfo.totalSeats, priceId: plan.types[selectedTime].stripePriceId, mode, returnUrl, cancelUrl,
    }) },
    "@/lib/state": { useRecoilState: (atom) => [atom === "user" ? (state.userId ? { id: state.userId } : null) : state.board, () => {}] },
    "@/store": { currentProjectAtom: "project", currentUserAtom: "user" },
    "@/utils/helperFunctions/helperFunctions": { constructTrialPageURL: () => "https://app.hypertask.ai/trial-plan-confirmation" },
  }).default;
  global.fetch = async () => ({ ok: true, json: async () => [freeBoard()] });
  const TrialCard = load("src/components/PageComponents/Trial/TrialCard.tsx", {
    "@/components/PageComponents/Kanban/HeaderComponents/StartPlanButton": buttonModule,
    "@/hooks/useFlag": flagMock,
    "@/lib/flags/keys": flag,
    "@/hooks/General/useTrial": trialHook,
    "@/lib/state": { useRecoilValue: (atom) => atom === "user" ? (state.userId ? { id: state.userId } : null) : state.board },
    "@/store": { currentProjectAtom: "project", currentUserAtom: "user" },
    "@/assets/AILogo.png": { src: "fixture.png" }, "next/image": () => null,
  }).default;
  const passthrough = ({ children }) => React.createElement("div", null, children);
  const TrialModal = load("src/components/Modals/TrialPlan/TrialModalV2.tsx", {
    "@/components/PageComponents/Kanban/HeaderComponents/StartPlanButton": buttonModule,
    "@/hooks/useFlag": flagMock, "@/lib/flags/keys": flag,
    "@/components/Common/CommonModalComponents": { ModalContainerCustom: passthrough },
    "@/styles/AttachmentView.scss": {},
    reactstrap: { ModalHeader: passthrough, ModalBody: passthrough, ModalFooter: passthrough, Carousel: passthrough, CarouselItem: passthrough },
    "@/lib/constants/constants": { testimonials: [] }, "next/image": () => null,
    "@/store": { currentProjectAtom: "project" },
    "@/lib/state": { useRecoilState: () => [state.board, () => {}] },
    "@/lib/constants/APIRouteConstants": { CHECKOUT_SESSION_API_ENDPOINT: "/api/stripe/session/checkout" },
    axios: { ...axios, get: async () => ({ status: 200, data: backend?.team ?? freeBoard().team }) },
    "next/navigation": { useRouter: () => router }, "@/lib/subscriptionPlans": plans,
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "lucide-react": { LogOut: () => null, Star: () => null },
    "@/hooks/MultiPages/HTC/useSignout": { useSignout: () => ({ handleHardReset: () => {} }) },
    "@/assets/rightSidebarHTCLogoDarkMode.svg": {}, "@/assets/RightSidebarLogo.webp": {},
    "@/components/Common/Tooltip": () => null,
    "@/hooks/MultiPages/HTC/useDarkMode": () => ({ effectiveTheme: "dark" }),
    "@/lib/pricingCheckoutUrls": { buildPricingCheckoutCancelUrl: () => "/pricing" },
  }).default;
  const renderModal = async () => React.act(async () => reactRoot.render(React.createElement(TrialModal, {
    currentUser: state.userId ? { id: state.userId } : null, callback: () => {},
  })));
  const renderCard = async () => React.act(async () => reactRoot.render(React.createElement(TrialCard, {
    teamInfo: { teamId: "team-owned", stripe_customer_id: "cus_owned", googleAccountId: "account-owned", totalSeats: 3 }, manageLink: "/manage", plan: plans.storeSubscriptionPlans[0],
    hasSubscription: { activeStorePlan: "Free" },
  })));
  const render = async (props = {}) => React.act(async () => reactRoot.render(React.createElement(buttonModule.StartPlanButton, { project: state.board, compact: true, ...props })));
  const renderLegacy = async (component) => React.act(async () => reactRoot.render(React.createElement(legacy[component], { teamId: "team-owned" })));
  const click = async () => React.act(async () => container.querySelector("button").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  try {
    await fn({ dom, container, state, render, renderLegacy, renderCard, renderModal, click, requests, pushes, invalidations,
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
  assert.match(header, /useFlag\(HTPR_7551_START_PLAN_CHECKOUT_FLAG\)/);
  const alternate = read("src/components/Modals/TrialPlan/TrialModalV2.tsx");
  assert.match(alternate, /if \(!flagReady\) return null/);
  assert.match(alternate, /<TrialBody team=\{currTeam\} callback=\{callback\} startPlanCheckout=\{startPlanEnabled\s*\? <TeamStartPlanButton teamId=\{currTeam\?\.id\}/);
  assert.match(alternate, /if \(startPlanCheckout !== undefined\) return startPlanCheckout/);
  const settings = read("src/components/Modals/Settings/PlansSection.tsx");
  assert.match(settings, /useFlag\(HTPR_7551_START_PLAN_CHECKOUT_FLAG\)/);
  assert.match(settings, /const freePlanDescription = <>\{!planFlagReady \? "Checking plan access…" : startPlanEnabled \? "Free plan" : null\}<\/>/);
  assert.match(settings, /plan.id === "Free"\s*\? !planFlagReady \|\| startPlanEnabled \? freePlanDescription : selectedType.description\s*: selectedType.description/);
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


test("standalone trial card without currentUser is not stuck loading; a signed-in owner still loads boards and can start a plan", async () => {
  await withButton(async ({ state, renderCard, container, requests }) => {
    state.board = null; state.boards = undefined; state.userId = undefined;
    await renderCard();
    assert.equal(container.querySelector("button"), null);
    assert.doesNotMatch(container.textContent, /Loading this team's boards/);
    assert.match(container.textContent, /Open a board in this team/);
    assert.deepEqual(requests, []);
    state.userId = 6;
    await renderCard();
    assert.match(container.textContent, /Loading this team's boards/);
    state.boards = [freeBoard()]; state.data = { canStartPlan: true, trialDays: 7 };
    await renderCard();
    assert.equal(container.querySelector("button").textContent, "Start a Hypertask plan");
  });
});

for (const selection of ["none", "different team"]) {
  for (const pastTrial of [false, true]) {
    test(`standalone trial card with ${selection} selected submits server-accepted ${pastTrial ? "Normal" : "Trial"} terms for its explicit team`, async () => {
      const backend = harness(); backend.team.team_activity.hasCompletedTrial = pastTrial;
      await withButton(async ({ state, dom, renderCard, container, getQuery, click, requests, pushes }) => {
        dom.reconfigure({ url: "https://app.hypertask.ai/trial-plan-confirmation?teamId=team-owned" });
        const otherBoard = { ...freeBoard(), id: 8, teamId: "other-team", team: { ...freeBoard().team, id: "other-team" } };
        state.board = selection === "none" ? null : otherBoard;
        state.boards = [otherBoard, freeBoard()];
        await renderCard();
        assert.equal(state.boardsQuery.options.enabled, true);
        assert.equal(state.boardsQuery.user.id, 6);
        assert.equal(container.querySelector("button"), null);
        state.data = await getQuery().queryFn();
        assert.deepEqual(state.data, { canStartPlan: true, trialDays: pastTrial ? 0 : 7 });
        await renderCard(); await click();
        const expected = { intent: "signup-straight-to-board", teamId: "team-owned", boardUrl: "https://app.hypertask.ai/project?id=7" };
        assert.deepEqual(requests, [
          { url: "/api/stripe/session/checkout", body: { ...expected, action: "preview" } },
          { url: "/api/stripe/session/checkout", body: expected },
        ]);
        assert.equal(plans.storeSubscriptionPlans[0].types[0].stripePriceId, "price_byok_month");
        assert.equal(backend.calls.length, 1);
        const payload = backend.calls[0].payload;
        assert.equal(payload.customer, "cus_owned");
        assert.deepEqual(payload.line_items, [{ price: "price_pro_month", quantity: 3 }]);
        assert.equal(payload.subscription_data?.trial_period_days, pastTrial ? undefined : 7);
        assert.equal(payload.metadata.checkoutMode, pastTrial ? "Normal" : "Trial");
        assert.equal(payload.success_url, expected.boardUrl);
        assert.equal(payload.cancel_url, expected.boardUrl);
        assert.deepEqual(pushes, ["https://checkout.stripe.test/cs_1"]);
      }, backend);
    });
  }
  test(`standalone trial card with ${selection} selected refuses an explicit-team member at the controller`, async () => {
    const backend = harness(); backend.team.googleAccount.userId = 99;
    await withButton(async ({ state, dom, renderCard, container, getQuery, requests, pushes }) => {
      dom.reconfigure({ url: "https://app.hypertask.ai/trial-plan-confirmation?teamId=team-owned" });
      state.board = selection === "none" ? null : { ...freeBoard(), teamId: "other-team", team: { ...freeBoard().team, id: "other-team" } };
      await renderCard();
      await assert.rejects(getQuery().queryFn(), (error) => error.response.status === 403);
      state.isError = true; state.error = { isAxiosError: true, response: { data: { message: "Only the team owner can update billing" } } };
      await renderCard();
      assert.match(container.textContent, /Only the team owner/);
      assert.equal(container.querySelector("button"), null);
      assert.equal(requests.length, 1); assert.equal(backend.calls.length, 0);
      assert.deepEqual(pushes, []);
    }, backend);
  });
}

test("standalone trial card does not reuse another team's board when the explicit team has none", async () => {
  await withButton(async ({ state, renderCard, container, requests }) => {
    state.board = null;
    state.boards = [{ ...freeBoard(), team: { ...freeBoard().team, id: "other-team" } }];
    await renderCard();
    assert.equal(container.querySelector("button"), null);
    assert.match(container.textContent, /Open a board in this team/);
    assert.deepEqual(requests, []);
    const previousBoardsQuery = state.boardsQuery;
    state.enabled = false;
    await renderCard();
    assert.equal(state.boardsQuery, previousBoardsQuery);
    assert.match(container.textContent, /Begin Hypertask Trial/);
  });
});

for (const selection of ["none", "different team"]) {
  test(`trial modal with ${selection} selected loads its own team's board; missing board refuses checkout and loaded owner remains allowed`, async () => {
    const backend = harness();
    await withButton(async ({ state, renderModal, container, getQuery, click, requests, pushes }) => {
      const otherBoard = { ...freeBoard(), id: 8, team: { ...freeBoard().team, id: "other-team" } };
      state.board = selection === "none" ? null : otherBoard;
      state.boards = undefined;
      await renderModal();
      assert.match(container.textContent, /Loading this team's boards/);
      assert.doesNotMatch(container.textContent, /Get Started|14 day/);
      assert.deepEqual(requests, []);
      state.boards = [otherBoard]; await renderModal();
      assert.match(container.textContent, /Open a board in this team/);
      assert.deepEqual(requests, []);
      state.boardsError = true; await renderModal();
      assert.match(container.textContent, /Could not load this team's boards/);
      await React.act(async () => container.querySelector("button").click());
      assert.equal(state.boardRefetches, 1);
      state.boardsError = false; state.boards = [otherBoard, freeBoard()];
      await renderModal(); assert.match(container.textContent, /Checking plan access/);
      state.data = await getQuery().queryFn(); await renderModal();
      assert.equal(container.querySelector("button").textContent, "Start a Hypertask plan");
      await click();
      assert.equal(requests.at(-1).body.teamId, "team-owned");
      assert.match(requests.at(-1).body.boardUrl, /project\?id=7/);
      assert.equal(backend.calls.length, 1);
      assert.deepEqual(pushes, ["https://checkout.stripe.test/cs_1"]);
      state.enabled = false; await renderModal();
      assert.match(container.textContent, /14 day FREE trial/);
    }, backend);
  });
}

for (const trialDays of [7, 14]) {
  test(`Start plan shows the real ${trialDays}-day preview and sends matching terms to Stripe`, async () => {
    const backend = harness(); backend.fourteenDayTrial = trialDays === 14;
    await withButton(async ({ state, render, container, getQuery, click, pushes }) => {
      await render(); state.data = await getQuery().queryFn(); await render();
      assert.equal(state.data.trialDays, trialDays);
      assert.ok(container.textContent.includes(`$20 per user/month after ${trialDays} days`));
      await click();
      assert.equal(backend.calls[0].payload.subscription_data.trial_period_days, trialDays);
      assert.deepEqual(pushes, ["https://checkout.stripe.test/cs_1"]);
    }, backend);
  });
}
