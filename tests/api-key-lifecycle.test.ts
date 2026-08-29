// Behavioural coverage for REST API key (htk_) expiry, rotation inputs, and
// the auth boundary that decides whether a key still authenticates.
// Run: npm run test:file -- tests/api-key-lifecycle.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { generateApiKey, hashApiKey } from "../src/lib/apiKeys";
import {
  API_KEY_MAX_EXPIRY_DAYS,
  activeApiKeyWhere,
  isApiKeyAuthLookup,
  isApiKeyUsable,
  resolveApiKeyExpiry,
  withApiKeyExpiryGuard,
} from "../src/lib/apiKeyExpiry";
import { rotateApiKeyInTransaction } from "../src/lib/apiKeyRotation";

const NOW = new Date("2026-08-19T12:00:00.000Z");
const day = 24 * 60 * 60 * 1000;

test("a key with no expiry and no revocation authenticates", () => {
  assert.equal(isApiKeyUsable({ revokedAt: null, expiresAt: null }, NOW), true);
});

test("a key stops authenticating once its expiry passes", () => {
  const future = new Date(NOW.getTime() + 1000);
  const past = new Date(NOW.getTime() - 1000);

  assert.equal(isApiKeyUsable({ expiresAt: future }, NOW), true);
  assert.equal(isApiKeyUsable({ expiresAt: past }, NOW), false);
});

test("an expiry exactly at the current instant counts as expired", () => {
  assert.equal(isApiKeyUsable({ expiresAt: new Date(NOW) }, NOW), false);
});

test("revocation beats a still-valid expiry", () => {
  assert.equal(
    isApiKeyUsable(
      { revokedAt: NOW, expiresAt: new Date(NOW.getTime() + 30 * day) },
      NOW,
    ),
    false,
  );
});

test("the shared lookup filter excludes revoked and expired keys", () => {
  const where = activeApiKeyWhere(NOW) as {
    revokedAt: null;
    OR: ({ expiresAt: null } | { expiresAt: { gt: Date } })[];
  };

  assert.equal(where.revokedAt, null);
  assert.deepEqual(where.OR, [{ expiresAt: null }, { expiresAt: { gt: NOW } }]);
});

test("omitting an expiry keeps the key non-expiring", () => {
  for (const input of [undefined, null]) {
    const result = resolveApiKeyExpiry(input, NOW);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.expiresAt, null);
  }
});

test("a day count becomes an absolute expiry that many days out", () => {
  const result = resolveApiKeyExpiry(90, NOW);
  assert.equal(result.ok, true);
  assert.equal(
    result.ok && result.expiresAt?.toISOString(),
    new Date(NOW.getTime() + 90 * day).toISOString(),
  );
});

test("the maximum lifetime is accepted and anything longer is rejected", () => {
  assert.equal(resolveApiKeyExpiry(API_KEY_MAX_EXPIRY_DAYS, NOW).ok, true);
  assert.equal(resolveApiKeyExpiry(API_KEY_MAX_EXPIRY_DAYS + 1, NOW).ok, false);
});

test("non-positive, fractional, and non-numeric lifetimes are rejected", () => {
  for (const input of [0, -1, 1.5, "30", {}, NaN, Infinity]) {
    const result = resolveApiKeyExpiry(input, NOW);
    assert.equal(result.ok, false, `expected ${String(input)} to be rejected`);
  }
});

test("generated keys are htk_ prefixed, unique, and stored only as a hash", () => {
  const first = generateApiKey();
  const second = generateApiKey();

  assert.match(first.key, /^htk_[A-Za-z0-9_-]{20,}$/);
  assert.notEqual(first.key, second.key);
  assert.equal(first.keyPrefix, first.key.slice(0, 12));
  assert.equal(first.keyHash, hashApiKey(first.key));
  assert.notEqual(first.keyHash, first.key);
});

test("a lookup by key hash is treated as authentication", () => {
  assert.equal(
    isApiKeyAuthLookup("ApiKey", "findFirst", { where: { keyHash: "abc" } }),
    true,
  );
  assert.equal(
    isApiKeyAuthLookup("ApiKey", "findUnique", { where: { keyHash: "abc" } }),
    true,
  );
});

test("management listings and other models are left alone", () => {
  // Settings must keep showing expired keys, so a userId listing is untouched.
  assert.equal(
    isApiKeyAuthLookup("ApiKey", "findMany", { where: { userId: 6 } }),
    false,
  );
  assert.equal(
    isApiKeyAuthLookup("ApiKey", "update", { where: { keyHash: "abc" } }),
    false,
  );
  assert.equal(
    isApiKeyAuthLookup("User", "findFirst", { where: { keyHash: "abc" } }),
    false,
  );
  assert.equal(isApiKeyAuthLookup("ApiKey", "findFirst", undefined), false);
  assert.equal(isApiKeyAuthLookup("ApiKey", "findFirst", { where: {} }), false);
});

test("the expiry guard preserves the caller's own filters", () => {
  const guarded = withApiKeyExpiryGuard(
    { keyHash: "abc", revokedAt: null },
    NOW,
  );

  assert.equal(guarded.keyHash, "abc");
  assert.equal(guarded.revokedAt, null);
  assert.deepEqual(guarded.AND, [
    { OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }] },
  ]);
});

test("the expiry guard never widens a caller's existing OR", () => {
  // Merged into a top-level OR, an expired key could satisfy the clause via the
  // caller's branch. AND keeps the guard mandatory.
  const guarded = withApiKeyExpiryGuard(
    { keyHash: "abc", OR: [{ revokedAt: null }] },
    NOW,
  );

  assert.deepEqual(guarded.OR, [{ revokedAt: null }]);
  assert.deepEqual(guarded.AND, [
    { OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }] },
  ]);
});

test("the expiry guard appends to an existing AND rather than replacing it", () => {
  const single = withApiKeyExpiryGuard(
    { keyHash: "abc", AND: { revokedAt: null } },
    NOW,
  );
  assert.equal(Array.isArray(single.AND), true);
  assert.equal((single.AND as unknown[]).length, 2);

  const many = withApiKeyExpiryGuard(
    { keyHash: "abc", AND: [{ revokedAt: null }, { userId: 6 }] },
    NOW,
  );
  assert.equal((many.AND as unknown[]).length, 3);
});

test("the active-key limit counts usable keys, not merely unrevoked ones", () => {
  // Expired keys cannot authenticate, so counting them would let ten lapsed
  // keys permanently block creating a working one.
  const route = readFileSync("src/app/api/users/api-keys/route.ts", "utf8");
  assert.match(route, /\.\.\.activeApiKeyWhere\(\)/);
  assert.doesNotMatch(
    route,
    /count\(\{\s*where: \{\s*userId: user\.id,\s*revokedAt: null,/,
  );
});

test("the Prisma client applies the expiry guard to every key lookup", () => {
  const client = readFileSync("src/lib/prisma.ts", "utf8");
  assert.match(client, /isApiKeyAuthLookup\(model, operation, args\)/);
  assert.match(client, /withApiKeyExpiryGuard\(\(args as any\)\.where\)/);
});

test("API key routes authenticate on the signed session, not the plain cookie", () => {
  const access = readFileSync("src/lib/apiKeyAccess.ts", "utf8");
  assert.match(access, /verifySession\(cookieStore\.get\(SESSION_COOKIE\)/);
  assert.match(access, /String\(session\.id\) !== String\(user\.id\)/);

  for (const route of [
    "src/app/api/users/api-keys/route.ts",
    "src/app/api/users/api-keys/[id]/route.ts",
    "src/app/api/users/api-keys/[id]/rotate/route.ts",
    "src/app/api/users/developer-access/route.ts",
  ]) {
    const source = readFileSync(route, "utf8");
    assert.match(source, /getApiKeyOwnerFromCookies\(\)/, route);
    assert.doesNotMatch(source, /isValidUser\(/, route);
  }
});

test("rotation revokes the old secret and issues the new one atomically", () => {
  const route = readFileSync(
    "src/app/api/users/api-keys/[id]/rotate/route.ts",
    "utf8",
  );
  assert.match(route, /prisma\.\$transaction\(/);
  assert.match(route, /rotateApiKeyInTransaction/);
  assert.match(route, /Revoked keys cannot be rotated/);
});

// A rotation store whose revoke only succeeds while the key is still active,
// which is what the conditional updateMany relies on in Postgres.
const rotationStore = () => {
  const state = { revoked: false, created: [] as string[] };
  const tx = {
    apiKey: {
      updateMany: async (args: any) => {
        const wantsActive = args.where.revokedAt === null;
        if (wantsActive && state.revoked) return { count: 0 };
        state.revoked = true;
        return { count: 1 };
      },
      create: async (args: any) => {
        state.created.push(args.data.keyHash);
        return { id: args.data.keyHash };
      },
    },
  };
  return { state, tx };
};

const rotationInput = (keyHash: string) => ({
  id: "key-1",
  userId: 6,
  name: "CLI",
  keyHash,
  keyPrefix: "htk_abc",
  expiresAt: null,
  now: NOW,
  select: {},
});

test("concurrent rotations mint exactly one replacement key", async () => {
  const { state, tx } = rotationStore();

  const [first, second] = await Promise.all([
    rotateApiKeyInTransaction(tx, rotationInput("hash-a")),
    rotateApiKeyInTransaction(tx, rotationInput("hash-b")),
  ]);

  // One request claims the key, the other is told to retry rather than being
  // handed a second simultaneously valid full-account secret.
  assert.equal(state.created.length, 1);
  assert.equal([first, second].filter(Boolean).length, 1);
});

test("a rotation that loses the race creates nothing", async () => {
  const { state, tx } = rotationStore();

  await rotateApiKeyInTransaction(tx, rotationInput("hash-a"));
  const loser = await rotateApiKeyInTransaction(tx, rotationInput("hash-b"));

  assert.equal(loser, null);
  assert.deepEqual(state.created, ["hash-a"]);
});

test("expiry enforcement survives a composed authentication query", () => {
  // A lookup that buries the hash under AND/OR must still be guarded, or an
  // expired key would authenticate through the composed path.
  assert.equal(
    isApiKeyAuthLookup("ApiKey", "findFirst", {
      where: { AND: [{ userId: 6 }, { OR: [{ keyHash: "hash" }] }] },
    }),
    true,
  );
  assert.equal(
    isApiKeyAuthLookup("ApiKey", "findFirst", {
      where: { AND: [{ userId: 6 }] },
    }),
    false,
  );
});

test("rotating an expired key requires a fresh lifetime", () => {
  const route = readFileSync(
    "src/app/api/users/api-keys/[id]/rotate/route.ts",
    "utf8",
  );
  assert.match(route, /Expired keys need an explicit expiresInDays/);
});

test("an empty patch cannot silently clear an expiry", () => {
  const route = readFileSync(
    "src/app/api/users/api-keys/[id]/route.ts",
    "utf8",
  );
  assert.match(route, /'expiresInDays' in body/);
  assert.match(route, /Body must be a JSON object/);
  assert.match(route, /revokedAt: null/);
});
