const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const LEGACY_RECONCILIATION_TEST_AGE_MS = 16 * 60 * 1000;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/shared-ai-allowance-${Date.now()}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") } },
  );
  return jiti(path.join(root, relativePath));
}

let currentRedis;
const redisModule = { getRedis: async () => currentRedis };

function useRedis(redis) {
  currentRedis = redis;
  stubModule("src/lib/redis.ts", redisModule);
}

function fakeRedis() {
  const values = new Map();
  const reservations = new Map();
  return {
    reservations,
    values,
    exists: async (key) => (values.has(key) ? 1 : 0),
    get: async (key) => values.get(key) ?? null,
    set: async (key, value, ...options) => {
      if (options.includes("NX") && values.has(key)) return null;
      values.set(key, String(value));
      return "OK";
    },
    eval: async (_script, keyCount, committedKey, reservationsKey, ...args) => {
      if (keyCount === 5 && args.length === 9) {
        const [
          initializedKey,
          pendingKey,
          legacySystemObservedKey,
          observedTotal,
          observedVisible,
          observedSystem,
          observedLegacySystem,
          initializedAt,
        ] = args.map(String);
        if (values.has(initializedKey)) return 0;
        const legacyCommitted = Number(values.get(committedKey) ?? 0);
        values.set(initializedKey, initializedAt);
        values.set(committedKey, observedVisible);
        values.set(reservationsKey, String(observedSystem));
        values.set(
          pendingKey,
          String(Math.max(legacyCommitted - Number(observedTotal), 0)),
        );
        values.set(legacySystemObservedKey, observedLegacySystem);
        return 1;
      }
      if (keyCount === 5 && args.length === 6) {
        const [
          pendingKey,
          legacySystemObservedKey,
          completedKey,
          currentLegacySystem,
          ,
          finalReconciliation,
        ] = args.map(String);
        const previousSystem = Number(values.get(legacySystemObservedKey) ?? 0);
        const delta = Math.max(Number(currentLegacySystem) - previousSystem, 0);
        const pending = Number(values.get(pendingKey) ?? 0);
        const fromPending = Math.min(pending, delta);
        const fromVisible = Math.min(
          Number(values.get(committedKey) ?? 0),
          delta - fromPending,
        );
        values.set(pendingKey, String(pending - fromPending));
        values.set(
          committedKey,
          String(Number(values.get(committedKey) ?? 0) - fromVisible),
        );
        values.set(
          reservationsKey,
          String(
            Number(values.get(reservationsKey) ?? 0) +
              fromPending +
              fromVisible,
          ),
        );
        values.set(legacySystemObservedKey, currentLegacySystem);
        if (finalReconciliation === "1") values.set(completedKey, "1");
        return fromPending + fromVisible;
      }
      if (args.length === 3) {
        const [member, amount] = args.map(String);
        const removed =
          reservations.get(reservationsKey)?.delete(member) ?? false;
        if (!removed) return 0;
        values.set(
          committedKey,
          String(Number(values.get(committedKey) ?? 0) + Number(amount)),
        );
        return 1;
      }
      const [
        pendingKey,
        now,
        requested,
        cap,
        expiresAt,
        member,
        ,
        includePending,
      ] = args.map(String);
      const active = reservations.get(reservationsKey) ?? new Map();
      for (const [id, expiry] of active) {
        if (expiry <= Number(now)) {
          values.set(
            committedKey,
            String(
              Number(values.get(committedKey) ?? 0) +
                Number(id.split("|").at(-1)),
            ),
          );
          active.delete(id);
        }
      }
      const reserved = [...active.keys()].reduce(
        (total, id) => total + Number(id.split("|").at(-1)),
        0,
      );
      const committed = Number(values.get(committedKey) ?? 0);
      const pending =
        includePending === "1" ? Number(values.get(pendingKey) ?? 0) : 0;
      if (committed + reserved + pending + Number(requested) > Number(cap)) {
        return 0;
      }
      active.set(member, Number(expiresAt));
      reservations.set(reservationsKey, active);
      return 1;
    },
    zrem: async (key, member) => {
      reservations.get(key)?.delete(member);
      return 1;
    },
  };
}

test("plan-derived allowances keep Free/BYOK separate from paid teams", () => {
  const { teamAiAllowanceUsd } = loadTs("src/lib/aiAllowancePolicy.ts");
  assert.equal(teamAiAllowanceUsd("Free"), 1);
  assert.equal(teamAiAllowanceUsd("BYOK"), 1);
  assert.equal(teamAiAllowanceUsd("AI"), 40);
  assert.equal(teamAiAllowanceUsd("Pro"), 40);
});

test("allowance ledgers reset on the first day of each UTC month", () => {
  const { aiAllowancePeriod } = loadTs("src/lib/aiAllowancePolicy.ts");
  assert.equal(
    aiAllowancePeriod(new Date("2026-08-31T23:59:59.000Z")).key,
    "2026-08",
  );
  assert.equal(
    aiAllowancePeriod(new Date("2026-09-01T00:00:00.000Z")).key,
    "2026-09",
  );
});

test("shared allowance reservations reject concurrent spend above the team cap", async () => {
  const redis = fakeRedis();
  useRedis(redis);

  const previousFetch = global.fetch;
  global.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith("/models")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "test/expensive",
              pricing: { input: "0", output: "0.00005" },
            },
          ],
        }),
      );
    }
    if (value.includes("/report?")) {
      return new Response(JSON.stringify({ results: [] }));
    }
    throw new Error(`Unexpected fetch ${value}`);
  };

  try {
    const { createSharedAllowanceMiddleware } = loadTs(
      "src/app/api/ai/_lib/sharedAllowance.ts",
    );
    const middleware = createSharedAllowanceMiddleware({
      allowanceUsd: 1,
      gatewayApiKey: "vck_shared",
      modelSlug: "test/expensive",
    });
    const params = {
      maxOutputTokens: 10_000,
      prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      providerOptions: { gateway: { tags: ["chat", "team:team-1"] } },
    };

    let finishFirst;
    const first = middleware.wrapGenerate({
      params,
      model: {},
      doStream: async () => {
        throw new Error("unused");
      },
      doGenerate: () =>
        new Promise((resolve) => {
          finishFirst = () =>
            resolve({
              content: [],
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: { total: 0 },
                outputTokens: { total: 0 },
              },
              warnings: [],
            });
        }),
    });

    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(
      middleware.wrapGenerate({
        params,
        model: {},
        doStream: async () => {
          throw new Error("unused");
        },
        doGenerate: async () => {
          throw new Error("must not start inference");
        },
      }),
      /used its included AI allowance/,
    );
    finishFirst();
    await first;
  } finally {
    global.fetch = previousFetch;
  }
});

test("shared allowance fails closed when the team tag is absent", async () => {
  const redis = fakeRedis();
  useRedis(redis);
  const { createSharedAllowanceMiddleware } = loadTs(
    "src/app/api/ai/_lib/sharedAllowance.ts",
  );
  const middleware = createSharedAllowanceMiddleware({
    allowanceUsd: 1,
    gatewayApiKey: "vck_shared",
    modelSlug: "test/expensive",
  });

  await assert.rejects(
    middleware.wrapGenerate({
      params: { prompt: [], providerOptions: { gateway: { tags: ["chat"] } } },
      model: {},
      doStream: async () => {
        throw new Error("unused");
      },
      doGenerate: async () => {
        throw new Error("must not start inference");
      },
    }),
    /exactly one owning team tag/,
  );
});

test("platform-funded calls always enforce the reservation output bound", async () => {
  const { createSharedAllowanceMiddleware } = loadTs(
    "src/app/api/ai/_lib/sharedAllowance.ts",
  );
  const middleware = createSharedAllowanceMiddleware({
    allowanceUsd: 1,
    gatewayApiKey: "vck_shared",
    modelSlug: "test/model",
  });

  const withoutLimit = await middleware.transformParams({
    type: "generate",
    params: { prompt: [] },
    model: {},
  });
  assert.equal(withoutLimit.maxOutputTokens, 16_000);

  const excessiveLimit = await middleware.transformParams({
    type: "stream",
    params: { prompt: [], maxOutputTokens: 100_000 },
    model: {},
  });
  assert.equal(excessiveLimit.maxOutputTokens, 16_000);

  const lowerLimit = await middleware.transformParams({
    type: "generate",
    params: { prompt: [], maxOutputTokens: 500 },
    model: {},
  });
  assert.equal(lowerLimit.maxOutputTokens, 500);
});

test("observed month-to-date spend blocks inference when the cap is exhausted", async () => {
  const redis = fakeRedis();
  useRedis(redis);
  const previousFetch = global.fetch;
  global.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith("/models")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "test/expensive",
              pricing: { input: "0", output: "0.00005" },
            },
          ],
        }),
      );
    }
    if (value.includes("/report?")) {
      return new Response(
        JSON.stringify({
          results: [{ tag: "team:exhausted-team", total_cost: 1 }],
        }),
      );
    }
    throw new Error(`Unexpected fetch ${value}`);
  };

  try {
    const { createSharedAllowanceMiddleware } = loadTs(
      "src/app/api/ai/_lib/sharedAllowance.ts",
    );
    const middleware = createSharedAllowanceMiddleware({
      allowanceUsd: 1,
      gatewayApiKey: "vck_shared",
      modelSlug: "test/expensive",
    });
    await assert.rejects(
      middleware.wrapGenerate({
        params: {
          maxOutputTokens: 1,
          prompt: [],
          providerOptions: { gateway: { tags: ["team:exhausted-team"] } },
        },
        model: {},
        doStream: async () => {
          throw new Error("unused");
        },
        doGenerate: async () => {
          throw new Error("must not start inference");
        },
      }),
      /used its included AI allowance/,
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("automatic feature spend does not consume the customer-visible allowance", async () => {
  const redis = fakeRedis();
  useRedis(redis);
  const previousFetch = global.fetch;
  global.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith("/models")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "test/expensive",
              pricing: { input: "0", output: "0.00005" },
            },
          ],
        }),
      );
    }
    if (value.includes("/report?")) {
      return new Response(
        JSON.stringify({
          results: [
            { tag: "team:split-team", total_cost: 1 },
            { tag: "summary", total_cost: 1 },
          ],
        }),
      );
    }
    throw new Error(`Unexpected fetch ${value}`);
  };

  try {
    const { createSharedAllowanceMiddleware } = loadTs(
      "src/app/api/ai/_lib/sharedAllowance.ts",
    );
    const middleware = createSharedAllowanceMiddleware({
      allowanceUsd: 1,
      gatewayApiKey: "vck_shared",
      modelSlug: "test/expensive",
    });
    const result = await middleware.wrapGenerate({
      params: {
        maxOutputTokens: 1,
        prompt: [],
        providerOptions: {
          gateway: { tags: ["chat", "team:split-team"] },
        },
      },
      model: {},
      doStream: async () => {
        throw new Error("unused");
      },
      doGenerate: async () => ({
        content: [],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 0 },
          outputTokens: { total: 0 },
        },
        warnings: [],
      }),
    });

    assert.deepEqual(result.content, []);
    assert.ok(
      [...redis.values.keys()].some((key) =>
        key.endsWith(":split-team:committed"),
      ),
    );
    assert.ok(
      [...redis.values.keys()].some((key) =>
        key.endsWith(":split-team:system:committed"),
      ),
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("system split preserves legacy committed spend and active reservations", async () => {
  const redis = fakeRedis();
  useRedis(redis);
  const { aiAllowancePeriod } = loadTs("src/lib/aiAllowancePolicy.ts");
  const month = aiAllowancePeriod().key;
  const committedKey = `ai-allowance:${month}:migration-team:committed`;
  const reservationsKey = `ai-allowance:${month}:migration-team:reservations`;
  redis.values.set(committedKey, "1000000");
  redis.reservations.set(
    reservationsKey,
    new Map([["legacy-request|200000", Date.now() + 60_000]]),
  );

  const previousFetch = global.fetch;
  let reportCaughtUp = false;
  global.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith("/models")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "test/expensive",
              pricing: { input: "0", output: "0.00005" },
            },
          ],
        }),
      );
    }
    if (value.includes("/report?")) {
      return new Response(
        JSON.stringify({
          results: reportCaughtUp
            ? [
                { tag: "team:migration-team", total_cost: 1 },
                { tag: "summary", total_cost: 0.1 },
              ]
            : [{ tag: "team:migration-team", total_cost: 0.9 }],
        }),
      );
    }
    throw new Error(`Unexpected fetch ${value}`);
  };

  try {
    const { createSharedAllowanceMiddleware } = loadTs(
      "src/app/api/ai/_lib/sharedAllowance.ts",
    );
    const middleware = createSharedAllowanceMiddleware({
      allowanceUsd: 1,
      gatewayApiKey: "vck_shared",
      modelSlug: "test/expensive",
    });
    await assert.rejects(
      middleware.wrapGenerate({
        params: {
          maxOutputTokens: 1,
          prompt: [],
          providerOptions: {
            gateway: { tags: ["chat", "team:migration-team"] },
          },
        },
        model: {},
        doStream: async () => {
          throw new Error("unused");
        },
        doGenerate: async () => {
          throw new Error("must not start inference");
        },
      }),
      /used its included AI allowance/,
    );

    assert.equal(redis.values.get(committedKey), "900000");
    assert.equal(redis.reservations.get(reservationsKey)?.size, 1);

    redis.reservations.get(reservationsKey)?.clear();
    const initializedKey = [...redis.values.keys()].find((key) =>
      key.endsWith(":migration-team:system-split-v1"),
    );
    assert.ok(initializedKey);
    redis.values.set(
      initializedKey,
      String(Date.now() - LEGACY_RECONCILIATION_TEST_AGE_MS),
    );
    reportCaughtUp = true;

    const result = await middleware.wrapGenerate({
      params: {
        maxOutputTokens: 1,
        prompt: [],
        providerOptions: {
          gateway: { tags: ["chat", "team:migration-team"] },
        },
      },
      model: {},
      doStream: async () => {
        throw new Error("unused");
      },
      doGenerate: async () => ({
        content: [],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 0 },
          outputTokens: { total: 0 },
        },
        warnings: [],
      }),
    });
    assert.deepEqual(result.content, []);
    const pendingKey = [...redis.values.keys()].find((key) =>
      key.endsWith(":migration-team:legacy-pending"),
    );
    assert.equal(redis.values.get(pendingKey), "0");
  } finally {
    global.fetch = previousFetch;
  }
});

test("automatic features use a separate ten-times internal ceiling", async () => {
  const redis = fakeRedis();
  useRedis(redis);
  const previousFetch = global.fetch;
  global.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith("/models")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "test/expensive",
              pricing: { input: "0", output: "0.00005" },
            },
          ],
        }),
      );
    }
    if (value.includes("/report?")) {
      return new Response(
        JSON.stringify({
          results: [
            { tag: "team:system-cap-team", total_cost: 10 },
            { tag: "included-with-hypertask", total_cost: 10 },
            { tag: "summary", total_cost: 10 },
          ],
        }),
      );
    }
    throw new Error(`Unexpected fetch ${value}`);
  };

  try {
    const { createSharedAllowanceMiddleware } = loadTs(
      "src/app/api/ai/_lib/sharedAllowance.ts",
    );
    const middleware = createSharedAllowanceMiddleware({
      allowanceUsd: 1,
      gatewayApiKey: "vck_shared",
      modelSlug: "test/expensive",
    });
    await assert.rejects(
      middleware.wrapGenerate({
        params: {
          maxOutputTokens: 1,
          prompt: [],
          providerOptions: {
            gateway: {
              tags: [
                "summary",
                "included-with-hypertask",
                "team:system-cap-team",
              ],
            },
          },
        },
        model: {},
        doStream: async () => {
          throw new Error("unused");
        },
        doGenerate: async () => {
          throw new Error("must not start inference");
        },
      }),
      /used its included AI allowance/,
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("managed-team allowance uses its paid cap for atomic reservations", async () => {
  const redis = fakeRedis();
  useRedis(redis);

  const previousFetch = global.fetch;
  global.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith("/models")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "test/expensive",
              pricing: { input: "0", output: "0.00005" },
            },
          ],
        }),
      );
    }
    if (value.includes("/report?")) {
      return new Response(JSON.stringify({ results: [] }));
    }
    throw new Error(`Unexpected fetch ${value}`);
  };

  try {
    const { createSharedAllowanceMiddleware } = loadTs(
      "src/app/api/ai/_lib/sharedAllowance.ts",
    );
    const middleware = createSharedAllowanceMiddleware({
      allowanceUsd: 40,
      gatewayApiKey: "vck_managed",
      modelSlug: "test/expensive",
    });
    const params = {
      maxOutputTokens: 500_000,
      prompt: [],
      providerOptions: { gateway: { tags: ["chat", "team:paid-team"] } },
    };

    let finishFirst;
    const first = middleware.wrapGenerate({
      params,
      model: {},
      doStream: async () => {
        throw new Error("unused");
      },
      doGenerate: () =>
        new Promise((resolve) => {
          finishFirst = () =>
            resolve({
              content: [],
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: { total: 0 },
                outputTokens: { total: 0 },
              },
              warnings: [],
            });
        }),
    });

    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(
      middleware.wrapGenerate({
        params,
        model: {},
        doStream: async () => {
          throw new Error("unused");
        },
        doGenerate: async () => {
          throw new Error("must not start inference");
        },
      }),
      /used its included AI allowance/,
    );
    finishFirst();
    await first;
  } finally {
    global.fetch = previousFetch;
  }
});

test("expired reservations remain charged and late settlement cannot double-charge", async () => {
  const redis = fakeRedis();
  useRedis(redis);
  const previousFetch = global.fetch;
  global.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith("/models")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "test/expensive",
              pricing: { input: "0", output: "0.00005" },
            },
          ],
        }),
      );
    }
    if (value.includes("/report?")) {
      return new Response(JSON.stringify({ results: [] }));
    }
    throw new Error(`Unexpected fetch ${value}`);
  };

  try {
    const { createSharedAllowanceMiddleware } = loadTs(
      "src/app/api/ai/_lib/sharedAllowance.ts",
    );
    const middleware = createSharedAllowanceMiddleware({
      allowanceUsd: 1,
      gatewayApiKey: "vck_shared",
      modelSlug: "test/expensive",
    });
    const params = {
      maxOutputTokens: 10_000,
      prompt: [],
      providerOptions: { gateway: { tags: ["team:crashed-team"] } },
    };
    let finishFirst;
    const first = middleware.wrapGenerate({
      params,
      model: {},
      doStream: async () => {
        throw new Error("unused");
      },
      doGenerate: () =>
        new Promise((resolve) => {
          finishFirst = () =>
            resolve({
              content: [],
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: { total: 0 },
                outputTokens: { total: 0 },
              },
              warnings: [],
            });
        }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    for (const active of redis.reservations.values()) {
      for (const member of active.keys()) active.set(member, 0);
    }
    await assert.rejects(
      middleware.wrapGenerate({
        params,
        model: {},
        doStream: async () => {
          throw new Error("unused");
        },
        doGenerate: async () => {
          throw new Error("must not start inference");
        },
      }),
      /used its included AI allowance/,
    );
    const committedKey = [...redis.values.keys()].find((key) =>
      key.endsWith(":crashed-team:committed"),
    );
    const committedBeforeLateFinish = Number(redis.values.get(committedKey));
    finishFirst();
    await first;
    assert.equal(
      Number(redis.values.get(committedKey)),
      committedBeforeLateFinish,
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("failed provider calls conservatively consume their reservation", async () => {
  const redis = fakeRedis();
  useRedis(redis);
  const previousFetch = global.fetch;
  global.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith("/models")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "test/expensive",
              pricing: { input: "0", output: "0.00005" },
            },
          ],
        }),
      );
    }
    if (value.includes("/report?")) {
      return new Response(JSON.stringify({ results: [] }));
    }
    throw new Error(`Unexpected fetch ${value}`);
  };

  try {
    const { createSharedAllowanceMiddleware } = loadTs(
      "src/app/api/ai/_lib/sharedAllowance.ts",
    );
    const middleware = createSharedAllowanceMiddleware({
      allowanceUsd: 1,
      gatewayApiKey: "vck_shared",
      modelSlug: "test/expensive",
    });
    const request = () =>
      middleware.wrapGenerate({
        params: {
          maxOutputTokens: 10_000,
          prompt: [],
          providerOptions: { gateway: { tags: ["team:failed-team"] } },
        },
        model: {},
        doStream: async () => {
          throw new Error("unused");
        },
        doGenerate: async () => {
          throw new Error("provider failed after starting");
        },
      });

    await assert.rejects(request(), /provider failed after starting/);
    await assert.rejects(request(), /used its included AI allowance/);
  } finally {
    global.fetch = previousFetch;
  }
});

test("settlement failures retain the reservation against the cap", async () => {
  const redis = fakeRedis();
  const originalEval = redis.eval;
  redis.eval = async (...args) => {
    if (args.length < 9) {
      throw new Error("Redis settlement unavailable");
    }
    return originalEval(...args);
  };
  useRedis(redis);
  const previousFetch = global.fetch;
  global.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith("/models")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "test/expensive",
              pricing: { input: "0", output: "0.00005" },
            },
          ],
        }),
      );
    }
    if (value.includes("/report?")) {
      return new Response(JSON.stringify({ results: [] }));
    }
    throw new Error(`Unexpected fetch ${value}`);
  };

  try {
    const { createSharedAllowanceMiddleware } = loadTs(
      "src/app/api/ai/_lib/sharedAllowance.ts",
    );
    const middleware = createSharedAllowanceMiddleware({
      allowanceUsd: 1,
      gatewayApiKey: "vck_shared",
      modelSlug: "test/expensive",
    });
    const params = {
      maxOutputTokens: 10_000,
      prompt: [],
      providerOptions: { gateway: { tags: ["team:settlement-team"] } },
    };
    const result = await middleware.wrapGenerate({
      params,
      model: {},
      doStream: async () => {
        throw new Error("unused");
      },
      doGenerate: async () => ({
        content: [],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 0 },
          outputTokens: { total: 0 },
        },
        warnings: [],
      }),
    });
    assert.deepEqual(result.content, []);
    await assert.rejects(
      middleware.wrapGenerate({
        params,
        model: {},
        doStream: async () => {
          throw new Error("unused");
        },
        doGenerate: async () => {
          throw new Error("must not start inference");
        },
      }),
      /used its included AI allowance/,
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("platform-funded image calls reserve from the same team allowance", async () => {
  const redis = fakeRedis();
  useRedis(redis);
  const previousFetch = global.fetch;
  global.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith("/models")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "test/expensive",
              pricing: { input: "0", output: "0.00005" },
            },
          ],
        }),
      );
    }
    if (value.includes("/report?")) {
      return new Response(JSON.stringify({ results: [] }));
    }
    throw new Error(`Unexpected fetch ${value}`);
  };

  try {
    const { createImageAllowanceMiddleware } = loadTs(
      "src/app/api/ai/_lib/sharedAllowance.ts",
    );
    const middleware = createImageAllowanceMiddleware({
      allowanceUsd: 2,
      gatewayApiKey: "vck_managed",
      modelSlug: "test/expensive",
    });
    const params = {
      n: 1,
      prompt: "draw a task board",
      providerOptions: {
        gateway: { tags: ["generate-image", "team:image-team"] },
      },
    };
    let finishFirst;
    const first = middleware.wrapGenerate({
      params,
      model: {},
      doGenerate: () =>
        new Promise((resolve) => {
          finishFirst = () =>
            resolve({
              images: ["image"],
              response: {
                timestamp: new Date(),
                modelId: "test/expensive",
                headers: undefined,
              },
              usage: undefined,
              warnings: [],
            });
        }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(
      middleware.wrapGenerate({
        params,
        model: {},
        doGenerate: async () => {
          throw new Error("must not start inference");
        },
      }),
      /used its included AI allowance/,
    );
    finishFirst();
    await first;
  } finally {
    global.fetch = previousFetch;
  }
});

test("price tiers two and three are premium while tier one stays included", () => {
  const { isPremiumAiModelKey } = loadTs("src/lib/aiModelOptions.ts");
  assert.equal(isPremiumAiModelKey("gpt-5.4-mini"), false);
  assert.equal(isPremiumAiModelKey("gpt-5.6-luna"), true);
  assert.equal(isPremiumAiModelKey("gpt-5.5"), true);
});
