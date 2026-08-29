// HTPR-4815: /api/auth/instant-signup is unauthenticated and accepts ANY email,
// including one that already has an account. It used to return a usable
// email-link token in its body (and again inside loginUrl), so POSTing a
// victim's address handed the caller a working login for that person.
//
// This test guards the invariant rather than the wording: nothing in the
// response body may be usable as a credential, and it must not confirm whether
// an address already has an account. If someone re-adds a token, a loginUrl, or
// the user object, this fails.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROUTE = path.resolve(
  __dirname,
  "../src/app/api/auth/instant-signup/route.ts",
);
const source = fs.readFileSync(ROUTE, "utf8");

// The response literal handed back on the success path.
function successResponseBody() {
  const marker = "const response = NextResponse.json({";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, "success response shape moved — update this test");
  const end = source.indexOf("})", start);
  return source.slice(start + marker.length, end);
}

test("the success response carries no credential", () => {
  const body = successResponseBody();
  for (const leak of ["token", "loginUrl", "jwt"]) {
    assert.ok(
      !new RegExp(`\\b${leak}\\s*:`, "i").test(body),
      `instant-signup must not return "${leak}" — that is a login for whatever email was POSTed`,
    );
  }
});

test("the success response does not leak the account or its existence", () => {
  const body = successResponseBody();
  // `user` exposes id/displayName/photoURL/uid for any address you guess;
  // `isNewUser` answers "does this person have an account?" to anyone asking.
  for (const leak of ["user", "isNewUser"]) {
    assert.ok(
      !new RegExp(`\\b${leak}\\s*:`).test(body),
      `instant-signup must not return "${leak}" to an unauthenticated caller`,
    );
  }
});

test("no login token is minted on this route at all", () => {
  // Defence in depth: if the helper comes back, someone is heading toward
  // returning it again.
  assert.ok(
    !/createEmailLoginToken\s*\(/.test(source),
    "instant-signup must not mint login tokens; the emailed verification link is the only way in",
  );
});

test("the verification credential leaves only via email", () => {
  // The property-name checks above block the exact shape we removed. This blocks
  // every other shape: nesting it, spreading it, putting it in a header, a
  // cookie, or a redirect. verificationToken IS a credential — verify-email-token
  // accepts it and sets a signed session — so its only legitimate destination is
  // sendVerificationEmail.
  const allowed = [
    /^\s*const verificationToken = createVerificationToken\(/,
    /^\s*const verificationLink = buildVerificationLinkWithUTM\(/,
    /^\s*createVerificationToken\(normalizedEmail\),\s*$/,
    /^\s*await sendVerificationEmail\(/,
    /^\s*(normalizedEmail,|verificationLink$|verificationLink,)/,
    /^\s*(\/\/|\*|\/\*)/, // comments
  ];
  const offenders = source
    .split("\n")
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /verificationToken|verificationLink/.test(line))
    .filter(([, line]) => !allowed.some((re) => re.test(line)));

  assert.deepEqual(
    offenders,
    [],
    "verificationToken/verificationLink used outside the email path — it is a credential, it must not reach the caller",
  );
});

test("an existing account is never mutated by an unauthenticated caller", () => {
  // The route accepts any email. If it reaches updateUsers() for an address that
  // already exists, a stranger can overwrite that user's displayName and flip
  // their tutorial flags just by POSTing their email address.
  const guard = source.indexOf("if (existingUser) {");
  const provision = source.indexOf("await updateUsers(");
  assert.notEqual(guard, -1, "the existing-account early return is gone");
  assert.ok(
    guard < provision,
    "updateUsers() must be unreachable for an email that already has an account",
  );
});

test("the verification email is still sent", () => {
  // The fix must not silently turn signup into a dead end.
  assert.ok(
    /await sendVerificationEmail\(/.test(source),
    "instant-signup must still email the verification link",
  );
});
