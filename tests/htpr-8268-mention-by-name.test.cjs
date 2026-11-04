const test = require('node:test')
const assert = require('node:assert/strict')
const { loadModule: load } = require('./helpers/loadModule.cjs')

const members = [
  { id: 193, displayName: 'Abdul Wahhab', email: 'abdul@example.com' },
  { id: 985, displayName: 'Mohsin', email: 'mohsin@example.com' },
  { id: 42, displayName: 'Mohsin Ali', email: 'mohsin.ali@example.com' },
  { id: 6, displayName: 'Valentin Yeo', email: 'valentin.yeo@gmail.com' },
]

const boardMembers = { getProjectMembers: async () => ({ members, error: null }) }

const { resolveMentionEntries, closeMentionMatches } = load('src/utils/controllers/comments/resolveMentions.ts')
const { resolveMentionInputs, mentionProblemMessage, isValidMentionObject } = load(
  'src/utils/controllers/comments/resolveMentionInputs.ts',
  { '@/utils/controllers/projects/getProjectMembers': boardMembers },
)
const { getAddCommentInputSchema } = load('src/lib/mcp-server/validations/comment.validation.ts')

test('a display name resolves to its user id', () => {
  const { resolved, problems } = resolveMentionEntries(['Valentin Yeo'], members)
  assert.deepEqual(problems, [])
  assert.deepEqual(resolved, [{ userId: 6, displayName: 'Valentin Yeo' }])
})

test('a display name matches regardless of case and a leading @', () => {
  const { resolved } = resolveMentionEntries(['@valentin yeo'], members)
  assert.deepEqual(resolved, [{ userId: 6, displayName: 'Valentin Yeo' }])
})

test('a user id resolves without the name', () => {
  const { resolved } = resolveMentionEntries(['985'], members)
  assert.deepEqual(resolved, [{ userId: 985, displayName: 'Mohsin' }])
})

test('an exact name beats a longer name that starts the same way', () => {
  const { resolved, problems } = resolveMentionEntries(['Mohsin'], members)
  assert.deepEqual(problems, [])
  assert.deepEqual(resolved, [{ userId: 985, displayName: 'Mohsin' }])
})

test('a unique prefix resolves', () => {
  const { resolved } = resolveMentionEntries(['Valen'], members)
  assert.deepEqual(resolved, [{ userId: 6, displayName: 'Valentin Yeo' }])
})

test('a name matching two people is refused with both candidates', () => {
  const { resolved, problems } = resolveMentionEntries(['Mohs'], members)
  assert.deepEqual(resolved, [])
  assert.equal(problems.length, 1)
  assert.equal(problems[0].reason, 'ambiguous')
  assert.deepEqual(problems[0].closeMatches, ['Mohsin', 'Mohsin Ali'])
})

test('an unknown name is refused with close matches, never guessed', () => {
  const { resolved, problems } = resolveMentionEntries(['Valentino'], members)
  assert.deepEqual(resolved, [])
  assert.equal(problems.length, 1)
  assert.equal(problems[0].reason, 'unknown')
  assert.deepEqual(problems[0].closeMatches, ['Valentin Yeo'])
})

test('no close match still names the lookup tool', () => {
  const message = mentionProblemMessage({ input: 'Nobody', reason: 'unknown', closeMatches: [] })
  assert.match(message, /is not a person or agent on this board/)
  assert.match(message, /list_project_members/)
})

test('the refusal message offers the close matches', () => {
  const message = mentionProblemMessage({ input: 'Valentino', reason: 'unknown', closeMatches: ['Valentin Yeo'] })
  assert.match(message, /Did you mean "Valentin Yeo"\?/)
})

test('close matches stay short and include the members it is given', () => {
  const withAgent = [...members, { id: 'agent-1', displayName: 'Valentin Bot' }]
  assert.deepEqual(closeMentionMatches('Valentin', withAgent), ['Valentin Yeo', 'Valentin Bot'])
  assert.deepEqual(closeMentionMatches('Valentin', members), ['Valentin Yeo'])
})

test('names and object entries both resolve for a project', async () => {
  const resolution = await resolveMentionInputs({
    inputs: ['Mohsin', { user_id: 6, display_name: 'Valentin Yeo' }],
    projectId: 15,
    requestingUserId: 985,
  })
  assert.equal(resolution.invalid, false)
  assert.deepEqual(resolution.problems, [])
  assert.deepEqual(resolution.mentions, [
    { user_id: 6, display_name: 'Valentin Yeo' },
    { user_id: 985, display_name: 'Mohsin' },
  ])
})

test('a malformed object entry is flagged as invalid, not resolved', async () => {
  const resolution = await resolveMentionInputs({
    inputs: [{ user_id: 0, display_name: '  ' }],
    projectId: 15,
    requestingUserId: 985,
  })
  assert.equal(resolution.invalid, true)
  assert.deepEqual(resolution.mentions, [])
})

test('the object form still accepts the old shape', () => {
  assert.equal(isValidMentionObject({ user_id: 6, display_name: 'Valentin Yeo' }), true)
  assert.equal(isValidMentionObject({ display_name: 'Valentin Yeo' }), false)
})

test('the MCP add-comment schema takes mention names, an unknown shape is refused', () => {
  const schema = getAddCommentInputSchema()
  const accepted = schema.safeParse({ task_id: 1, text: 'Hi @Mohsin', mentions: ['Mohsin', '985'] })
  assert.equal(accepted.success, true)
  const refused = schema.safeParse({ task_id: 1, text: 'Hi', mentions: [''] })
  assert.equal(refused.success, false)
})

test('a flag switches name mentions on for everyone', () => {
  const { default: flag, HTPR_8268_MENTION_BY_NAME_FLAG: key } = load(
    'src/lib/flags/definitions/htpr-8268-mention-by-name.ts',
  )
  assert.equal(flag.key, key)
  assert.equal(flag.key, 'htpr-8268-mention-by-name')
  assert.equal(flag.kind, 'improvement')
  assert.equal(flag.defaultMode, 'EVERYONE')
})

test('two people with the same display name are refused, never picked', () => {
  const twins = [
    { id: 11, displayName: 'Mohsin', email: 'a@example.com' },
    { id: 12, displayName: 'mohsin', email: 'b@example.com' },
  ]
  const { resolved, problems } = resolveMentionEntries(['Mohsin'], twins)
  assert.deepEqual(resolved, [])
  assert.equal(problems.length, 1)
  assert.equal(problems[0].reason, 'ambiguous')
  assert.deepEqual(problems[0].closeMatches, ['Mohsin', 'mohsin'])
})
