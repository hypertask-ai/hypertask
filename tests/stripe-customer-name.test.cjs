// HTPR-6862: Stripe customer names are shown to customers, so they must be readable.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { alias: { "@": path.join(root, "src") } });
const { stripeCustomerName } = jiti("@/lib/stripeCustomerName");

test("uses the first readable candidate", () => {
  assert.equal(stripeCustomerName(undefined, " Acme team "), "Acme team");
  assert.equal(stripeCustomerName("owner@example.com"), "owner@example.com");
});

test("never returns undefined or null as text, or a blank name", () => {
  assert.equal(stripeCustomerName(undefined), undefined);
  assert.equal(stripeCustomerName(String(undefined)), undefined);
  assert.equal(stripeCustomerName("null", "  ", 42), undefined);
});

test("no Stripe customer create glues an id onto the name", () => {
  const fs = require("node:fs");
  for (const file of [
    "src/lib/subscription.ts",
    "src/pages/api/teams/create.ts",
    "src/utils/controllers/users/provisionNewUser.ts",
    "src/utils/controllers/users/completeOnboardingStep.ts",
  ]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(source, /stripeCustomerName\(/, `${file} names customers through stripeCustomerName`);
    assert.doesNotMatch(source, /String\([^)]*email\)\s*\+/, `${file} must not glue an id onto an email`);
  }
});
