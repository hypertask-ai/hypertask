const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.resolve(__dirname, "../src/proxy.ts"),
  "utf8",
);

test("OAuth machine endpoints return before any redirect can fire", () => {
  const passThrough = source.indexOf(
    "currentPath === '/oauth/token' ||",
  );
  assert.match(source, /currentPath === '\/oauth\/register' \|\|/);
  assert.match(source, /currentPath === '\/oauth\/revoke'/);
  assert.notEqual(
    passThrough,
    -1,
    "the unconditional pass-through for the OAuth machine endpoints is gone — they will fall through to the page logic and redirect to /login",
  );

  const oauthGate = source.indexOf("if (currentPath.startsWith('/oauth')");
  assert.notEqual(oauthGate, -1, "the /oauth gate is gone");
  assert.ok(
    passThrough < oauthGate,
    "the machine-endpoint pass-through must come before the /oauth gate and everything below it",
  );
});

test("the /oauth gate does not try to exclude paths by condition", () => {
  const gate = source.slice(
    source.indexOf("if (currentPath.startsWith('/oauth')"),
    source.indexOf("if (currentPath.startsWith('/.well-known')"),
  );
  assert.ok(
    !/currentPath\s*!==\s*'\/oauth/.test(gate),
    "exclude /oauth paths with an early return above the gate, not with a !== in the gate's condition",
  );
});
