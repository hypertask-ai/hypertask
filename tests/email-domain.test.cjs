const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/email-domain-jiti-entry-${++jitiEntryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
    }
  );
  return jiti(path.join(root, relativePath));
}

test("normalizeDomain accepts a company domain, however it was typed", () => {
  const { normalizeDomain } = loadTs("src/lib/auth/emailDomain.ts");

  assert.deepEqual(normalizeDomain("acme.com"), { ok: true, domain: "acme.com" });
  assert.deepEqual(normalizeDomain("@Acme.COM"), { ok: true, domain: "acme.com" });
  assert.deepEqual(normalizeDomain("  acme.com "), { ok: true, domain: "acme.com" });
});

test("normalizeDomain refuses public providers, which would let any stranger auto-join a paid team", () => {
  const { normalizeDomain } = loadTs("src/lib/auth/emailDomain.ts");

  for (const provider of ["gmail.com", "@yahoo.com", "OUTLOOK.COM", "proton.me"]) {
    assert.equal(
      normalizeDomain(provider).ok,
      false,
      `${provider} must never be allowlistable`
    );
  }
});

test("normalizeDomain refuses anything that is not a bare domain", () => {
  const { normalizeDomain } = loadTs("src/lib/auth/emailDomain.ts");

  for (const bad of ["nodot", "@", "", "user@acme.com", null, 42]) {
    assert.equal(normalizeDomain(bad).ok, false, `${bad} must be rejected`);
  }
});

test("domainOfEmail matches the stored allowlist form, so a mixed-case signup still joins", () => {
  const { domainOfEmail } = loadTs("src/lib/auth/emailDomain.ts");

  assert.equal(domainOfEmail("Alice@ACME.com"), "acme.com");
  assert.equal(domainOfEmail("alice@acme.com"), "acme.com");
  assert.equal(domainOfEmail("not-an-email"), null);
});
