// Assert-based test because this repository has no Vitest setup.
// Run after installing dependencies: npx tsx tests/archive-draft-api.test.ts
import assert from "node:assert/strict";
import type { NextApiRequest, NextApiResponse } from "next";

type TestResponse = NextApiResponse & {
  statusCode: number;
  body: unknown;
};

const createResponse = () => {
  const response: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };

  return response as unknown as TestResponse;
};

const createRequest = (
  body: unknown,
  sessionCookie?: string,
  method = "POST",
  claimedUserId = 6,
) =>
  ({
    method,
    body,
    cookies: {
      ht_session: sessionCookie,
      nookies_user: JSON.stringify({ id: claimedUserId }),
    },
  }) as unknown as NextApiRequest;

async function run() {
  process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";
  process.env.SESSION_SECRET =
    "archive-draft-test-secret-at-least-32-characters";

  const [{ default: prisma }, { default: handler }, { signSession }] =
    await Promise.all([
      import("@/lib/prisma"),
      import("@/pages/api/drafts/archiveDraft"),
      import("@/lib/auth/session"),
    ]);
  const sessionCookie = signSession({ id: 6, email: "owner@example.com" });
  const prismaMock = prisma as any;
  const originalUpdateMany = prismaMock.drafts.updateMany;

  try {
    const methodResponse = createResponse();
    await handler(createRequest({}, sessionCookie, "GET"), methodResponse);
    assert.equal(methodResponse.statusCode, 405);

    const authResponse = createResponse();
    await handler(createRequest({ draftId: 42 }), authResponse);
    assert.equal(authResponse.statusCode, 401);

    const validationResponse = createResponse();
    await handler(
      createRequest({ draftId: 0 }, sessionCookie),
      validationResponse,
    );
    assert.equal(validationResponse.statusCode, 400);

    prismaMock.drafts.updateMany = async (args: unknown) => {
      assert.deepEqual(args, {
        where: { id: 42, userId: 6, type: "Comment" },
        data: { saved: true },
      });
      return { count: 1 };
    };
    const successResponse = createResponse();
    await handler(
      createRequest({ draftId: 42 }, sessionCookie, "POST", 999),
      successResponse,
    );
    assert.equal(successResponse.statusCode, 200);
    assert.deepEqual(successResponse.body, { success: true });

    prismaMock.drafts.updateMany = async () => ({ count: 0 });
    const missingResponse = createResponse();
    await handler(
      createRequest({ draftId: 43 }, sessionCookie),
      missingResponse,
    );
    assert.equal(missingResponse.statusCode, 404);
  } finally {
    prismaMock.drafts.updateMany = originalUpdateMany;
  }

  console.log("Archive draft API tests passed");
}

void run();
