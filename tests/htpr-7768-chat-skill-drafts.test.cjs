const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

function harness() {
  const skills = [];
  const tokens = new Map();
  const redis = {
    set: async (key, value) => { tokens.set(key, value); },
    getdel: async (key) => { const value = tokens.get(key); tokens.delete(key); return value ?? null; },
  };
  const prisma = { aI_Skill: {
    findFirst: async ({ where }) => skills.find(skill => Object.entries(where).every(([key, value]) => skill[key] === value)) ?? null,
    create: async ({ data }) => { const skill = { id: skills.length + 1, ...data }; skills.push(skill); return skill; },
    update: async ({ where, data }) => { const skill = skills.find(skill => skill.id === where.id); Object.assign(skill, data); return skill; },
  } };
  const mocks = {
    "ai": { tool: value => value },
    "@/lib/prisma": { default: prisma },
    "@/lib/redis": { getRedis: async () => redis },
    "@/lib/ai/tools/execution": { withToolErrors: fn => fn },
    "@/lib/ai/tools/helpers": { sanitizeForJson: value => JSON.parse(JSON.stringify(value)) },
    "@/app/api/ai/_lib/skillAccess": {
      assertSkillScopeAccess: async (id, scope, projectId) => {
        if (scope === "project" && projectId !== 15) throw new Error("access denied");
        return scope === "user" ? { userId: id, projectId: null } : { userId: null, projectId };
      },
      getAccessibleSkill: async (userId, id) => {
        const skill = skills.find(skill => skill.id === id && (skill.userId === userId || skill.projectId === 15));
        if (!skill) throw new Error("access denied");
        return skill;
      },
    },
  };
  const create = load("src/lib/ai/tools/createSkill.ts", mocks).createCreateSkillTool;
  const update = load("src/lib/ai/tools/updateSkill.ts", mocks).createUpdateSkillTool;
  function turn({ userId = 985, sessionId = "skill-session" } = {}) {
    const context = { user: { id: userId }, confirmationSessionId: sessionId, bulkPreviewsIssued: new Set(), sendStatus() {} };
    const creator = create(context).hypertask_create_skill;
    const updater = update(context).hypertask_update_skill;
    return {
      create: input => creator.execute(creator.inputSchema.parse(input)),
      update: input => updater.execute(updater.inputSchema.parse(input)),
    };
  }
  return { skills, turn, redis };
}

const draft = { name: "Acceptance review", slug: "acceptance-review", description: "Check missing acceptance criteria", argument_hint: "[ticket]", body: "Read the ticket.\nList missing acceptance criteria.\nAsk one focused question." };

for (const scope of ["user", "project"]) {
  test(`${scope}: preview saves nothing, same-turn approval is refused, later approval saves the exact draft`, async () => {
    const h = harness();
    const input = { ...draft, scope, ...(scope === "project" ? { project_id: 15 } : {}) };
    const first = h.turn();
    const preview = await first.create(input);
    assert.equal(preview.confirmation_required, true);
    assert.equal(preview.skill.slug, draft.slug);
    assert.equal(preview.skill.body, draft.body);
    assert.equal(preview.scope, scope);
    assert.equal(preview.skill.argumentHint, draft.argument_hint);
    assert.equal(h.skills.length, 0);
    assert.equal((await first.create({ ...input, confirmed: true })).confirmation_required, true);
    assert.equal(h.skills.length, 0);
    const saved = await h.turn().create({ ...input, confirmed: true });
    assert.equal(saved.success, true);
    assert.equal(h.skills.length, 1);
    assert.equal(saved.skill.body, draft.body);
    assert.equal(saved.skill.userId, scope === "user" ? 985 : null);
    assert.equal(saved.skill.projectId, scope === "project" ? 15 : null);
    assert.equal(saved.skill.enabled, true);
  });
}

test("claimed approval without a preview cannot create a skill", async () => {
  const h = harness();
  assert.equal((await h.turn().create({ ...draft, confirmed: true })).confirmation_required, true);
  assert.equal(h.skills.length, 0);
});

for (const change of [{ body: "Different instructions" }, { scope: "project", project_id: 15 }, { enabled: false }, { slug: "different-slug" }]) {
  test(`changed draft needs fresh approval: ${JSON.stringify(change)}`, async () => {
    const h = harness();
    await h.turn().create(draft);
    assert.equal((await h.turn().create({ ...draft, ...change, confirmed: true })).confirmation_required, true);
    assert.equal(h.skills.length, 0);
  });
}

for (const identity of [{ sessionId: "another-session" }, { userId: 2343 }]) {
  test(`approval is isolated: ${JSON.stringify(identity)}`, async () => {
    const h = harness();
    await h.turn().create(draft);
    assert.equal((await h.turn(identity).create({ ...draft, confirmed: true })).confirmation_required, true);
    assert.equal(h.skills.length, 0);
  });
}

test("rejected drafts save nothing and unavailable confirmation storage fails closed", async () => {
  const h = harness();
  await h.turn().create(draft);
  assert.equal(h.skills.length, 0);
  h.redis.getdel = async () => { throw new Error("Redis unavailable"); };
  assert.equal((await h.turn().create({ ...draft, confirmed: true })).confirmation_required, true);
  assert.equal(h.skills.length, 0);
});

test("an existing slug offers an update, which also requires a fresh approved draft", async () => {
  const h = harness();
  await h.turn().create(draft);
  const saved = await h.turn().create({ ...draft, confirmed: true });
  const collision = await h.turn().create({ ...draft, body: "Replacement instructions" });
  assert.equal(collision.success, false);
  assert.equal(collision.existing_skill.id, saved.skill.id);
  assert.match(collision.message, /update/i);
  assert.equal(h.skills.length, 1);
  const update = { skill_id: saved.skill.id, body: "Replacement instructions" };
  const preview = await h.turn().update(update);
  assert.equal(preview.confirmation_required, true);
  assert.equal(preview.skill.name, draft.name);
  assert.equal(preview.skill.body, update.body);
  assert.equal(h.skills[0].body, draft.body);
  assert.equal((await h.turn().update({ ...update, body: "Edited again", confirmed: true })).confirmation_required, true);
  assert.equal(h.skills[0].body, draft.body);
  assert.equal((await h.turn().update({ ...update, confirmed: true })).success, true);
  assert.equal(h.skills[0].body, update.body);
});

test("SKILL.md previews use the existing parser and normalized slug rules", async () => {
  const h = harness();
  const markdown = "---\nname: Session Review\ndescription: Review this workflow\nargument-hint: '[ticket]'\n---\nRead the ticket.\nThen list gaps.";
  const preview = await h.turn().create({ markdown });
  assert.equal(preview.confirmation_required, true);
  assert.equal(preview.skill.slug, "session-review");
  assert.equal(preview.skill.body, "Read the ticket.\nThen list gaps.");
  const saved = await h.turn().create({ markdown, confirmed: true });
  assert.equal(saved.success, true);
  assert.equal(saved.skill.slug, "session-review");
});

test("inaccessible scopes and skills are refused before preview or write", async () => {
  const h = harness();
  await assert.rejects(h.turn().create({ ...draft, scope: "project", project_id: 99 }), /access denied/);
  await assert.rejects(h.turn().update({ skill_id: 999, body: "No access", confirmed: true }), /access denied/);
  assert.equal(h.skills.length, 0);
});


test("new skills appear immediately after a chat turn, even when an older menu request finishes late", async (t) => {
  const { fetchSlashSkills, invalidateSlashSkills } = load("src/lib/skills/slashSkills.ts", {
    "lucide-react": { Sparkles: () => null },
  });
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let resolveOld;
  global.fetch = () => new Promise(resolve => { resolveOld = resolve; });
  const oldRequest = fetchSlashSkills(15);
  invalidateSlashSkills();
  const newSkill = { ...draft, description: draft.description, enabled: true, projectId: 15 };
  global.fetch = async () => ({ ok: true, json: async () => ({ skills: [newSkill] }) });
  assert.deepEqual((await fetchSlashSkills(15)).map(skill => skill.slug), [draft.slug]);
  resolveOld({ ok: true, json: async () => ({ skills: [] }) });
  await oldRequest;
  assert.deepEqual((await fetchSlashSkills(15)).map(skill => skill.slug), [draft.slug]);
});
