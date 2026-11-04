const test = require('node:test')
const assert = require('node:assert/strict')
const { loadModule: load } = require('./helpers/loadModule.cjs')

const members = [
  { id: 6, displayName: 'Valentin Yeo', email: 'valentin.yeo@gmail.com' },
  { id: 2547, displayName: 'Health Check', email: 'health-check@example.com' },
  {
    id: '4ef87c0d-7b08-4071-ba91-d1b720f2b24b',
    displayName: 'Runner 4',
    owner: { id: 6, displayName: 'Valentin Yeo', email: 'valentin.yeo@gmail.com' },
  },
  {
    id: '35080a32-dde2-4339-b190-022dd442608a',
    displayName: 'HT Design Lead',
    owner: { id: 6, displayName: 'Valentin Yeo', email: 'valentin.yeo@gmail.com' },
  },
]

const boardMembers = { getProjectMembers: async () => ({ members, error: null }) }

const { resolveMentionTargets } = load('src/utils/controllers/comments/resolveMentions.ts')
const { resolveMentionInputs, mentionProblemMessage } = load(
  'src/utils/controllers/comments/resolveMentionInputs.ts',
  { '@/utils/controllers/projects/getProjectMembers': boardMembers },
)
const { convertPlainTextMentionsToHtml } = load(
  'src/utils/controllers/comments/processMentions.ts',
  {
    '@/lib/configs/taskDetail.config': { urls: { templates: { mention: (name, id) => `<span data-type="mention" class="mention" data-id="${id}" data-label="name-${id}">${name}</span>` } } },
    '@/utils/controllers/projects/getProjectMembers': boardMembers,
  },
)
const { callerCanFixRefusal, quietInputRefusal } = load('src/lib/aiFeedback/callerFixable.ts')

test('an agent name resolves to its agent id, not a user id', async () => {
  const resolution = await resolveMentionInputs({
    inputs: ['Runner 4'],
    projectId: 15,
    requestingUserId: 6,
    allowAgents: true,
  })
  assert.deepEqual(resolution.problems, [])
  assert.deepEqual(resolution.mentions, [
    { agent_id: '4ef87c0d-7b08-4071-ba91-d1b720f2b24b', display_name: 'Runner 4' },
  ])
})

test('a person name still resolves to a user id with agents allowed', async () => {
  const resolution = await resolveMentionInputs({
    inputs: ['Health Check'],
    projectId: 15,
    requestingUserId: 6,
    allowAgents: true,
  })
  assert.deepEqual(resolution.problems, [])
  assert.deepEqual(resolution.mentions, [{ user_id: 2547, display_name: 'Health Check' }])
})

test('with the switch off an agent name is refused exactly as before', async () => {
  const resolution = await resolveMentionInputs({
    inputs: ['Runner 4'],
    projectId: 15,
    requestingUserId: 6,
    allowAgents: false,
  })
  assert.deepEqual(resolution.mentions, [])
  assert.equal(resolution.problems.length, 1)
  assert.equal(resolution.problems[0].reason, 'unknown')
})

test('a person wins over an agent that shares the name, so a person name never moves', () => {
  const twins = [
    ...members,
    {
      id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      displayName: 'Health Check',
      owner: { id: 6, displayName: 'Valentin Yeo', email: 'valentin.yeo@gmail.com' },
    },
  ]
  const { resolved, problems } = resolveMentionTargets(['Health Check'], twins)
  assert.deepEqual(problems, [])
  assert.deepEqual(resolved, [{ user_id: 2547, display_name: 'Health Check' }])
})

test('a person prefix still resolves even when an agent starts the same way', () => {
  const board = [
    { id: 6, displayName: 'Valentin Yeo' },
    { id: '85b985ac-afe8-41a3-a1ac-d9549a9310c7', displayName: 'Valentins Claude Code CLI' },
  ]
  const { resolved, problems } = resolveMentionTargets(['Valentin'], board)
  assert.deepEqual(problems, [])
  assert.deepEqual(resolved, [{ user_id: 6, display_name: 'Valentin Yeo' }])
})

test('an agent prefix resolves only when one agent matches', async () => {
  const resolution = await resolveMentionInputs({
    inputs: ['HT Design'],
    projectId: 15,
    requestingUserId: 6,
    allowAgents: true,
  })
  assert.deepEqual(resolution.mentions, [
    { agent_id: '35080a32-dde2-4339-b190-022dd442608a', display_name: 'HT Design Lead' },
  ])
})

test('a misspelled agent name answers with the agent it meant', async () => {
  const resolution = await resolveMentionInputs({
    inputs: ['Running 4'],
    projectId: 15,
    requestingUserId: 6,
    allowAgents: true,
  })
  assert.deepEqual(resolution.mentions, [])
  assert.deepEqual(resolution.problems[0].closeMatches, ['Runner 4'])
})

test('a failed member lookup is a server error, never a caller typo', async () => {
  const { resolveMentionInputs: resolving } = load(
    'src/utils/controllers/comments/resolveMentionInputs.ts',
    {
      '@/utils/controllers/projects/getProjectMembers': {
        getProjectMembers: async () => ({ members: null, error: { status: 500, message: 'members unavailable' } }),
      },
    },
  )
  const resolution = await resolving({
    inputs: ['Runner 4'],
    projectId: 15,
    requestingUserId: 6,
    allowAgents: true,
  })
  assert.deepEqual(resolution.problems, [])
  assert.deepEqual(resolution.error, { status: 500, message: 'members unavailable' })
})

test('a wrong name is still named back with the lookup tool', async () => {
  const resolution = await resolveMentionInputs({
    inputs: ['Nobody Here'],
    projectId: 15,
    requestingUserId: 6,
    allowAgents: true,
  })
  assert.deepEqual(resolution.mentions, [])
  const message = mentionProblemMessage(resolution.problems[0])
  assert.match(message, /is not a person or agent on this board/)
  assert.match(message, /list_project_members/)
})

test('an agent entry carries no user id, so the member check never sees it', async () => {
  const resolution = await resolveMentionInputs({
    inputs: ['Runner 4', 'Health Check', { user_id: 6, display_name: 'Valentin Yeo' }],
    projectId: 15,
    requestingUserId: 6,
    allowAgents: true,
  })
  assert.deepEqual(resolution.problems, [])
  assert.deepEqual(resolution.invalid, false)
  assert.deepEqual(
    resolution.mentions.map((mention) => mention.user_id).filter((id) => typeof id === 'number'),
    [6, 2547],
  )
  assert.equal(
    typeof resolution.mentions.find((mention) => mention.display_name === 'Runner 4').agent_id,
    'string',
  )
})

test('a mention span keeps the agent label the web UI writes, and people keep name ids', () => {
  const mentions = [
    { agent_id: '4ef87c0d-7b08-4071-ba91-d1b720f2b24b', display_name: 'Runner 4' },
    { user_id: 2547, display_name: 'Health Check' },
  ]
  const html = convertPlainTextMentionsToHtml('<p>@Runner 4 asked @Health Check</p>', mentions)
  assert.match(html, /data-label="agent-4ef87c0d-7b08-4071-ba91-d1b720f2b24b"/)
  assert.match(html, /data-label="name-2547"/)
  assert.doesNotMatch(html, /data-label="agent-2547"/)
})

test('a wrong mention name is caller fixable, so it files no Bugs ticket', () => {
  assert.equal(callerCanFixRefusal({ code: 'unknown_mention', field: 'mentions' }, 400), true)
  assert.equal(callerCanFixRefusal({ code: 'ambiguous_mention', field: 'mentions' }, 400), true)
  assert.equal(quietInputRefusal({ status: 400, errorCode: 'unknown_mention', field: 'mentions' }), true)
  assert.equal(quietInputRefusal({ status: 400, errorCode: 'ambiguous_mention', field: 'mentions' }), true)
  assert.equal(callerCanFixRefusal({ code: 'not_project_member', field: 'mentions' }, 400), false)
})

test('the switch ships for everyone and names what it widens', () => {
  const { default: flag, HTPR_8513_AGENT_MENTIONS_FLAG: key } = load(
    'src/lib/flags/definitions/htpr-8513-agent-mentions.ts',
  )
  assert.equal(flag.key, key)
  assert.equal(flag.key, 'htpr-8513-agent-mentions')
  assert.equal(flag.kind, 'bugfix')
  assert.equal(flag.defaultMode, 'EVERYONE')
  assert.equal(flag.releaseRisk.risk, 'small')
})
