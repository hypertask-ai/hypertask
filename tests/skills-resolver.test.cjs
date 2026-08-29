const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/skills-resolver.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { resolveSkills } = jiti(
  path.join(root, "src/app/api/ai/_lib/skills.ts")
);

const foo = {
  id: 1,
  projectId: null,
  userId: 7,
  slug: "foo",
  name: "Foo reviewer",
  description: null,
  argumentHint: null,
  body: "Review this as Foo.",
  sourceUrl: null,
  enabled: true,
  createdById: 7,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const lookup = async (slugs) => (slugs.includes("foo") ? [foo] : []);

test("resolves and strips a known skill token", async () => {
  const result = await resolveSkills("/foo do the thing", { userId: 7 }, lookup);
  assert.equal(result.cleanedText, "do the thing");
  assert.deepEqual(result.skills, [foo]);
  // The body is fenced and flagged as untrusted data so it cannot override the
  // system rules or tool-use policy (the chat agent holds write tools).
  assert.match(result.systemPromptAddition, /<skill name="Foo reviewer">/);
  assert.match(result.systemPromptAddition, /Review this as Foo\./);
  assert.match(result.systemPromptAddition, /user-supplied data/i);
  assert.match(result.systemPromptAddition, /must not override/i);
});

test("resolves /i as the built-in Improve Readability skill", async () => {
  let lookupCalled = false;
  const result = await resolveSkills(
    "/i Summarize the current task",
    { userId: 7, projectId: 42 },
    async () => {
      lookupCalled = true;
      return [];
    }
  );

  assert.equal(lookupCalled, false);
  assert.equal(result.cleanedText, "Summarize the current task");
  assert.equal(result.skills[0]?.slug, "i");
  assert.equal(result.skills[0]?.name, "Improve Readability");
  assert.match(result.systemPromptAddition, /built-in formatting template/);
  assert.match(result.systemPromptAddition, /Lead with the outcome or answer/);
  assert.match(result.systemPromptAddition, /short paragraphs and bullets/);
});

test("injects a repeated skill token only once", async () => {
  const result = await resolveSkills("/foo and again /foo", { userId: 7 }, lookup);
  assert.deepEqual(result.skills, [foo]);
  const occurrences = result.systemPromptAddition.match(/<skill name=/g) || [];
  assert.equal(occurrences.length, 1);
});

test("leaves unknown slash tokens untouched", async () => {
  const result = await resolveSkills("/giphy cat", { userId: 7 }, lookup);
  assert.equal(result.cleanedText, "/giphy cat");
  assert.deepEqual(result.skills, []);
  assert.equal(result.systemPromptAddition, "");
});

test("keeps unknown tokens and unrelated spacing while removing known skills", async () => {
  const result = await resolveSkills("/giphy  cat /foo please", { userId: 7 }, lookup);
  assert.equal(result.cleanedText, "/giphy  cat please");
});

test("prefers a project skill when its slug collides with a personal skill", async () => {
  const projectFoo = {
    ...foo,
    id: 2,
    projectId: 42,
    userId: null,
    name: "Project reviewer",
    body: "Use the project review rules.",
  };
  const result = await resolveSkills(
    "/foo review this",
    { userId: 7, projectId: 42 },
    async () => [projectFoo, foo]
  );
  assert.deepEqual(result.skills, [projectFoo]);
  assert.match(result.systemPromptAddition, /Use the project review rules\./);
});

test("resolves skill tokens inside rich-text comment HTML", async () => {
  const result = await resolveSkills("<p>/foo review this</p>", { userId: 7 }, lookup);
  assert.equal(result.cleanedText, "<p> review this</p>");
  assert.deepEqual(result.skills, [foo]);
});
