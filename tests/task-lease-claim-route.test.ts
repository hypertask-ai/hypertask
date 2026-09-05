import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";

const USER_ID = 6;
const TASK_ID = 35836;
const AGENT_A = "11111111-1111-4111-8111-111111111111";
const AGENT_B = "22222222-2222-4222-8222-222222222222";
const AGENT_C = "33333333-3333-4333-8333-333333333333";

process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";
process.env.JWT_SECRET = randomBytes(32).toString("hex");
process.env.JWT_ISSUER = "task-lease-claim-test";
process.env.SESSION_SECRET = randomBytes(32).toString("hex");

async function main() {
  const [{ default: prisma }, { createMcpToken, agentTokenCredentialFields }, { POST }] =
    await Promise.all([
      import("../src/lib/prisma"),
      import("../src/lib/mcp/auth"),
      import("../src/app/api/mcp/tasks/lease/claim/route"),
    ]);

  const prismaMock = prisma as any;
  const globalWithRedis = globalThis as typeof globalThis & {
    redis?: { incr(key: string): Promise<number>; expire(key: string, seconds: number): Promise<number> };
  };
  const originalRedis = globalWithRedis.redis;
  const originals = {
    userFindUnique: prismaMock.user.findUnique,
    revokedTokenFindFirst: prismaMock.revokedToken.findFirst,
    agentFindFirst: prismaMock.agent.findFirst,
    logsCreate: prismaMock.logs.create,
    taskFindFirst: prismaMock.task.findFirst,
    taskFindUnique: prismaMock.task.findUnique,
    queryRaw: prismaMock.$queryRaw,
    transaction: prismaMock.$transaction,
  };

  const tokens = new Map<string, { userId: number; token: string; credentials: ReturnType<typeof agentTokenCredentialFields> }>();
  for (const [agentId, userId] of [
    [AGENT_A, USER_ID],
    [AGENT_B, USER_ID],
    [AGENT_C, 7],
  ] as const) {
    const token = createMcpToken(userId, `user-${userId}@example.com`, undefined, agentId);
    tokens.set(agentId, { userId, token, credentials: agentTokenCredentialFields(token) });
  }

  let taskAccessible = true;
  let taskStatus = "Normal";
  let conflictAgentId: string | null = AGENT_A;
  let claimSucceeds = false;
  let claimedLeaseToken: string | null = null;

  function request(agentId: string) {
    const token = tokens.get(agentId)?.token;
    assert.ok(token);
    return new NextRequest("http://localhost/api/mcp/tasks/lease/claim", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ task_id: TASK_ID, ttl_seconds: 300 }),
    });
  }

  function requestWithLeaseToken(agentId: string, leaseToken: string) {
    claimedLeaseToken = leaseToken;
    const token = tokens.get(agentId)?.token;
    assert.ok(token);
    return new NextRequest("http://localhost/api/mcp/tasks/lease/claim", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task_id: TASK_ID,
        ttl_seconds: 300,
        lease_token: leaseToken,
      }),
    });
  }

  async function responseJson(response: Response) {
    return response.json() as Promise<Record<string, any>>;
  }

  function installMocks() {
    globalWithRedis.redis = {
      incr: async () => 1,
      expire: async () => 1,
    };
    prismaMock.user.findUnique = async ({ where }: any) => ({
      id: where.id,
      email: `user-${where.id}@example.com`,
      displayName: "Test user",
      mcpTokensRevokedAt: null,
    });
    prismaMock.revokedToken.findFirst = async () => null;
    prismaMock.agent.findFirst = async ({ where }: any) => {
      const entry = tokens.get(where.id);
      if (!entry || entry.userId !== where.userId) return null;
      return {
        id: where.id,
        ...entry.credentials,
        runtimeGeneration: 1,
      };
    };
    prismaMock.logs.create = async () => ({ id: 1 });
    prismaMock.task.findFirst = async () =>
      taskAccessible ? { id: TASK_ID, projectId: 15 } : null;
    prismaMock.task.findUnique = async () => ({ status: taskStatus });
    prismaMock.$queryRaw = async () => [
      { holder: USER_ID, agentId: conflictAgentId },
    ];
    prismaMock.$transaction = async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        $executeRaw: async () => 1,
        task: { findUnique: async () => ({ status: taskStatus }) },
        assignees: {
          findMany: async () => [],
          findFirst: async () => null,
        },
        $queryRaw: async () =>
          claimSucceeds
            ? [{
                taskId: TASK_ID,
                holder: USER_ID,
                agentId: AGENT_A,
                token: claimedLeaseToken,
                expiresAt: new Date("2026-09-01T02:00:00.000Z"),
                heartbeatAt: new Date("2026-09-01T01:55:00.000Z"),
              }]
            : [],
      });
  }

  installMocks();

  test.after(() => {
    globalWithRedis.redis = originalRedis;
    prismaMock.user.findUnique = originals.userFindUnique;
    prismaMock.revokedToken.findFirst = originals.revokedTokenFindFirst;
    prismaMock.agent.findFirst = originals.agentFindFirst;
    prismaMock.logs.create = originals.logsCreate;
    prismaMock.task.findFirst = originals.taskFindFirst;
    prismaMock.task.findUnique = originals.taskFindUnique;
    prismaMock.$queryRaw = originals.queryRaw;
    prismaMock.$transaction = originals.transaction;
  });

  test.beforeEach(() => {
    taskAccessible = true;
    taskStatus = "Normal";
    conflictAgentId = AGENT_A;
    claimSucceeds = false;
    claimedLeaseToken = null;
  });

  test("lease conflicts identify the exact authenticated agent holding the lease", async () => {
    const selfResponse = await POST(request(AGENT_A));
    const selfPayload = await responseJson(selfResponse);
    assert.equal(selfResponse.status, 409);
    assert.equal(selfPayload.lease.holder, "current_user");
    assert.equal(selfPayload.lease.agentId, AGENT_A);

    const siblingResponse = await POST(request(AGENT_B));
    const siblingPayload = await responseJson(siblingResponse);
    assert.equal(siblingResponse.status, 409);
    assert.equal(siblingPayload.lease.holder, "another_user");
    assert.equal(siblingPayload.lease.agentId, AGENT_A);
  });

  test("legacy leases cannot be mistaken for the calling agent", async () => {
    conflictAgentId = null;
    const response = await POST(request(AGENT_A));
    const payload = await responseJson(response);
    assert.equal(response.status, 409);
    assert.equal(payload.lease.holder, "another_user");
    assert.equal(payload.lease.agentId, null);
  });

  test("an expired lease is replaced instead of disclosed as a conflict", async () => {
    claimSucceeds = true;
    const response = await POST(request(AGENT_A));
    const payload = await responseJson(response);
    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.lease.agentId, AGENT_A);
  });

  test("lease claims return the caller's instance token", async () => {
    claimSucceeds = true;
    const response = await POST(requestWithLeaseToken(AGENT_A, AGENT_C));
    const payload = await responseJson(response);
    assert.equal(response.status, 200);
    assert.equal(payload.lease.leaseToken, AGENT_C);
  });

  test("lease claims reject malformed instance tokens", async () => {
    const response = await POST(
      requestWithLeaseToken(AGENT_A, "not-a-token"),
    );
    const payload = await responseJson(response);
    assert.equal(response.status, 400);
    assert.match(payload.error, /lease_token/);
  });

  test("an archived task can still acquire a lease so an agent can restore it", async () => {
    taskStatus = "Archive";
    claimSucceeds = true;
    const response = await POST(request(AGENT_A));
    const payload = await responseJson(response);
    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.lease.agentId, AGENT_A);
  });

  test("a deleted task refuses a lease with a lifecycle error", async () => {
    taskStatus = "Deleted";
    const response = await POST(request(AGENT_A));
    const payload = await responseJson(response);
    assert.equal(response.status, 409);
    assert.equal(payload.error, "Task lifecycle precondition failed");
    assert.match(payload.message, /Deleted tasks/);
  });

  test("an agent from another user cannot inspect an inaccessible lease", async () => {
    taskAccessible = false;
    const response = await POST(request(AGENT_C));
    const payload = await responseJson(response);
    assert.equal(response.status, 404);
    assert.equal(payload.lease, undefined);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
