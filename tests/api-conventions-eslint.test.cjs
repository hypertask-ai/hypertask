const assert = require("node:assert/strict");
const test = require("node:test");
const { ESLint } = require("eslint");

const ruleId = "hypertask-api/require-route-wrapper";

async function conventionMessages(code, filePath) {
  const eslint = new ESLint();
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((message) => message.ruleId === ruleId);
}

test("App Router handlers must declare an auth policy", async () => {
  const messages = await conventionMessages(
    "export async function GET() { return new Response(); }\n",
    "src/app/api/convention-fixture/route.ts",
  );
  assert.equal(messages.length, 1);
});

test("App Router handlers accept withAuth", async () => {
  const messages = await conventionMessages(
    'import { withAuth } from "#with-auth";\nexport const GET = withAuth(async () => new Response());\n',
    "src/app/api/convention-fixture/route.ts",
  );
  assert.deepEqual(messages, []);
});

test("Pages Router handlers must declare an auth policy", async () => {
  const messages = await conventionMessages(
    "export default async function handler() {}\n",
    "src/pages/api/convention-fixture.ts",
  );
  assert.equal(messages.length, 1);
});

test("Pages Router handlers accept an explicit public policy", async () => {
  const messages = await conventionMessages(
    'import { withoutAuth } from "#with-auth";\nexport default withoutAuth(async function handler() {});\n',
    "src/pages/api/convention-fixture.ts",
  );
  assert.deepEqual(messages, []);
});
