const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";
process.env.STRIPE_SECRET_KEY = "sk_test_unused";

const jiti = require("jiti")(
  path.join(root, "tests/seat-billing-concurrency-entry.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  },
);
const {
  mutateAndSyncSeatBilling,
  reconcileSeatBillingForTeam,
  syncSeatBillingOnJoin,
} = jiti(path.join(root, "src/lib/syncSeatBilling.ts"));
const {
  completePendingStripeCancellation,
  pendingStripeCancellationId,
  subscriptionObjectWithPendingCancellation,
} = jiti(path.join(root, "src/lib/pendingStripeSubscriptionCancellation.ts"));
const { withTeamSeatBillingLock } = jiti(
  path.join(root, "src/lib/seatBillingLock.ts"),
);
const { ensureTeamMembership } = jiti(
  path.join(root, "src/lib/teamMembership.ts"),
);

const activeTeam = (totalSeats) => ({
  totalSeats,
  activeSubscriptionPlanId: "sub_test",
  activeSubscriptionPlanItemId: "si_test",
  compedUntil: null,
  subscriptionPlan: [
    {
      subscriptionId: "sub_test",
      subscriptionItemId: "si_test",
      subscriptionStatus: "active",
      priceId: "price_test",
    },
  ],
});

function serialQueue() {
  const tails = new Map();
  return async (teamId, run) => {
    const previous = tails.get(teamId) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    tails.set(
      teamId,
      previous.then(() => current),
    );
    await previous;
    try {
      return await run(() => {});
    } finally {
      release();
    }
  };
}

test("the public join billing API always enters its serializer", async () => {
  let serialized = false;
  const adapter = {
    findTeam: async () => null,
    resolveQuantity: async () => 0,
    retrieveSubscriptionItem: async () => ({ id: "si_test", quantity: 0 }),
    updateSubscriptionItem: async () => {},
    reportFailure: async () => {},
  };
  const serialize = async (_teamId, run) => {
    serialized = true;
    return run(() => {});
  };

  assert.equal(
    await syncSeatBillingOnJoin("team_1", adapter, serialize),
    "SKIPPED",
  );
  assert.equal(serialized, true);
});

test("concurrent joins serialize Stripe quantity updates in membership order", async () => {
  let memberCount = 5;
  let stripeQuantity = 5;
  const updates = [];
  const adapter = {
    findTeam: async () => activeTeam(memberCount),
    resolveQuantity: async (_teamId, totalSeats) => totalSeats,
    retrieveSubscriptionItem: async () => ({
      id: "si_test",
      quantity: stripeQuantity,
    }),
    updateSubscriptionItem: async (_itemId, update, requestOptions) => {
      updates.push({ quantity: update.quantity, requestOptions });
      stripeQuantity = update.quantity;
    },
    reportFailure: async () => {},
  };
  const serialize = serialQueue();

  const results = await Promise.all([
    mutateAndSyncSeatBilling(
      "team_1",
      async () => {
        memberCount += 1;
        return { value: memberCount, sync: true };
      },
      { adapter, serialize },
    ),
    mutateAndSyncSeatBilling(
      "team_1",
      async () => {
        memberCount += 1;
        return { value: memberCount, sync: true };
      },
      { adapter, serialize },
    ),
  ]);

  assert.deepEqual(
    results.map((result) => result.billing),
    ["SEATED", "SEATED"],
  );
  assert.deepEqual(
    updates.map((update) => update.quantity),
    [6, 7],
  );
  for (const update of updates) {
    assert.equal(update.requestOptions.timeout, 15_000);
    assert.match(update.requestOptions.idempotencyKey, /^seat-billing-/);
  }
  assert.equal(stripeQuantity, 7);
});

test("a concurrent join and leave cannot write Stripe from stale membership state", async () => {
  let memberCount = 5;
  let stripeQuantity = 5;
  const updates = [];
  const adapter = {
    findTeam: async () => activeTeam(memberCount),
    resolveQuantity: async (_teamId, totalSeats) => totalSeats,
    retrieveSubscriptionItem: async () => ({
      id: "si_test",
      quantity: stripeQuantity,
    }),
    updateSubscriptionItem: async (_itemId, update) => {
      updates.push(update.quantity);
      stripeQuantity = update.quantity;
    },
    reportFailure: async () => {},
  };
  const serialize = serialQueue();

  await Promise.all([
    mutateAndSyncSeatBilling(
      "team_1",
      async () => {
        memberCount += 1;
        return { value: undefined, sync: true };
      },
      { adapter, serialize },
    ),
    mutateAndSyncSeatBilling(
      "team_1",
      async () => {
        memberCount -= 1;
        return { value: undefined, sync: true };
      },
      { adapter, exact: true, serialize },
    ),
  ]);

  assert.deepEqual(updates, [6, 5]);
  assert.equal(stripeQuantity, memberCount);
});

test("exact reconciliation corrects an over-billed quantity with prorations", async () => {
  const updates = [];
  const adapter = {
    findTeam: async () => activeTeam(6),
    resolveQuantity: async () => 6,
    retrieveSubscriptionItem: async () => ({ id: "si_test", quantity: 7 }),
    updateSubscriptionItem: async (_itemId, update) => updates.push(update),
    reportFailure: async () => {},
  };
  const passthrough = async (_teamId, run) => run(() => {});

  assert.equal(
    await reconcileSeatBillingForTeam("team_1", adapter, passthrough),
    "RECONCILED",
  );
  assert.deepEqual(updates, [
    { quantity: 6, proration_behavior: "create_prorations" },
  ]);
});

test("a durable pending cancellation retries safely after Stripe recovers", async () => {
  let storedObject = subscriptionObjectWithPendingCancellation(
    { id: "sub_new", status: "active" },
    "sub_old",
  );
  const plan = {
    id: "plan_new",
    teamId: "team_1",
    subscriptionId: "sub_new",
    subscriptionObject: storedObject,
  };
  let failOnce = true;
  let schedules = 0;
  const adapter = {
    retrieveSubscription: async () => ({ cancel_at_period_end: false }),
    scheduleCancellation: async (subscriptionId) => {
      assert.equal(subscriptionId, "sub_old");
      schedules += 1;
      if (failOnce) {
        failOnce = false;
        throw new Error("Stripe unavailable");
      }
    },
    clearPendingCancellation: async (_plan, subscriptionObject) => {
      storedObject = subscriptionObject;
      return true;
    },
  };

  await assert.rejects(
    completePendingStripeCancellation(plan, () => {}, adapter),
    /Stripe unavailable/,
  );
  assert.equal(pendingStripeCancellationId(storedObject), "sub_old");

  await completePendingStripeCancellation(
    { ...plan, subscriptionObject: storedObject },
    () => {},
    adapter,
  );
  assert.equal(schedules, 2);
  assert.equal(pendingStripeCancellationId(storedObject), null);
});

test("a completed Stripe cancellation survives a failed marker clear", async () => {
  let storedObject = subscriptionObjectWithPendingCancellation(
    { id: "sub_new", status: "active" },
    "sub_old",
  );
  let cancelAtPeriodEnd = false;
  let clearAttempts = 0;
  let schedules = 0;
  const plan = {
    id: "plan_new",
    teamId: "team_1",
    subscriptionId: "sub_new",
    subscriptionObject: storedObject,
  };
  const adapter = {
    retrieveSubscription: async () => ({ cancel_at_period_end: cancelAtPeriodEnd }),
    scheduleCancellation: async () => {
      schedules += 1;
      cancelAtPeriodEnd = true;
    },
    clearPendingCancellation: async (_plan, subscriptionObject) => {
      clearAttempts += 1;
      if (clearAttempts === 1) throw new Error("database unavailable");
      storedObject = subscriptionObject;
      return true;
    },
  };

  await assert.rejects(
    completePendingStripeCancellation(plan, () => {}, adapter),
    /database unavailable/,
  );
  assert.equal(cancelAtPeriodEnd, true);
  assert.equal(pendingStripeCancellationId(storedObject), "sub_old");

  await completePendingStripeCancellation(
    { ...plan, subscriptionObject: storedObject },
    () => {},
    adapter,
  );
  assert.equal(schedules, 1);
  assert.equal(clearAttempts, 2);
  assert.equal(pendingStripeCancellationId(storedObject), null);
});

test("an already-ended Stripe subscription clears pending work without an update", async () => {
  for (const retrieved of [
    { cancel_at_period_end: false, status: "canceled" },
    null,
  ]) {
    let storedObject = subscriptionObjectWithPendingCancellation(
      { id: "sub_new", status: "active" },
      "sub_old",
    );
    let schedules = 0;
    await completePendingStripeCancellation(
      {
        id: "plan_new",
        teamId: "team_1",
        subscriptionId: "sub_new",
        subscriptionObject: storedObject,
      },
      () => {},
      {
        retrieveSubscription: async () => retrieved,
        scheduleCancellation: async () => {
          schedules += 1;
        },
        clearPendingCancellation: async (_plan, subscriptionObject) => {
          storedObject = subscriptionObject;
          return true;
        },
      },
    );

    assert.equal(schedules, 0);
    assert.equal(pendingStripeCancellationId(storedObject), null);
  }
});

test("nightly reconciliation drains pending cancellation work before seats", async () => {
  const team = activeTeam(6);
  team.subscriptionPlan[0].subscriptionObject =
    subscriptionObjectWithPendingCancellation(
      { id: "sub_test", status: "active" },
      "sub_old",
    );
  const repairs = [];
  const adapter = {
    findTeam: async () => team,
    repairPendingCancellation: async (plan) => {
      repairs.push(pendingStripeCancellationId(plan.subscriptionObject));
      return true;
    },
    resolveQuantity: async () => 6,
    retrieveSubscriptionItem: async () => ({ id: "si_test", quantity: 6 }),
    updateSubscriptionItem: async () => {
      throw new Error("equal quantity must not update Stripe");
    },
    reportFailure: async () => {},
  };
  const passthrough = async (_teamId, run) => run(() => {});

  assert.equal(
    await reconcileSeatBillingForTeam("team_1", adapter, passthrough),
    "OK",
  );
  assert.deepEqual(repairs, ["sub_old"]);
});

test("nightly reconciliation reports a pending cancellation failure", async () => {
  const team = activeTeam(6);
  let seatRead = false;
  const failures = [];
  const adapter = {
    findTeam: async () => team,
    repairPendingCancellation: async () => {
      throw new Error("Stripe unavailable");
    },
    resolveQuantity: async () => {
      seatRead = true;
      return 6;
    },
    retrieveSubscriptionItem: async () => ({ id: "si_test", quantity: 6 }),
    updateSubscriptionItem: async () => {},
    reportFailure: async (error) => failures.push(error.message),
  };
  const passthrough = async (_teamId, run) => run(() => {});

  assert.equal(
    await reconcileSeatBillingForTeam("team_1", adapter, passthrough),
    "Error",
  );
  assert.equal(seatRead, false);
  assert.deepEqual(failures, ["Stripe unavailable"]);
});

test("reconciliation repairs a missing stored item from the active subscription", async () => {
  const updates = [];
  const repairs = [];
  const team = activeTeam(6);
  team.activeSubscriptionPlanItemId = "si_stale";
  team.subscriptionPlan[0].subscriptionItemId = "si_stale";
  const adapter = {
    findTeam: async () => team,
    resolveQuantity: async () => 6,
    retrieveSubscriptionItem: async () => {
      const error = new Error("No such subscription item: 'si_stale'");
      error.code = "resource_missing";
      error.param = "id";
      throw error;
    },
    listSubscriptionItems: async (subscriptionId) => {
      assert.equal(subscriptionId, "sub_test");
      return [{ id: "si_current", quantity: 5, priceId: "price_test" }];
    },
    repairSubscriptionItemId: async (...args) => {
      repairs.push(args);
      return true;
    },
    updateSubscriptionItem: async (itemId, update) =>
      updates.push({ itemId, ...update }),
    reportFailure: async () => {},
  };
  const passthrough = async (_teamId, run) => run(() => {});

  assert.equal(
    await reconcileSeatBillingForTeam("team_1", adapter, passthrough),
    "RECONCILED",
  );
  assert.deepEqual(repairs, [
    ["team_1", "sub_test", "si_stale", "si_stale", "si_current"],
  ]);
  assert.deepEqual(updates, [
    {
      itemId: "si_current",
      quantity: 6,
      proration_behavior: "always_invoice",
    },
  ]);
});

test("reconciliation repairs a null team pointer from the stale plan pointer", async () => {
  const repairs = [];
  const team = activeTeam(6);
  team.activeSubscriptionPlanItemId = null;
  const adapter = {
    findTeam: async () => team,
    resolveQuantity: async () => 6,
    retrieveSubscriptionItem: async () => {
      const error = new Error("No such subscription item: 'si_test'");
      error.code = "resource_missing";
      error.param = "id";
      throw error;
    },
    listSubscriptionItems: async () => [
      { id: "si_current", quantity: 6, priceId: "price_test" },
    ],
    repairSubscriptionItemId: async (...args) => {
      repairs.push(args);
      return true;
    },
    updateSubscriptionItem: async () => {
      throw new Error("equal quantity must not update Stripe");
    },
    reportFailure: async () => {},
  };
  const passthrough = async (_teamId, run) => run(() => {});

  assert.equal(
    await reconcileSeatBillingForTeam("team_1", adapter, passthrough),
    "OK",
  );
  assert.deepEqual(repairs, [
    ["team_1", "sub_test", null, "si_test", "si_current"],
  ]);
});

test("reconciliation replaces a valid item from an older subscription", async () => {
  const updates = [];
  const repairs = [];
  const team = activeTeam(6);
  team.activeSubscriptionPlanItemId = "si_old";
  team.subscriptionPlan[0].subscriptionItemId = "si_old";
  const adapter = {
    findTeam: async () => team,
    resolveQuantity: async () => 6,
    retrieveSubscriptionItem: async () => ({
      id: "si_old",
      quantity: 5,
      priceId: "price_test",
      subscriptionId: "sub_old",
    }),
    listSubscriptionItems: async () => [
      {
        id: "si_current",
        quantity: 5,
        priceId: "price_test",
        subscriptionId: "sub_test",
      },
    ],
    repairSubscriptionItemId: async (...args) => {
      repairs.push(args);
      return true;
    },
    updateSubscriptionItem: async (itemId, update) =>
      updates.push({ itemId, ...update }),
    reportFailure: async () => {},
  };
  const passthrough = async (_teamId, run) => run(() => {});

  assert.equal(
    await reconcileSeatBillingForTeam("team_1", adapter, passthrough),
    "RECONCILED",
  );
  assert.deepEqual(repairs, [
    ["team_1", "sub_test", "si_old", "si_old", "si_current"],
  ]);
  assert.equal(updates[0].itemId, "si_current");
});

test("reconciliation refuses a sole replacement with the wrong price", async () => {
  let reported = false;
  const team = activeTeam(6);
  const adapter = {
    findTeam: async () => team,
    resolveQuantity: async () => 6,
    retrieveSubscriptionItem: async () => {
      const error = new Error("Invalid subscription_item id: si_test");
      error.code = "resource_missing";
      throw error;
    },
    listSubscriptionItems: async () => [
      { id: "si_wrong_price", quantity: 5, priceId: "price_other" },
    ],
    updateSubscriptionItem: async () => {
      throw new Error("must not update an ambiguous item");
    },
    reportFailure: async () => {
      reported = true;
    },
  };
  const passthrough = async (_teamId, run) => run(() => {});

  assert.equal(
    await reconcileSeatBillingForTeam("team_1", adapter, passthrough),
    "Error",
  );
  assert.equal(reported, true);
});

test("reconciliation refuses recovery when the active plan pointer disagrees", async () => {
  let listed = false;
  const team = activeTeam(6);
  team.activeSubscriptionPlanId = "sub_stale";
  const adapter = {
    findTeam: async () => team,
    resolveQuantity: async () => 6,
    retrieveSubscriptionItem: async () => {
      throw new Error("must not retrieve without an authoritative active plan");
    },
    listSubscriptionItems: async () => {
      listed = true;
      return [];
    },
    updateSubscriptionItem: async () => {},
    reportFailure: async () => {},
  };
  const passthrough = async (_teamId, run) => run(() => {});

  assert.equal(
    await reconcileSeatBillingForTeam("team_1", adapter, passthrough),
    "SKIPPED",
  );
  assert.equal(listed, false);
});

test("reconciliation does not guess a plan without an authoritative subscription id", async () => {
  let retrieved = false;
  const team = activeTeam(6);
  team.activeSubscriptionPlanId = null;
  const adapter = {
    findTeam: async () => team,
    resolveQuantity: async () => 6,
    retrieveSubscriptionItem: async () => {
      retrieved = true;
      return { id: "si_test", quantity: 5 };
    },
    updateSubscriptionItem: async () => {},
    reportFailure: async () => {},
  };
  const passthrough = async (_teamId, run) => run(() => {});

  assert.equal(
    await reconcileSeatBillingForTeam("team_1", adapter, passthrough),
    "SKIPPED",
  );
  assert.equal(retrieved, false);
});

test("reconciliation does not bill when conditional pointer repair loses a race", async () => {
  let updated = false;
  const team = activeTeam(6);
  const adapter = {
    findTeam: async () => team,
    resolveQuantity: async () => 6,
    retrieveSubscriptionItem: async () => {
      const error = new Error("No such subscription item: 'si_test'");
      error.code = "resource_missing";
      error.param = "id";
      throw error;
    },
    listSubscriptionItems: async () => [
      { id: "si_current", quantity: 5, priceId: "price_test" },
    ],
    repairSubscriptionItemId: async () => false,
    updateSubscriptionItem: async () => {
      updated = true;
    },
    reportFailure: async () => {},
  };
  const passthrough = async (_teamId, run) => run(() => {});

  assert.equal(
    await reconcileSeatBillingForTeam("team_1", adapter, passthrough),
    "Error",
  );
  assert.equal(updated, false);
});

test("the Redis lease serializes two callers and releases only its token", async () => {
  const values = new Map();
  const redis = {
    set: async (key, value, _px, _ttl, nx) => {
      if (nx === "NX" && values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    eval: async (script, _keyCount, key, token) => {
      if (values.get(key) !== token) return 0;
      if (script.includes("pexpire")) return 1;
      if (script.includes("del")) {
        values.delete(key);
        return 1;
      }
      return 0;
    },
  };
  const events = [];

  await Promise.all([
    withTeamSeatBillingLock(
      "team_1",
      async () => {
        events.push("first:start");
        await new Promise((resolve) => setTimeout(resolve, 25));
        events.push("first:end");
      },
      redis,
    ),
    withTeamSeatBillingLock(
      "team_1",
      async () => {
        events.push("second:start");
        events.push("second:end");
      },
      redis,
    ),
  ]);

  assert.deepEqual(events, [
    "first:start",
    "first:end",
    "second:start",
    "second:end",
  ]);
  assert.equal(values.size, 0);
});

test("a unique-conflict loser reuses the winning team membership", async () => {
  const member = { id: "member_1", user: { displayName: "Member" } };
  const result = await ensureTeamMembership(
    { googleAccountId: "account_1", teamId: "team_1", userId: 42 },
    {
      create: async () => {
        throw { code: "P2002", meta: { target: ["userId", "teamId"] } };
      },
      updateMany: async () => ({ count: 0 }),
      findUnique: async () => member,
    },
  );

  assert.deepEqual(result, { created: false, member });
});

test("an unrelated unique conflict is not mistaken for a membership race", async () => {
  const conflict = { code: "P2002", meta: { target: ["id"] } };

  await assert.rejects(
    ensureTeamMembership(
      { googleAccountId: "account_1", teamId: "team_1", userId: 42 },
      {
        create: async () => {
          throw conflict;
        },
        updateMany: async () => {
          throw new Error("must not update after an unrelated conflict");
        },
        findUnique: async () => {
          throw new Error("must not query after an unrelated conflict");
        },
      },
    ),
    (error) => error === conflict,
  );
});

test("an invited membership is atomically promoted and becomes billable once", async () => {
  const member = {
    id: "member_1",
    status: "Accepted",
    user: { displayName: "Member" },
  };
  const result = await ensureTeamMembership(
    { googleAccountId: "account_1", teamId: "team_1", userId: 42 },
    {
      create: async () => {
        throw { code: "P2002", meta: { target: ["userId", "teamId"] } };
      },
      updateMany: async () => ({ count: 1 }),
      findUnique: async () => member,
    },
  );

  assert.deepEqual(result, { created: true, member });
});

// HTPR-5571: two abandoned 2023 test teams pointed at Stripe items that no longer
// exist. Every night the reconcile cron threw on them and the error reporter filed
// a fresh "[auto] Seat billing failed" ticket, 11 of them before anyone noticed.
// A team Stripe cannot bill and cannot repair is a team to skip, not to page about.
test("reconciliation skips an item Stripe lost with no replacement", async () => {
  const reports = [];
  const team = activeTeam(6);
  team.activeSubscriptionPlanItemId = "si_orphan";
  team.subscriptionPlan[0].subscriptionItemId = "si_orphan";
  const adapter = {
    findTeam: async () => team,
    resolveQuantity: async () => 6,
    retrieveSubscriptionItem: async () => {
      throw invalidItemIdError("si_orphan");
    },
    // The subscription survives but carries nothing at the active price, so there
    // is no quantity anywhere left to correct.
    listSubscriptionItems: async () => [],
    repairSubscriptionItemId: async () => {
      throw new Error("nothing to repair to");
    },
    updateSubscriptionItem: async () => {
      throw new Error("must not bill an item Stripe does not have");
    },
    reportFailure: async (error) => reports.push(error.message),
  };
  const passthrough = async (_teamId, run) => run(() => {});

  assert.equal(
    await reconcileSeatBillingForTeam("team_1", adapter, passthrough),
    "SKIPPED",
  );
  assert.deepEqual(reports, []);
});

// Same shape one level up: the whole subscription is gone, not just the item.
test("reconciliation skips a team whose subscription Stripe no longer has", async () => {
  const reports = [];
  const team = activeTeam(6);
  const adapter = {
    findTeam: async () => team,
    resolveQuantity: async () => 6,
    retrieveSubscriptionItem: async () => {
      const error = new Error("No such subscription item: 'si_test'");
      error.code = "resource_missing";
      error.param = "id";
      throw error;
    },
    listSubscriptionItems: async () => {
      const error = new Error("No such subscription: 'sub_test'");
      error.code = "resource_missing";
      throw error;
    },
    repairSubscriptionItemId: async () => true,
    updateSubscriptionItem: async () => {
      throw new Error("must not bill a subscription Stripe does not have");
    },
    reportFailure: async (error) => reports.push(error.message),
  };
  const passthrough = async (_teamId, run) => run(() => {});

  assert.equal(
    await reconcileSeatBillingForTeam("team_1", adapter, passthrough),
    "SKIPPED",
  );
  assert.deepEqual(reports, []);
});

// The quiet path must stay narrow. A live item sitting on the wrong plan is real
// money going to the wrong price, and still has to raise a ticket.
test("reconciliation still reports a live item that is not on the active plan", async () => {
  const reports = [];
  const team = activeTeam(6);
  const adapter = {
    findTeam: async () => team,
    resolveQuantity: async () => 6,
    retrieveSubscriptionItem: async () => ({
      id: "si_test",
      quantity: 6,
      priceId: "price_other",
      subscriptionId: "sub_test",
    }),
    listSubscriptionItems: async () => [],
    repairSubscriptionItemId: async () => true,
    updateSubscriptionItem: async () => {},
    reportFailure: async (error) => reports.push(error.message),
  };
  const passthrough = async (_teamId, run) => run(() => {});

  assert.equal(
    await reconcileSeatBillingForTeam("team_1", adapter, passthrough),
    "Error",
  );
  assert.deepEqual(reports, [
    "Stored subscription item does not belong to the active plan",
  ]);
});

// HTPR-5621: the two teams that kept refiling hit exactly this Stripe shape, and
// the retrieve error has to route into the same repair and skip paths as the
// `resource_missing` wording. These cover the three outcomes downstream of it.
const invalidItemIdError = (itemId) => {
  const error = new Error(`Invalid subscription_item id: ${itemId}`);
  // This mirrors Stripe Node's StripeInvalidRequestError. The API error type
  // stays in `rawType`; the SDK replaces top-level `type` with the class name.
  error.type = "StripeInvalidRequestError";
  error.rawType = "invalid_request_error";
  return error;
};

test("a malformed-id retrieve error still repairs a stale item pointer", async () => {
  const reports = [];
  const updates = [];
  const team = activeTeam(6);
  const adapter = {
    findTeam: async () => team,
    resolveQuantity: async () => 6,
    retrieveSubscriptionItem: async () => {
      throw invalidItemIdError("si_test");
    },
    listSubscriptionItems: async () => [
      {
        id: "si_current",
        quantity: 4,
        priceId: "price_test",
        subscriptionId: "sub_test",
      },
    ],
    repairSubscriptionItemId: async () => true,
    updateSubscriptionItem: async (itemId, update) => {
      updates.push([itemId, update.quantity]);
    },
    reportFailure: async (error) => reports.push(error.message),
  };
  const passthrough = async (_teamId, run) => run(() => {});

  assert.equal(
    await reconcileSeatBillingForTeam("team_1", adapter, passthrough),
    "RECONCILED",
  );
  assert.deepEqual(updates, [["si_current", 6]]);
  assert.deepEqual(reports, []);
});

test("a malformed-id retrieve error with nothing to repair to is skipped", async () => {
  const reports = [];
  const team = activeTeam(6);
  const adapter = {
    findTeam: async () => team,
    resolveQuantity: async () => 6,
    retrieveSubscriptionItem: async () => {
      throw invalidItemIdError("si_test");
    },
    listSubscriptionItems: async () => [],
    repairSubscriptionItemId: async () => {
      throw new Error("nothing to repair to");
    },
    updateSubscriptionItem: async () => {
      throw new Error("must not bill an item Stripe does not have");
    },
    reportFailure: async (error) => reports.push(error.message),
  };
  const passthrough = async (_teamId, run) => run(() => {});

  assert.equal(
    await reconcileSeatBillingForTeam("team_1", adapter, passthrough),
    "SKIPPED",
  );
  assert.deepEqual(reports, []);
});

// The quiet path stays narrow. A subscription still holding items at another
// price is real money on the wrong price, so it keeps raising a ticket.
test("a malformed-id retrieve error with items at another price is still reported", async () => {
  const reports = [];
  const team = activeTeam(6);
  const adapter = {
    findTeam: async () => team,
    resolveQuantity: async () => 6,
    retrieveSubscriptionItem: async () => {
      throw invalidItemIdError("si_test");
    },
    listSubscriptionItems: async () => [
      {
        id: "si_other",
        quantity: 3,
        priceId: "price_other",
        subscriptionId: "sub_test",
      },
    ],
    repairSubscriptionItemId: async () => true,
    updateSubscriptionItem: async () => {
      throw new Error("must not bill an item on the wrong price");
    },
    reportFailure: async (error) => reports.push(error.message),
  };
  const passthrough = async (_teamId, run) => run(() => {});

  assert.equal(
    await reconcileSeatBillingForTeam("team_1", adapter, passthrough),
    "Error",
  );
  assert.equal(reports.length, 1);
  assert.match(reports[0], /Invalid subscription_item id: si_test/);
});
