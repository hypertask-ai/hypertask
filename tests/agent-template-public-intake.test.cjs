const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const state = {
  featureMode: "EVERYONE",
  sessionUserId: null,
  redisFailure: false,
  counts: new Map(),
  projectQueries: [],
  labelQueries: [],
  createTaskCalls: [],
};

stubModule("src/lib/auth/getSessionUser.ts", {
  getSessionUser: async () =>
    state.sessionUserId === null ? null : { userId: state.sessionUserId },
});

stubModule("src/lib/flags.ts", {
  HTPR_6502_AGENT_TEMPLATE_INTAKE_FLAG: "htpr-6502-agent-template-intake",
  isFeatureEnabled: async (_key, userId) =>
    state.featureMode === "EVERYONE" ||
    (state.featureMode === "OWNER_AND_QA" && [6, 985].includes(userId)) ||
    (state.featureMode === "OWNER_ONLY" && userId === 6),
});

stubModule("src/lib/redis.ts", {
  getRedis: async () => {
    if (state.redisFailure) throw new Error("redis unavailable");
    return {
      incr: async (key) => {
        const count = (state.counts.get(key) || 0) + 1;
        state.counts.set(key, count);
        return count;
      },
      expire: async () => 1,
    };
  },
});

stubModule("src/lib/prisma.ts", {
  default: {
    project: {
      findFirst: async (args) => {
        state.projectQueries.push(args);
        return {
          uniqueIdentifier: "AGTE",
          section: [{ id: 77, section_title: "Backlog" }],
          members: [{ agent: { id: "product-bot-agent", userId: 300 } }],
        };
      },
    },
  },
});

stubModule("src/utils/controllers/labels/index.ts", {
  labelStore: () => ({
    findMany: async (args) => {
      state.labelQueries.push(args);
      return [
        { id: "label-bug", value: "bug" },
        { id: "label-adapter", value: "adapter:hypertask" },
      ];
    },
  }),
});

stubModule("src/utils/controllers/tasks/createTaskCore.ts", {
  createTaskCore: async (options) => {
    state.createTaskCalls.push(options);
    return {
      task: { id: 999, ticketNumber: "AGTE-42", uniqueIndex: 42 },
      description: {},
    };
  },
});

const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  cache: false,
});
const { POST } = jiti(
  path.join(root, "src/app/api/agent-template/feedback/route.ts"),
);

function request(body, ip = "203.0.113.10", headers = {}) {
  return new NextRequest(
    "https://app.hypertask.ai/api/agent-template/feedback",
    {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        "x-real-ip": ip,
        ...headers,
      },
    },
  );
}

function validBody(overrides = {}) {
  return {
    title: "The setup drops correction details",
    body: "<p>Keep this correction.</p>",
    labels: ["bug", "adapter:hypertask"],
    ...overrides,
  };
}

test.beforeEach(() => {
  state.featureMode = "EVERYONE";
  state.sessionUserId = null;
  state.redisFailure = false;
  state.counts.clear();
  state.projectQueries.length = 0;
  state.labelQueries.length = 0;
  state.createTaskCalls.length = 0;
});

test("anonymous feedback is sanitized and created only in Agent Template Backlog", async () => {
  const response = await POST(
    request(
      validBody({
        body: '<p onclick="alert(1)">Keep this correction.</p><script>alert(2)</script>',
        labels: ["Bug", "adapter:hypertask", "bug"],
      }),
    ),
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(body, {
    success: true,
    task: {
      ticketNumber: "AGTE-42",
      url: "https://app.hypertask.ai/detail/project-5500/42",
    },
  });
  assert.deepEqual(state.projectQueries[0].where, {
    id: 5500,
    status: "Normal",
  });
  assert.deepEqual(state.projectQueries[0].select.section.where, {
    deleted: false,
    visibility: true,
    section_title: "Backlog",
  });
  assert.deepEqual(state.labelQueries[0].where, { projectId: 5500 });
  assert.equal(state.createTaskCalls.length, 1);
  assert.equal(state.createTaskCalls[0].projectId, 5500);
  assert.equal(state.createTaskCalls[0].sectionId, 77);
  assert.equal(state.createTaskCalls[0].sectionTitle, "Backlog");
  assert.equal(state.createTaskCalls[0].userId, 300);
  assert.equal(state.createTaskCalls[0].agentId, "product-bot-agent");
  assert.deepEqual(state.projectQueries[0].select.members.where, {
    status: "Accepted",
    agent: {
      is: { displayName: "Product Bot", revokedAt: null },
    },
  });
  assert.deepEqual(state.createTaskCalls[0].labelIds, [
    "label-bug",
    "label-adapter",
  ]);
  assert.equal(state.createTaskCalls[0].description, "<p>Keep this correction.</p>");
});

test("request data cannot choose another board or column", async () => {
  const response = await POST(
    request(validBody({ projectId: 15, section: "Done" })),
  );

  assert.equal(response.status, 400);
  assert.equal(state.projectQueries.length, 0);
  assert.equal(state.createTaskCalls.length, 0);
});

test("unknown labels are rejected instead of mutating the board label list", async () => {
  const response = await POST(
    request(validBody({ labels: ["bug", "new-public-label"] })),
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, "Unknown labels: new-public-label");
  assert.equal(state.createTaskCalls.length, 0);
});

test("title, HTML body, label list, and total request size are capped", async (t) => {
  await t.test("title", async () => {
    const response = await POST(
      request(validBody({ title: "x".repeat(81) }), "203.0.113.11"),
    );
    assert.equal(response.status, 400);
  });

  await t.test("HTML body", async () => {
    const response = await POST(
      request(validBody({ body: "x".repeat(20_001) }), "203.0.113.12"),
    );
    assert.equal(response.status, 400);
  });

  await t.test("labels", async () => {
    const response = await POST(
      request(
        validBody({ labels: Array.from({ length: 9 }, (_, index) => `l${index}`) }),
        "203.0.113.13",
      ),
    );
    assert.equal(response.status, 400);
  });

  await t.test("declared request bytes", async () => {
    const response = await POST(
      request(validBody(), "203.0.113.14", { "content-length": "32769" }),
    );
    assert.equal(response.status, 413);
  });

  await t.test("streamed request bytes", async () => {
    const response = await POST(
      request(JSON.stringify({ padding: "x".repeat(32 * 1024) }), "203.0.113.15"),
    );
    assert.equal(response.status, 413);
  });

  assert.equal(state.createTaskCalls.length, 0);
});

test("anonymous access stays hidden until the feature flag reaches Everyone", async () => {
  for (const mode of ["OFF", "OWNER_ONLY", "OWNER_AND_QA"]) {
    state.featureMode = mode;
    const response = await POST(request(validBody(), `203.0.113.${20 + state.counts.size}`));
    assert.equal(response.status, 404);
  }

  state.featureMode = "OWNER_AND_QA";
  state.sessionUserId = 6;
  const ownerResponse = await POST(request(validBody(), "203.0.113.30"));
  assert.equal(ownerResponse.status, 201);

  state.sessionUserId = null;
  state.featureMode = "EVERYONE";
  const publicResponse = await POST(request(validBody(), "203.0.113.31"));
  assert.equal(publicResponse.status, 201);
  assert.equal(state.createTaskCalls.length, 2);
});

test("each IP can create five tickets per hour", async () => {
  for (let index = 0; index < 5; index += 1) {
    const response = await POST(request(validBody(), "198.51.100.20"));
    assert.equal(response.status, 201);
  }

  const limited = await POST(request(validBody(), "198.51.100.20"));
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);

  const otherIp = await POST(request(validBody(), "198.51.100.21"));
  assert.equal(otherIp.status, 201);
  assert.equal(state.createTaskCalls.length, 6);
  assert.equal(
    [...state.counts.keys()].some((key) => key.includes("198.51.100")),
    false,
  );
});

test("rate limiting fails closed before any board write", async (t) => {
  const originalError = console.error;
  console.error = () => {};
  try {
    await t.test("when Redis is unavailable", async () => {
      state.redisFailure = true;
      const response = await POST(request(validBody()));
      assert.equal(response.status, 503);
      state.redisFailure = false;
    });

    await t.test("when Vercel does not provide a trusted IP", async () => {
      const response = await POST(
        request(validBody(), "", { "x-forwarded-for": "198.51.100.99" }),
      );
      assert.equal(response.status, 503);
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(state.projectQueries.length, 0);
  assert.equal(state.createTaskCalls.length, 0);
});
