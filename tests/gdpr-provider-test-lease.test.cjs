const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/gdpr-provider-test-lease.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  },
);
const {
  clearGdprProviderTestLease,
  getActiveGdprProviderTestLease,
  setGdprProviderTestLease,
} = jiti(path.join(root, "src/lib/aiProviders.ts"));

test("provider test leases are active only until their deadline", () => {
  const settings = setGdprProviderTestLease(
    { gdprSafeMode: false, providers: { google: true } },
    { id: "lease-1", expiresAt: 2_000 },
  );

  assert.deepEqual(getActiveGdprProviderTestLease(settings, 1_999), {
    id: "lease-1",
    expiresAt: 2_000,
  });
  assert.equal(getActiveGdprProviderTestLease(settings, 2_000), null);
});

test("only the owning test clears its lease", () => {
  const settings = setGdprProviderTestLease(
    {},
    {
      id: "lease-1",
      expiresAt: 2_000,
    },
  );

  assert.deepEqual(clearGdprProviderTestLease(settings, "lease-2"), settings);
  assert.deepEqual(clearGdprProviderTestLease(settings, "lease-1"), {});
});
