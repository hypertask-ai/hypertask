// HTPR-4856: project validation is awaited after the board page has begun
// streaming. Redirecting an unauthorized user from there serialises the
// redirect as a flight error, so the existing unauthorized UI must render inline.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PAGE = path.resolve(__dirname, "../src/app/[...boardURL]/page.tsx");
const source = fs.readFileSync(PAGE, "utf8");

test("board validation renders unauthorized UI without a late redirect", () => {
  assert.match(source, /import Unauthorized from "\.\.\/unauthorized\/page"/);

  const pageStart = source.indexOf("export default async function Page(");
  const validationAwait = source.indexOf(
    "await getProjectForValidation(",
    pageStart,
  );
  assert.notEqual(validationAwait, -1, "project validation await moved");

  const postValidationFlow = source.slice(validationAwait);
  assert.doesNotMatch(
    postValidationFlow,
    /\bredirect\s*\(/,
    "never redirect after awaited project validation; render inline to avoid a flight error",
  );
  assert.match(postValidationFlow, /return <Unauthorized\s*\/>/);
});

test("unauthorized UI explains the unavailable resource and uses a themed button", () => {
  assert.match(source, /return <Unauthorized\s*\/>/);

  const unauthorizedPage = fs.readFileSync(
    path.resolve(__dirname, "../src/app/unauthorized/page.tsx"),
    "utf8",
  );

  assert.match(unauthorizedPage, /This board or ticket is unavailable/);
  assert.match(unauthorizedPage, /deleted or archived/);
  assert.doesNotMatch(
    unauthorizedPage,
    /You are not invited to this board or this board has been archived\/deleted\/invalid view/,
  );
  assert.match(unauthorizedPage, /<button[\s\S]*type="button"[\s\S]*bg-hypertasks-purple/);
  assert.doesNotMatch(unauthorizedPage, /className=['"]btn btn-light['"]/);
});
