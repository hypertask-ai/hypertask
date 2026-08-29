// HTPR-3979 regression guard.
//
// The /oauth identity gate was written as "startsWith('/oauth') AND not
// /oauth/token AND not /oauth/register". That excluded the two machine
// endpoints from the gate, but it also excluded them from the branch's
// `return NextResponse.next()`. They then matched no /oauth branch at all and
// fell through to the page-route logic further down, which redirects to /login.
//
// Result: OAuth client registration and token exchange 307'd to /login in
// production. Both are POST endpoints for machines with no cookies, so the
// failure was invisible to any browser test.
//
// The invariant: /oauth/token and /oauth/register must be returned FIRST,
// unconditionally, before any branch that can redirect.
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

  // Everything from the /oauth gate onward can redirect. The pass-through has
  // to sit above all of it.
  const oauthGate = source.indexOf("if (currentPath.startsWith('/oauth')");
  assert.notEqual(oauthGate, -1, "the /oauth gate is gone");
  assert.ok(
    passThrough < oauthGate,
    "the machine-endpoint pass-through must come before the /oauth gate and everything below it",
  );
});

test("the /oauth gate does not try to exclude paths by condition", () => {
  // Excluding by condition is what caused the outage. If someone reintroduces
  // `startsWith('/oauth') && currentPath !== ...`, the excluded path silently
  // falls through instead of passing through.
  const gate = source.slice(
    source.indexOf("if (currentPath.startsWith('/oauth')"),
    source.indexOf("if (currentPath.startsWith('/.well-known')"),
  );
  assert.ok(
    !/currentPath\s*!==\s*'\/oauth/.test(gate),
    "exclude /oauth paths with an early return above the gate, not with a !== in the gate's condition",
  );
});
