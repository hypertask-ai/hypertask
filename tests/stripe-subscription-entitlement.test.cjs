const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const controllerSource = fs.readFileSync(
  path.join(
    root,
    "src/utils/controllers/stripe/webhook/onSubscriptionUpdated.ts",
  ),
  "utf8",
);
const controllerJavascript = ts.transpileModule(controllerSource, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const checkoutSuccessSource = fs.readFileSync(
  path.join(root, "src/utils/controllers/stripe/webhook/onCheckoutSuccess.ts"),
  "utf8",
);
const checkoutSuccessJavascript = ts.transpileModule(checkoutSuccessSource, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

function loadController(prisma, options = {}) {
  const withTeamSeatBillingLock =
    options.withTeamSeatBillingLock ?? (async (_teamId, run) => run(() => {}));
  const completePendingStripeCancellation =
    options.completePendingStripeCancellation ?? (async () => false);
  const stubs = {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/seatBillingLock": { withTeamSeatBillingLock },
    "@/lib/pendingStripeSubscriptionCancellation": {
      completePendingStripeCancellation,
    },
    "@/utils/helperFunctions/helperFunctions": {
      convertTimestampToDate: (timestamp) => new Date(timestamp * 1000),
    },
    "./subscriptionEntitlement": {
      ACCESS_REVOKING_SUBSCRIPTION_STATUSES: ["canceled", "incomplete_expired"],
      shouldClearTeamSubscriptionEntitlement: (status) =>
        status === "canceled" || status === "incomplete_expired",
    },
  };
  const mod = { exports: {} };
  new Function("module", "exports", "require", controllerJavascript)(
    mod,
    mod.exports,
    (request) => stubs[request] ?? require(request),
  );
  return mod.exports.default;
}

function stripeSubscription(id, status, trial = false) {
  return {
    id,
    customer: "cus_1",
    status,
    items: { data: [{ id: "si_1" }] },
    current_period_start: 1_786_000_000,
    current_period_end: 1_788_678_400,
    trial_start: trial ? 1_786_000_000 : null,
    trial_end: trial ? 1_787_209_600 : null,
  };
}

const pendingCancellationKey =
  "hypertaskPendingPreviousSubscriptionCancellationId";

function loadCheckoutSuccess(prisma, stripe, onSubscriptionUpdated) {
  let lockTail = Promise.resolve();
  const stubs = {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/subscription": { stripe },
    "@/lib/pendingStripeSubscriptionCancellation": {
      subscriptionObjectWithPendingCancellation: (
        subscription,
        previousSubscriptionId,
      ) => ({
        ...subscription,
        ...(previousSubscriptionId
          ? { [pendingCancellationKey]: previousSubscriptionId }
          : {}),
      }),
      completePendingStripeCancellation: async (plan, assertHeld) => {
        const previousSubscriptionId =
          plan.subscriptionObject?.[pendingCancellationKey];
        if (!previousSubscriptionId) return false;
        assertHeld();
        const previousSubscription = await stripe.subscriptions.retrieve(
          previousSubscriptionId,
        );
        assertHeld();
        if (!previousSubscription.cancel_at_period_end) {
          await stripe.subscriptions.update(previousSubscriptionId, {
            cancel_at_period_end: true,
          });
          assertHeld();
        }
        const subscriptionObject = { ...plan.subscriptionObject };
        delete subscriptionObject[pendingCancellationKey];
        const cleared = await prisma.subscriptionPlan.updateMany({
          where: {
            id: plan.id,
            teamId: plan.teamId,
            subscriptionId: plan.subscriptionId,
          },
          data: { subscriptionObject },
        });
        if (cleared.count !== 1) {
          throw new Error("pending cancellation changed during repair");
        }
        assertHeld();
        return true;
      },
    },
    "@/lib/seatBillingLock": {
      withTeamSeatBillingLock: async (_teamId, run) => {
        const previous = lockTail;
        let release;
        lockTail = new Promise((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await run(() => {});
        } finally {
          release();
        }
      },
    },
    "@/utils/helperFunctions/helperFunctions": {
      convertTimestampToDate: (timestamp) => new Date(timestamp * 1000),
    },
    "@/pages/api/queues/AiSummary/generateSummaryAfterUpsertionReminder": {
      __esModule: true,
      default: async () => {},
    },
    "./onSubscriptionUpdated": {
      __esModule: true,
      applySubscriptionUpdatedWithTeamLockHeld: onSubscriptionUpdated,
    },
  };
  const mod = { exports: {} };
  new Function("module", "exports", "require", checkoutSuccessJavascript)(
    mod,
    mod.exports,
    (request) => stubs[request] ?? require(request),
  );
  return mod.exports.default;
}

function checkoutReplayHarness({ activeId = null, storedPlans = [] } = {}) {
  let activeSubscriptionPlanId = activeId;
  let plans = storedPlans.map((plan, index) => ({
    id: `stored_plan_${index + 1}`,
    teamId: "team_1",
    subscriptionObject: null,
    ...plan,
  }));
  let cancelAtPeriodEnd = false;
  let failStripeUpdateOnce = false;
  let failTeamUpdateOnce = false;
  const calls = {
    planCreates: 0,
    stripeRetrieves: [],
    stripeUpdates: [],
    subscriptionUpdates: 0,
  };

  const prisma = {
    team: {
      findFirst: async () => ({
        id: "team_1",
        googleAccountId: "account_1",
        googleAccount: { userId: 6 },
        members: [{ userId: 7 }],
        projects: [{ id: 15 }],
        totalSeats: 2,
        activeSubscriptionPlanId,
        subscriptionPlan: plans,
      }),
      update: async ({ data }) => {
        if (failTeamUpdateOnce) {
          failTeamUpdateOnce = false;
          throw new Error("database unavailable");
        }
        activeSubscriptionPlanId = data.activeSubscriptionPlanId;
        return { id: "team_1" };
      },
    },
    subscriptionPlan: {
      create: async ({ data }) => {
        calls.planCreates += 1;
        const storedPlan = { id: `plan_${calls.planCreates}`, ...data };
        plans.push(storedPlan);
        return storedPlan;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        plans = plans.map((plan) => {
          const matchesId = where?.id === undefined || plan.id === where.id;
          const matchesTeam =
            where?.teamId === undefined || plan.teamId === where.teamId;
          const subscriptionFilter = where?.subscriptionId;
          const matchesSubscription =
            subscriptionFilter === undefined ||
            (typeof subscriptionFilter === "string"
              ? plan.subscriptionId === subscriptionFilter
              : plan.subscriptionId !== subscriptionFilter.not);
          const matchesStatus =
            where?.subscriptionStatus?.not === undefined ||
            plan.subscriptionStatus !== where.subscriptionStatus.not;
          if (
            !matchesId ||
            !matchesTeam ||
            !matchesSubscription ||
            !matchesStatus
          ) {
            return plan;
          }
          count += 1;
          return { ...plan, ...data };
        });
        return { count };
      },
    },
    userSetting: {
      update: async () => ({}),
      updateMany: async () => ({ count: 2 }),
    },
    $transaction: async (callback) => {
      const previousActiveId = activeSubscriptionPlanId;
      const previousPlans = plans.map((plan) => ({ ...plan }));
      try {
        return await callback(prisma);
      } catch (error) {
        activeSubscriptionPlanId = previousActiveId;
        plans = previousPlans;
        throw error;
      }
    },
  };
  const stripe = {
    subscriptions: {
      retrieve: async (subscriptionId) => {
        calls.stripeRetrieves.push(subscriptionId);
        return { id: subscriptionId, cancel_at_period_end: cancelAtPeriodEnd };
      },
      update: async (...args) => {
        calls.stripeUpdates.push(args);
        if (failStripeUpdateOnce) {
          failStripeUpdateOnce = false;
          throw new Error("Stripe unavailable");
        }
        cancelAtPeriodEnd = args[1].cancel_at_period_end;
      },
    },
  };
  const controller = loadCheckoutSuccess(prisma, stripe, async () => {
    calls.subscriptionUpdates += 1;
  });

  return {
    calls,
    controller,
    failNextTeamUpdate: () => {
      failTeamUpdateOnce = true;
    },
    failNextStripeUpdate: () => {
      failStripeUpdateOnce = true;
    },
    state: () => ({ activeSubscriptionPlanId, cancelAtPeriodEnd, plans }),
  };
}

const stripePlan = {
  id: "price_1",
  product: "prod_1",
  interval: "month",
};

function loadSubscriptionUpdated({
  activeSubscriptionPlanId,
  planSubscriptionId = "sub_1",
  planStatus = "active",
  hasPlan = true,
  withTeamSeatBillingLock,
  completePendingStripeCancellation,
}) {
  let activeId = activeSubscriptionPlanId;
  let storedStatus = planStatus;
  const calls = { activities: [], plans: [], teams: [], users: [] };

  function teamWhereMatches(where) {
    if (where.id !== "team_1") return false;
    if (where.activeSubscriptionPlanId !== undefined) {
      return where.activeSubscriptionPlanId === activeId;
    }
    if (where.OR) {
      return where.OR.some(
        (candidate) => candidate.activeSubscriptionPlanId === activeId,
      );
    }
    return true;
  }

  const prisma = {
    team: {
      findFirst: async () => ({
        id: "team_1",
        googleAccountId: "account_1",
        googleAccount: { userId: 6 },
        members: [{ userId: 7 }],
        projects: [{ id: 15 }],
        totalSeats: 2,
        subscriptionPlan: hasPlan
          ? [
              {
                id: "plan_1",
                teamId: "team_1",
                subscriptionId: planSubscriptionId,
                subscriptionStatus: storedStatus,
                subscriptionObject: null,
              },
            ]
          : [],
      }),
      updateMany: async (args) => {
        calls.teams.push(args);
        if (!teamWhereMatches(args.where)) return { count: 0 };
        activeId = args.data.activeSubscriptionPlanId;
        return { count: 1 };
      },
    },
    subscriptionPlan: {
      updateMany: async (args) => {
        calls.plans.push(args);
        if (!hasPlan || args.where.subscriptionId !== planSubscriptionId) {
          return { count: 0 };
        }
        const blocked =
          args.where.subscriptionStatus?.notIn?.includes(storedStatus);
        if (blocked) return { count: 0 };
        storedStatus = args.data.subscriptionStatus;
        return { count: 1 };
      },
    },
    team_Activity: {
      updateMany: async (args) => {
        calls.activities.push(args);
        return { count: 1 };
      },
    },
    userSetting: {
      updateMany: async (args) => {
        calls.users.push(args);
        return { count: 2 };
      },
    },
    $transaction: async (callback) => callback(prisma),
  };

  const controller = loadController(prisma, {
    withTeamSeatBillingLock,
    completePendingStripeCancellation,
  });

  return {
    controller,
    calls,
    activeId: () => activeId,
    storedStatus: () => storedStatus,
  };
}

test("terminal Stripe statuses clear only their matching active entitlement", async () => {
  const { controller, calls, activeId, storedStatus } = loadSubscriptionUpdated(
    {
      activeSubscriptionPlanId: "sub_1",
    },
  );

  await controller(stripeSubscription("sub_1", "canceled"));

  assert.equal(activeId(), null);
  assert.equal(storedStatus(), "canceled");
  assert.equal(calls.teams[0].data.activeSubscriptionPlanItemId, null);
});

test("a delayed deletion cannot clear a newer replacement subscription", async () => {
  const { controller, activeId } = loadSubscriptionUpdated({
    activeSubscriptionPlanId: "sub_replacement",
    planSubscriptionId: "sub_old",
  });

  await controller(stripeSubscription("sub_old", "canceled"));

  assert.equal(activeId(), "sub_replacement");
});

test("a stale active update cannot regrant a terminal subscription", async () => {
  const { controller, activeId, storedStatus, calls } = loadSubscriptionUpdated(
    {
      activeSubscriptionPlanId: null,
      planStatus: "canceled",
    },
  );

  await controller(stripeSubscription("sub_1", "active"), stripePlan);

  assert.equal(storedStatus(), "canceled");
  assert.equal(activeId(), null);
  assert.equal(calls.teams.length, 0);
  assert.equal(calls.users.length, 0);
});

test("an old active update cannot replace a newer active subscription", async () => {
  const { controller, activeId, calls } = loadSubscriptionUpdated({
    activeSubscriptionPlanId: "sub_replacement",
    planSubscriptionId: "sub_old",
  });

  await controller(stripeSubscription("sub_old", "active"), stripePlan);

  assert.equal(activeId(), "sub_replacement");
  assert.equal(calls.plans.length, 1);
  assert.equal(calls.teams.length, 1);
  assert.equal(calls.users.length, 0);
});

test("non-trial updates never clear sticky trial history", async () => {
  const { controller, calls } = loadSubscriptionUpdated({
    activeSubscriptionPlanId: "sub_1",
  });

  await controller(stripeSubscription("sub_1", "active"), stripePlan);
  assert.deepEqual(calls.activities, []);
});

test("trialing updates mark trial history true", async () => {
  const { controller, calls } = loadSubscriptionUpdated({
    activeSubscriptionPlanId: "sub_1",
    planStatus: "trialing",
  });

  await controller(stripeSubscription("sub_1", "trialing", true), stripePlan);
  assert.equal(calls.activities.length, 1);
  assert.equal(calls.activities[0].data.hasCompletedTrial, true);
});

test("a reordered terminal trial event records history before clearing access", async () => {
  const { controller, calls, activeId } = loadSubscriptionUpdated({
    activeSubscriptionPlanId: "sub_1",
    planStatus: "trialing",
  });

  await controller(stripeSubscription("sub_1", "canceled", true));

  assert.equal(calls.activities.length, 1);
  assert.equal(calls.activities[0].data.hasCompletedTrial, true);
  assert.equal(activeId(), null);
});

test("an unknown Stripe trial never consumes Hypertask trial eligibility", async () => {
  const { controller, calls, activeId } = loadSubscriptionUpdated({
    activeSubscriptionPlanId: "sub_1",
  });

  await controller(stripeSubscription("sub_unrelated", "trialing", true));

  assert.equal(calls.activities.length, 0);
  assert.equal(calls.plans.length, 0);
  assert.equal(calls.teams.length, 0);
  assert.equal(activeId(), "sub_1");
});

test("an unknown non-terminal update fails closed instead of recreating access", async () => {
  const { controller, activeId, calls } = loadSubscriptionUpdated({
    activeSubscriptionPlanId: null,
    hasPlan: false,
  });

  await controller(stripeSubscription("sub_1", "active"), stripePlan);

  assert.equal(activeId(), null);
  assert.equal(calls.plans.length, 0);
  assert.equal(calls.teams.length, 0);
});

test("subscription updates repair pending cancellation under the team lock", async () => {
  const events = [];
  let lockHeld = false;
  const { controller, calls } = loadSubscriptionUpdated({
    activeSubscriptionPlanId: "sub_1",
    withTeamSeatBillingLock: async (_teamId, run) => {
      events.push("lock acquired");
      lockHeld = true;
      try {
        return await run(() => {
          assert.equal(lockHeld, true);
        });
      } finally {
        lockHeld = false;
        events.push("lock released");
      }
    },
    completePendingStripeCancellation: async (_plan, assertHeld) => {
      assertHeld();
      events.push("pending cancellation repaired");
      return true;
    },
  });

  await controller(stripeSubscription("sub_1", "active"), stripePlan);

  assert.deepEqual(events, [
    "lock acquired",
    "pending cancellation repaired",
    "lock released",
  ]);
  assert.equal(calls.plans.length, 1);
});

test("replayed subscription-created deliveries converge on one local plan", async () => {
  const { calls, controller, state } = checkoutReplayHarness();
  const subscription = stripeSubscription("sub_1", "active");

  await Promise.all([
    controller(subscription, stripePlan),
    controller(subscription, stripePlan),
  ]);

  assert.equal(calls.planCreates, 1);
  assert.deepEqual(calls.stripeUpdates, []);
  assert.equal(calls.subscriptionUpdates, 1);
  assert.equal(state().activeSubscriptionPlanId, "sub_1");
  assert.equal(state().plans.length, 1);
});

test("a failed subscription-created delivery rolls back for a clean retry", async () => {
  const { calls, controller, failNextTeamUpdate, state } =
    checkoutReplayHarness({
      activeId: "sub_old",
      storedPlans: [
        { subscriptionId: "sub_old", subscriptionStatus: "active" },
      ],
    });
  const subscription = stripeSubscription("sub_1", "active");
  failNextTeamUpdate();

  await assert.rejects(
    controller(subscription, stripePlan),
    /database unavailable/,
  );
  assert.equal(state().activeSubscriptionPlanId, "sub_old");
  assert.equal(state().plans.length, 1);
  assert.equal(state().plans[0].subscriptionId, "sub_old");
  assert.equal(state().plans[0].subscriptionStatus, "active");
  assert.deepEqual(calls.stripeRetrieves, []);
  assert.deepEqual(calls.stripeUpdates, []);

  await controller(subscription, stripePlan);
  assert.equal(state().activeSubscriptionPlanId, "sub_1");
  assert.equal(state().plans.length, 2);
  assert.equal(calls.planCreates, 2);
  assert.deepEqual(calls.stripeRetrieves, ["sub_old"]);
  assert.deepEqual(calls.stripeUpdates, [
    ["sub_old", { cancel_at_period_end: true }],
  ]);
});

test("a new subscription retires the previous plan once", async () => {
  const { calls, controller, state } = checkoutReplayHarness({
    activeId: "sub_old",
    storedPlans: [{ subscriptionId: "sub_old", subscriptionStatus: "active" }],
  });

  await controller(stripeSubscription("sub_new", "active"), stripePlan);
  await controller(stripeSubscription("sub_new", "active"), stripePlan);

  assert.deepEqual(calls.stripeUpdates, [
    ["sub_old", { cancel_at_period_end: true }],
  ]);
  assert.deepEqual(calls.stripeRetrieves, ["sub_old"]);
  assert.equal(calls.planCreates, 1);
  assert.equal(calls.subscriptionUpdates, 1);
  assert.equal(state().activeSubscriptionPlanId, "sub_new");
  assert.equal(state().plans.length, 2);
  assert.equal(state().plans[0].subscriptionStatus, "Expired");
  assert.equal(state().plans[1].subscriptionStatus, "active");
});

test("a failed Stripe cancellation stays durable for webhook retry", async () => {
  const { calls, controller, failNextStripeUpdate, state } =
    checkoutReplayHarness({
      activeId: "sub_old",
      storedPlans: [
        { subscriptionId: "sub_old", subscriptionStatus: "active" },
      ],
    });
  failNextStripeUpdate();

  await assert.rejects(
    controller(stripeSubscription("sub_new", "active"), stripePlan),
    /Stripe unavailable/,
  );

  assert.deepEqual(calls.stripeRetrieves, ["sub_old"]);
  assert.deepEqual(calls.stripeUpdates, [
    ["sub_old", { cancel_at_period_end: true }],
  ]);
  assert.equal(state().cancelAtPeriodEnd, false);
  assert.equal(state().activeSubscriptionPlanId, "sub_new");
  assert.equal(
    state().plans[1].subscriptionObject[pendingCancellationKey],
    "sub_old",
  );

  await controller(stripeSubscription("sub_new", "active"), stripePlan);

  assert.deepEqual(calls.stripeRetrieves, ["sub_old", "sub_old"]);
  assert.deepEqual(calls.stripeUpdates, [
    ["sub_old", { cancel_at_period_end: true }],
    ["sub_old", { cancel_at_period_end: true }],
  ]);
  assert.equal(state().cancelAtPeriodEnd, true);
  assert.equal(
    state().plans[1].subscriptionObject[pendingCancellationKey],
    undefined,
  );
  assert.equal(calls.planCreates, 1);
  assert.equal(calls.subscriptionUpdates, 1);
});

test("an unknown Stripe subscription status fails before external changes", async () => {
  const { calls, controller, state } = checkoutReplayHarness({
    activeId: "sub_old",
    storedPlans: [{ subscriptionId: "sub_old", subscriptionStatus: "active" }],
  });

  await assert.rejects(
    controller(stripeSubscription("sub_new", "future_status"), stripePlan),
    /Unsupported Stripe subscription status: future_status/,
  );

  assert.deepEqual(calls.stripeUpdates, []);
  assert.equal(calls.planCreates, 0);
  assert.equal(state().activeSubscriptionPlanId, "sub_old");
});

test("the deleted webhook processes the signed event object", () => {
  const source = fs.readFileSync(
    path.join(root, "src/pages/api/stripe/webhook.ts"),
    "utf8",
  );
  const deletedCase = source.slice(
    source.indexOf("case StripeWebhooks.SubscriptionDeleted"),
    source.indexOf("case StripeWebhooks.SubscriptionUpdated"),
  );

  assert.match(deletedCase, /event\.data\s*\.object/);
  assert.match(deletedCase, /await onSubscriptionUpdated/);
  assert.doesNotMatch(deletedCase, /getSubscription\(event\)/);
});
