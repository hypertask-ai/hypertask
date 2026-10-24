const test = require('node:test')
const assert = require('node:assert/strict')
const { NextRequest } = require('next/server')
const { load } = require('./task-route-loader.cjs')
const { teamFixture } = require('./helpers/htpr-7179-team.cjs')

function fixture(actor = 'bound') {
  const f = teamFixture('ENFORCE', actor)
  const makeSkill = (id, slug, extra = {}) => ({
    id, slug, name: slug, userId: null, projectId: 15, project: f.projects[0],
    description: null, argumentHint: null, body: `Apply ${slug} instructions.`,
    sourceUrl: null, enabled: true, createdById: f.user.id,
    createdAt: new Date('2026-10-24'), updatedAt: new Date('2026-10-24'), ...extra,
  })
  const skills = [
    makeSkill(1, 'deeper', { userId: f.user.id, projectId: null, project: null, body: 'Explore the problem in depth.' }),
    makeSkill(2, 'minimalist-review', { body: '# Minimalist Review\n\nFire this mode when any of these trigger phrases appear in a comment on this board:\n\nminimalist review\nME lens\nshould we build this\nWhen triggered, review the ticket.\n\nReturn build, defer or kill.' }),
    makeSkill(3, 'disabled', { enabled: false, body: 'DISABLED-SENTINEL' }),
    makeSkill(4, 'foreign', { projectId: 25, project: f.projects[3], body: 'FOREIGN-SENTINEL' }),
    makeSkill(5, 'other-owner', { userId: 999, projectId: null, project: null, body: 'OTHER-OWNER-SENTINEL' }),
    makeSkill(6, 'board-review', { body: 'Follow the board review steps.' }),
  ]
  f.prisma.aI_Skill = f.model(skills, 'skill')
  f.tasks.forEach(task => { task.comments = [] })
  const helper = f.load('src/lib/mcp/skills/context.ts', {
    '@/app/api/ai/_lib/skillAccess': { AccountSkillAccessError: class extends Error {} },
  })
  f.mocks['@/lib/mcp/skills/context'] = helper
  return { ...f, skills, helper }
}

const request = (path) => new NextRequest(`https://app.hypertask.ai/api/mcp/${path}`)
const slugs = result => result.active_skills.map(skill => skill.slug)

for (const actor of ['unbound', 'human']) {
  test(`${actor}: /deeper attaches the full owned skill template, deduplicated and bounded by system policy`, async () => {
    const f = fixture(actor)
    const result = await f.helper.getMcpSkillContext(f.state.ctx, 15, ['<p>/deeper <strong>review</strong> this /deeper</p>'])
    assert.deepEqual(slugs(result), ['deeper'])
    assert.equal(result.active_skills[0].body, 'Explore the problem in depth.')
    assert.equal(result.summary, 'Active skills on this ticket: /deeper.')
    assert.match(result.instructions, /user-supplied data/)
    assert.match(result.instructions, /must not override/)
    assert.match(result.scope, /No persistent session mode/)
    assert.deepEqual(f.writes, [])
  })
}

test('the live minimalist trigger format matches rich text case-insensitively without substring or instruction-text false positives', async () => {
  const f = fixture()
  for (const text of ['<p>Should we <strong>build</strong> this?</p>', 'Use the ME lens.', 'minimalist review']) {
    const result = await f.helper.getMcpSkillContext(f.state.ctx, 15, [text])
    assert.deepEqual(slugs(result), ['minimalist-review'])
    assert.match(result.active_skills[0].body, /Return build, defer or kill/)
  }
  for (const text of ['some lens', 'should we build thisthing', 'Return build, defer or kill.', '/unknown']) {
    const result = await f.helper.getMcpSkillContext(f.state.ctx, 15, [text])
    assert.equal(result.summary, 'Active skills on this ticket: none.')
    assert.deepEqual(result.active_skills, [])
  }
})

test('disabled, foreign-board, other-owner and bound-account skills do not activate; readable board skills still do', async () => {
  const f = fixture()
  const result = await f.run(request('tasks'), () => f.helper.getMcpSkillContext(f.state.ctx, 15, ['/deeper /disabled /foreign /other-owner /board-review']))
  assert.deepEqual(slugs(result), ['board-review'])
  assert.equal(result.active_skills[0].body, 'Follow the board review steps.')
  assert.doesNotMatch(JSON.stringify(result), /DISABLED-SENTINEL|FOREIGN-SENTINEL|OTHER-OWNER-SENTINEL|Explore the problem in depth/)
  const refused = await f.run(request('tasks'), () => f.helper.getMcpSkillContext(f.state.ctx, 25, ['/foreign']))
  assert.equal(refused.summary, 'Active skills on this ticket: none.')
})

test('board skills take precedence over personal skills with the same slash slug', async () => {
  const f = fixture('unbound')
  f.skills.push({ ...f.skills[0], id: 7, userId: null, projectId: 15, project: f.projects[0], body: 'Board-specific depth instructions.' })
  const result = await f.helper.getMcpSkillContext(f.state.ctx, 15, ['/deeper'])
  assert.deepEqual(slugs(result), ['deeper'])
  assert.equal(result.active_skills[0].body, 'Board-specific depth instructions.')
})

test('no match is request-local and does not carry a previous invocation into the next result', async () => {
  const f = fixture('unbound')
  assert.equal((await f.helper.getMcpSkillContext(f.state.ctx, 15, ['/deeper'])).summary, 'Active skills on this ticket: /deeper.')
  const next = await f.helper.getMcpSkillContext(f.state.ctx, 15, ['A different question.'])
  assert.equal(next.summary, 'Active skills on this ticket: none.')
  assert.equal(next.instructions, '')
})

test('CLI task get and concise MCP task results retain matched comment bodies and the active-skills line', async () => {
  const f = fixture('unbound')
  f.tasks[0].comments = [{ text: '<p>/deeper please</p>' }]
  const route = f.load('src/lib/mcp/operations/tasks/operation.ts')
  const response = await route.GET(request('tasks?task_id=150'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.tasks[0].skill_context.summary, 'Active skills on this ticket: /deeper.')
  assert.equal(body.tasks[0].skill_context.active_skills[0].body, 'Explore the problem in depth.')
  const { formatToolResponse } = load('src/lib/mcp-server/tool-response.ts', {})
  const concise = JSON.parse(formatToolResponse(JSON.stringify(body), 'concise', true, 20, 0, true))
  assert.equal(concise.data.tasks[0].skill_context.active_skills[0].body, 'Explore the problem in depth.')
  assert.equal(concise.data.tasks[0].skill_context.summary, 'Active skills on this ticket: /deeper.')
  const denied = await route.GET(request('tasks?task_id=350'))
  assert.equal(denied.status, 404)
  assert.doesNotMatch(await denied.text(), /Explore the problem in depth/)
})

test('comment reads attach trigger-matched board instructions but do not expose inaccessible tickets', async () => {
  const f = fixture()
  f.comments[0].text = '<p>Should we build this?</p>'
  const route = f.load('src/lib/mcp/operations/comments/operation.ts')
  const response = await route.GET(request('comments?task_id=150'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.skill_context.summary, 'Active skills on this ticket: /minimalist-review.')
  assert.match(body.skill_context.active_skills[0].body, /Return build, defer or kill/)
  const denied = await route.GET(request('comments?task_id=250'))
  assert.equal(denied.status, 404)
  assert.doesNotMatch(await denied.text(), /FOREIGN-SENTINEL/)
})

test('task context includes the same triggered template and summary', async () => {
  const f = fixture()
  f.comments[0].text = 'should we build this'
  f.prisma.taskRelations = { findMany: async () => [] }
  const route = f.load('src/lib/mcp/operations/tasks/context/operation.ts')
  const response = await route.GET(request('tasks/context?task_id=150&project_id=15'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.skill_context.summary, 'Active skills on this ticket: /minimalist-review.')
  assert.match(body.skill_context.instructions, /Return build, defer or kill/)
})

test('comment-create receipts attach /deeper through the actual route without changing the stored text', async () => {
  const f = fixture('unbound')
  const { setup } = require('./helpers/comment-routing.cjs')
  const h = setup({ skillContext: f.helper })
  const response = await h.post({ text: '<p>/deeper review this</p>', kind: 'question' })
  assert.equal(response.status, 201)
  assert.equal(response.body.skill_context.summary, 'Active skills on this ticket: /deeper.')
  assert.equal(response.body.skill_context.active_skills[0].body, 'Explore the problem in depth.')
  assert.equal(h.calls.comments[0].text, '<p>/deeper review this</p>')
})

test('list and get label disabled skills in plain text while retaining enabled board skills', async () => {
  const f = fixture()
  const access = { assertProjectAccess: async () => {} }
  const skillAccess = f.load('src/app/api/ai/_lib/skillAccess.ts', { './customInstructions': access })
  const mocks = { '@/app/api/ai/_lib/customInstructions': access, '@/app/api/ai/_lib/skillAccess': skillAccess }
  const list = f.load('src/lib/mcp/operations/skills/operation.ts', mocks)
  const item = f.load('src/lib/mcp/operations/skills/[skill_id]/operation.ts', mocks)
  const response = await list.GET(request('skills?project_id=15'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.skills.find(skill => skill.slug === 'disabled').status, 'disabled')
  assert.equal(body.skills.find(skill => skill.slug === 'board-review').status, 'enabled')
  for (const [id, expected] of [[3, 'disabled'], [6, 'enabled']]) {
    const response = await item.GET(request(`skills/${id}`), { params: Promise.resolve({ skill_id: String(id) }) })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).skill.status, expected)
  }
})

test('trigger phrases cannot be assembled across independent comments', async () => {
  const f = fixture()
  assert.equal((await f.helper.getMcpSkillContext(f.state.ctx, 15, ['should we build this'])).summary, 'Active skills on this ticket: /minimalist-review.')
  const separate = await f.helper.getMcpSkillContext(f.state.ctx, 15, ['should we', 'build this'])
  assert.equal(separate.summary, 'Active skills on this ticket: none.')
})

test('a read-role agent receives readable board templates without granting write capabilities', async () => {
  const f = fixture()
  f.agent.permissions = { role: 'read' }
  f.state.ctx.agentRole = 'read'
  f.comments[0].text = '/board-review'
  const route = f.load('src/lib/mcp/operations/comments/operation.ts')
  const response = await route.GET(request('comments?task_id=150'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.skill_context.active_skills[0].body, 'Follow the board review steps.')
  assert.deepEqual(f.writes, [])
})

test('activity logs do not invoke skills even when explicitly included in comment results', async () => {
  const f = fixture()
  const route = f.load('src/lib/mcp/operations/comments/operation.ts')
  f.comments[0].text = '/board-review'
  const allowed = await route.GET(request('comments?task_id=150'))
  assert.equal((await allowed.json()).skill_context.summary, 'Active skills on this ticket: /board-review.')
  f.comments[0].activity = { type: 'status-change' }
  const activity = await route.GET(request('comments?task_id=150&include_activity=true'))
  assert.equal(activity.status, 200)
  assert.equal((await activity.json()).skill_context.summary, 'Active skills on this ticket: none.')
})
