const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");

function loadKeys(plan, rows) {
  return loadModule("src/app/api/ai/_lib/byokKeys.ts", {
    "@/lib/prisma": {
      default: {
        teamByokApiKey: {
          findUnique: async ({ where }) => rows[where.teamId_provider.provider] ?? null,
          deleteMany: async () => ({ count: 0 }),
        },
      },
    },
    "@/lib/crypto/byokCipher": {
      decryptByokSecret: (ciphertext) => ciphertext,
    },
    "@/app/api/ai/_lib/planGate": {
      backgroundClaudeModelEnabled: async () => false,
      haiku55ModelEnabled: async () => false,
      storePlanIdForProject: async () => plan,
    },
  });
}

function row(id, ciphertext, enabled, updatedAt) {
  return {
    id,
    enabled,
    ciphertext,
    updatedAt: new Date(updatedAt),
    team: { aiProviderSettings: null },
  };
}

test("platform env names stay in sync with the managed key registry", () => {
  const registry = JSON.parse(fs.readFileSync(path.join(root, "config/managed-team-gateway-keys.json"), "utf8"));
  const expected = [...new Set(registry.map((item) => item.credentialEnv))].sort();
  const source = fs.readFileSync(path.join(root, "src/app/api/ai/_lib/byokKeys.ts"), "utf8");
  const match = source.match(/const PLATFORM_GATEWAY_ENV_NAMES = \[([\s\S]*?)\] as const;/);
  assert.ok(match);
  const actual = [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]).sort();
  assert.deepEqual(actual, expected);
});

test("legacy gateway rows classify our keys as capped and leave customer keys alone", async () => {
  const previousShared = process.env.AI_GATEWAY_API_KEY;
  const previousPlatform = process.env.GATEWAY_KEY_HYPERTASK;
  try {
    process.env.AI_GATEWAY_API_KEY = "vck_shared_not_this_team";
    delete process.env.GATEWAY_KEY_HYPERTASK;

    const same = "vck_legacy_same_as_managed";
    const sameKeys = loadKeys("Pro", {
      gateway: row("legacy-row", same, true, "2026-01-02T00:00:00Z"),
      managed_gateway: row("managed-row", same, true, "2026-03-04T00:00:00Z"),
    });
    assert.deepEqual(
      await sameKeys.getTeamGatewayFunding({ trustedTeamId: "paid-team" }, { includeProvenance: true }),
      {
        apiKey: same,
        source: "managed",
        managedKeyId: "managed-row",
        managedKeyUpdatedAt: "2026-03-04T00:00:00.000Z",
      },
    );

    process.env.AI_GATEWAY_API_KEY = "vck_shared_not_the_customer";
    const customer = "vck_real_customer_gateway";
    const customerKeys = loadKeys("BYOK", {
      gateway: row("customer-row", customer, true, "2026-02-02T00:00:00Z"),
      managed_gateway: row("managed-row", "vck_our_managed_gateway", true, "2026-02-03T00:00:00Z"),
    });
    assert.deepEqual(await customerKeys.getTeamGatewayFunding({ trustedTeamId: "byok-team" }), {
      apiKey: customer,
      source: "customer",
    });

    const disabled = "vck_disabled_managed";
    const disabledKeys = loadKeys("Pro", {
      gateway: row("legacy-row", disabled, true, "2026-02-02T00:00:00Z"),
      managed_gateway: row("managed-row", disabled, false, "2026-02-03T00:00:00Z"),
    });
    assert.equal(await disabledKeys.getTeamGatewayFunding({ trustedTeamId: "paid-team" }), undefined);

    const platform = "vck_platform_leftover";
    process.env.GATEWAY_KEY_HYPERTASK = platform;
    process.env.AI_GATEWAY_API_KEY = "vck_shared_not_the_platform_key";
    const platformKeys = loadKeys("Pro", {
      gateway: row("legacy-row", platform, true, "2026-05-01T00:00:00Z"),
    });
    const platformFunding = await platformKeys.getTeamGatewayFunding(
      { trustedTeamId: "paid-team" },
      { includeProvenance: true },
    );
    assert.equal(platformFunding.source, "managed");
    assert.equal(platformFunding.apiKey, platform);
    assert.equal(platformFunding.managedKeyId, "legacy-row");

    const slot = "vck_customer_openai_slot";
    const slotKeys = loadKeys("BYOK", {
      openai: row("customer-openai", slot, true, "2026-01-01T00:00:00Z"),
    });
    assert.equal(await slotKeys.getTeamGatewayApiKey({ trustedTeamId: "byok-team" }), slot);
    assert.equal(
      (await slotKeys.getTeamGatewayFunding({ trustedTeamId: "byok-team" })).source,
      "customer",
    );
  } finally {
    if (previousShared === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previousShared;
    if (previousPlatform === undefined) delete process.env.GATEWAY_KEY_HYPERTASK;
    else process.env.GATEWAY_KEY_HYPERTASK = previousPlatform;
  }
});
