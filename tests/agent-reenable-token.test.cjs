const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("re-enabling an agent rotates its credential and reveals it once", () => {
  const route = read("src/app/api/agents/[agentId]/route.ts");
  const modal = read("src/components/Modals/Agent/disabled.modal.tsx");

  assert.match(route, /isReEnabling = Boolean\(existing\.revokedAt\)/);
  assert.match(route, /isReEnabling\)[\s\S]*?clearRuntimeBestEffort\(\)/);
  assert.match(route, /existing\.runtimeType === "EXTERNAL"/);
  assert.match(
    route,
    /createMcpToken\([\s\S]*?user\.id,[\s\S]*?owner\.email,[\s\S]*?undefined,[\s\S]*?existing\.id/,
  );
  assert.match(route, /revokedAt: \{ not: null \}/);
  assert.match(route, /transition\.count === 0/);
  assert.match(route, /agentTokenCredentialFields\(reenabledToken\)/);
  assert.match(route, /runtimeGeneration: \{ increment: 1 \}/);
  assert.match(
    route,
    /agentTokenMatchesStored\(reenabledToken, \{ mcpTokenHash \}\)/,
  );
  assert.match(route, /tokenToReveal \? \{ token: tokenToReveal \} : \{\}/);

  assert.match(modal, /result\.token/);
  assert.match(modal, /revoked: false/);
  assert.match(modal, /It will not be shown\s+again/);
  assert.match(
    modal,
    /Authorization: `Bearer \$\{reenabledCredential\.token\}`/,
  );

  const listRoute = read("src/app/api/agents/route.ts");
  assert.match(listRoute, /hasMcpToken:[\s\S]*?Boolean\(mcpTokenJti\)/);
  // HTPR-4671: no plaintext credential exists to leak into the list response.
  assert.doesNotMatch(listRoute, /\bmcpToken\b\s*:/);
});

test("disabling still revokes the token", () => {
  const route = read("src/app/api/agents/[agentId]/route.ts");

  assert.match(
    route,
    /revokedAt,[\s\S]*?agentTokenCredentialFields\(null\),[\s\S]*?mcpTokenExpiresAt: null,[\s\S]*?runtimeGeneration: \{ increment: 1 \}/,
  );
  assert.match(
    route,
    /data: \{[\s\S]*?revokedAt,[\s\S]*?runtimeGeneration: \{ increment: 1 \}[\s\S]*?\},[\s\S]*?clearRuntimeBestEffort\(\)/,
  );
  assert.match(route, /Snapshot invalidation failed/);
});
