const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createHmac } = require("node:crypto");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(path.join(root, `tests/github-webhook-jiti-entry-${++jitiEntryId}.cjs`), {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  });
  return jiti(path.join(root, relativePath));
}

test("verifyGithubSignature accepts a valid signature and rejects everything else", () => {
  const { verifyGithubSignature } = loadTs(
    "src/app/api/webhooks/github/github-webhook-helpers.ts"
  );

  const secret = "github-webhook-test-secret";
  const rawBody = JSON.stringify({ action: "opened", value: 1 });
  const signature =
    "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

  assert.equal(verifyGithubSignature(rawBody, signature, secret), true);
  assert.equal(verifyGithubSignature(`${rawBody}tampered`, signature, secret), false);
  assert.equal(verifyGithubSignature(rawBody, undefined, secret), false);
  assert.equal(verifyGithubSignature(rawBody, "sha256=too-short", secret), false);
  // Fails closed: no secret configured must never validate, even with a well-formed header.
  assert.equal(verifyGithubSignature(rawBody, signature, undefined), false);
  assert.equal(verifyGithubSignature(rawBody, signature, ""), false);
});

test("extractTicketId checks branch, then title, then body, in that order", () => {
  const { extractTicketId } = loadTs(
    "src/app/api/webhooks/github/github-webhook-helpers.ts"
  );

  assert.equal(
    extractTicketId({
      title: "Improve GitHub integration",
      headRef: "feat/INNE-22-webhook",
      body: "Resolves PROD-8",
    }),
    "INNE-22"
  );
  assert.equal(
    extractTicketId({
      title: "Ship HTPR-4437",
      headRef: "feat/github-webhook",
      body: "Resolves PROD-8",
    }),
    "HTPR-4437"
  );
  assert.equal(
    extractTicketId({
      title: "Improve GitHub integration",
      headRef: "feat/github-webhook",
      body: "Resolves PROD-8",
    }),
    "PROD-8"
  );
  assert.equal(
    extractTicketId({ headRef: "htpr-4437-github-pr-link" }),
    "HTPR-4437"
  );
  assert.equal(
    extractTicketId({
      title: "Improve GitHub integration",
      headRef: "feat/github-webhook",
      body: "No ticket reference here",
    }),
    null
  );
});

test("extractTicketId prefers the branch's ticket over a different ticket mentioned in the title", () => {
  const { extractTicketId } = loadTs(
    "src/app/api/webhooks/github/github-webhook-helpers.ts"
  );

  // Title references a stale/related ticket; branch is the PR's own ticket.
  // Trusting the title here would silently act on the wrong (possibly
  // cross-board) ticket.
  assert.equal(
    extractTicketId({
      title: "Revert HTPR-1234, follow-up to INNE-99",
      headRef: "inne-22-branch",
      body: "supersedes HTPR-4400",
    }),
    "INNE-22"
  );
});

test("extractTicketId is not hijacked by ticket-shaped technical prose in the title", () => {
  const { extractTicketId } = loadTs(
    "src/app/api/webhooks/github/github-webhook-helpers.ts"
  );

  // "UTF-8" / "SHA-256" match the WORD-123 shape but are not ticket ids.
  // Branch-first precedence means the real ticket wins before the title is
  // even inspected.
  assert.equal(
    extractTicketId({
      title: "Use UTF-8 encoding consistently, hash with SHA-256",
      headRef: "htpr-4437-github-pr-link",
      body: "",
    }),
    "HTPR-4437"
  );
});
