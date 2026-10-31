const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROUTE = path.resolve(
  __dirname,
  "../src/app/api/auth/instant-signup/route.ts",
);
const source = fs.readFileSync(ROUTE, "utf8");

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
  for (const leak of ["user", "isNewUser"]) {
    assert.ok(
      !new RegExp(`\\b${leak}\\s*:`).test(body),
      `instant-signup must not return "${leak}" to an unauthenticated caller`,
    );
  }
});

test("no login token is minted on this route at all", () => {
  assert.ok(
    !/createEmailLoginToken\s*\(/.test(source),
    "instant-signup must not mint login tokens; the emailed verification link is the only way in",
  );
});

test("the verification credential leaves only via email", () => {
  const allowed = [
    /^\s*const verificationToken = createVerificationToken\(/,
    /^\s*const verificationLink = buildVerificationLinkWithUTM\(/,
    /^\s*createVerificationToken\(normalizedEmail\),\s*$/,
    /^\s*await sendVerificationEmail\(/,
    /^\s*(normalizedEmail,|verificationLink$|verificationLink,)/,
    /^\s*(\/\/|\*|\/\*)/,
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
  const guard = source.indexOf("if (existingUser) {");
  const provision = source.indexOf("await updateUsers(");
  assert.notEqual(guard, -1, "the existing-account early return is gone");
  assert.ok(
    guard < provision,
    "updateUsers() must be unreachable for an email that already has an account",
  );
});

test("the verification email is still sent", () => {
  assert.ok(
    /await sendVerificationEmail\(/.test(source),
    "instant-signup must still email the verification link",
  );
});
