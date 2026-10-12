const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const editedAt = new Date('2026-10-12T06:00:00.000Z')
const createdAt = new Date('2026-10-11T06:00:00.000Z')
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [editedAt.getTime()])) }
}
const json = (body, init = {}) => ({ body: JSON.parse(JSON.stringify(body)), status: init.status ?? 200 })

function load(relativePath, modules = {}) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const loadedModule = { exports: {} }
  new Function('module', 'exports', 'require', 'Date', javascript)(loadedModule, loadedModule.exports, (name) => {
    if (Object.hasOwn(modules, name)) return modules[name]
    throw new Error(`Unexpected import: ${name}`)
  }, FixedDate)
  return loadedModule.exports
}

function serviceFixture() {
  const stored = { id: 44, text: 'original', creatorId: 6, agentId: null, taskId: 91, createdAt, editedAt: null, editedByUserId: null, editedByAgentId: null, task: { projectId: 15 } }
  const writes = []
  const update = async ({ data }) => {
    writes.push(data)
    Object.assign(stored, data)
    return stored
  }
  const prisma = {
    comment: { findFirst: async () => stored, update },
    $transaction: async (run) => run({ comment: { update } }),
  }
  const service = load('src/utils/controllers/comments/updateCommentService.ts', {
    '@/lib/prisma': { default: prisma, __esModule: true },
    '@/utils/controllers/projects/getAllIncludes': { projectContentAccessWhere: () => ({}) },
    '@/utils/controllers/turbopuffer/turbopufferHelper': { upsertCommentToTurbopuffer: () => {} },
    '@/pages/api/queues/FAST/generateSummary': { default: async () => {}, __esModule: true },
    '@/pages/api/queues/FAST/generateCommentSummary': { default: async () => {}, __esModule: true },
    './processMentions': { processMentionsFromCommentText: async () => {} },
    './readReceipts': { omitCommentSeen: (comment) => comment },
    '@/lib/ai/hyperAiConfirmation': { invalidateHyperAiCommentOrigin: async () => {} },
    '@/lib/agents/publicAgent': { publicAgentSelect: {} },
    '@/lib/mcp/normalizeBlockHtml': { normalizeBlockHtml: (text) => text },
  })
  return { stored, writes, prisma, ...service }
}

test('comment migration adds nullable edit timestamp and editor IDs without a default or backfill', () => {
  const schema = fs.readFileSync(path.join(root, 'src/prisma/schema.prisma'), 'utf8')
  const comment = schema.match(/model Comment \{([\s\S]*?)\n\}/)[1]
  assert.match(comment, /^\s*editedAt\s+DateTime\?\s*$/m)
  assert.match(comment, /^\s*editedByUserId\s+Int\?\s*$/m)
  assert.match(comment, /^\s*editedByAgentId\s+String\?\s*$/m)
  assert.doesNotMatch(comment, /updatedAt/)
  const migration = fs.readFileSync(path.join(root, 'src/prisma/migrations/20261012060000_yper4_321_comment_edited_at/migration.sql'), 'utf8')
  const sql = migration.replace(/--[^\n]*/g, '')
  assert.match(sql, /ALTER TABLE "Comment"\s+ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP\(3\),\s+ADD COLUMN IF NOT EXISTS "editedByUserId" INTEGER,\s+ADD COLUMN IF NOT EXISTS "editedByAgentId" TEXT;/)
  const forbidden = /\b(DEFAULT|NOT NULL|UPDATE|DROP)\b/i
  assert.doesNotMatch(sql, forbidden)
  assert.match('UPDATE "Comment" SET "editedAt" = NOW();', forbidden)
})

test('shared app, MCP, CLI and AI comment edit service persists the edit time without changing creation time', async () => {
  const fixture = serviceFixture()
  assert.equal(fixture.stored.editedAt, null)
  const result = await fixture.updateCommentService({ commentId: 44, text: 'edited', userId: 6 })
  assert.deepEqual(fixture.writes, [{ text: 'edited', summary: null, editedAt: new FixedDate(), editedByUserId: 6, editedByAgentId: null }])
  assert.equal(result.createdAt, createdAt)
  assert.equal(result.editedAt.toISOString(), editedAt.toISOString())
})

test('legacy comment edit controller also persists an edit time', async () => {
  const fixture = serviceFixture()
  const { default: handler } = load('src/utils/controllers/comments/updateComment.ts', {
    '@/lib/prisma': { default: fixture.prisma, __esModule: true },
    '@/lib/ai/hyperAiConfirmation': { invalidateHyperAiCommentOrigin: async () => {} },
    '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId: 9 }) },
  })
  const res = { status(code) { this.code = code; return this }, json(body) { return json(body, { status: this.code }) } }
  const result = await handler({ method: 'PUT', body: { updatedComment: { text: 'legacy edit', creatorId: 6, taskId: 91, commentId: 44 } } }, res)
  assert.equal(result.status, 200)
  assert.deepEqual(fixture.writes, [{ text: 'legacy edit', editedAt: new FixedDate(), editedByUserId: 9, editedByAgentId: null }])
  assert.equal(result.body.editedAt, editedAt.toISOString())
})

for (const agentId of [null, 'agent-editor']) {
test(`MCP PATCH records and serializes the ${agentId ? 'owner-agent' : 'human'} editor without changing authorship`, async () => {
  const fixture = serviceFixture()
  fixture.stored.task = { id: 91, projectId: 15, project: { ownerId: 6, members: [] } }
  fixture.prisma.comment.findUnique = async () => fixture.stored
  const { PATCH } = load('src/lib/mcp/operations/comments/[comment_id]/operation.ts', {
    'next/server': { NextResponse: { json } },
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute: (handler) => handler,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => ({ user: { id: 6 }, agentId }),
    },
    '@/lib/mcp/agents': { mapVisibleMcpAgent: () => undefined, mcpVisibleAgentSelect: () => ({}) },
    '@/lib/agents/publicAgent': {},
    '@/lib/flags': { isFeatureEnabled: async () => false },
    '@/lib/prisma': { default: fixture.prisma, __esModule: true },
    '@/utils/controllers/comments/processMentions': {},
    '@/utils/controllers/comments/updateCommentService': { updateCommentService: fixture.updateCommentService },
    '@/utils/controllers/comments/deleteCommentService': {},
    '@/utils/controllers/urls/extractUrlsFromContent': { persistUrlsForComment: async () => {} },
    '@/lib/configs/general.config': {},
    '@/lib/realtime/server': { broadcastTaskComment: async () => {} },
    '@/lib/mcp/tasks/services': {},
    '@/utils/helperFunctions/sanitizeRichHtml': { sanitizeRichHtml: (text) => text },
    '@/utils/helperFunctions/multiPages': { extractTipTapContent: () => ({ mentions: [] }) },
    '@/lib/mcp/normalizeBlockHtml': { normalizeBlockHtml: (text) => text },
    '@/lib/mcp/tasks/validators': {},
    '@/utils/helperFunctions/markdownToHtml': { formatRichTextInput: (text) => text },
  })
  const response = await PATCH({ json: async () => ({ text: 'edited' }) }, { params: Promise.resolve({ comment_id: '44' }) })
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, {
    success: true,
    comment: { id: 44, text: 'edited', createdAt: createdAt.toISOString(), editedAt: editedAt.toISOString(), editedBy: { userId: 6, agentId }, creatorId: 6 },
  })
  assert.equal(fixture.writes.length, 1)
  assert.equal(fixture.stored.agentId, null)
  assert.equal(fixture.writes[0].editedByUserId, 6)
  assert.equal(fixture.writes[0].editedByAgentId, agentId)
})
}

test('a later human edit clears the previous agent editor without changing the agent author', async () => {
  const fixture = serviceFixture()
  fixture.stored.agentId = 'agent-author'
  await fixture.updateCommentService({ commentId: 44, text: 'agent edit', userId: 6, agentId: 'agent-editor' })
  const result = await fixture.updateCommentService({ commentId: 44, text: 'human edit', userId: 6 })
  assert.equal(result.editedByUserId, 6)
  assert.equal(result.editedByAgentId, null)
  assert.equal(result.agentId, 'agent-author')
  assert.equal(result.creatorId, 6)
})

test('the AI comment edit tool passes its acting agent into the shared service', async () => {
  const fixture = serviceFixture()
  fixture.stored.task = { id: 91, projectId: 15, project: { ownerId: 6, members: [] } }
  fixture.prisma.comment.findUnique = async () => fixture.stored
  const { createUpdateCommentTool } = load('src/lib/ai/tools/updateComment.ts', {
    ai: { tool: (definition) => definition },
    zod: require('zod'),
    '@/lib/prisma': { default: fixture.prisma, __esModule: true },
    '@/utils/controllers/comments/processMentions': {},
    '@/utils/helperFunctions/toStoredHtml': { toStoredHtml: (text) => text },
    '@/utils/controllers/comments/linkifyTicketRefs': { linkifyTicketRefs: async (text) => text },
    '@/utils/controllers/comments/updateCommentService': { updateCommentService: fixture.updateCommentService },
    '@/utils/controllers/urls/extractUrlsFromContent': { persistUrlsForComment: async () => {} },
    '@/lib/realtime/server': { broadcastTaskComment: async () => {} },
    '@/lib/flags': { isFeatureEnabled: async () => false },
    '@/lib/flags/keys': {},
    '@/lib/ai/chatStream/prompt': {},
    '@/lib/ai/tools/execution': { withToolErrors: (handler) => handler },
    '@/lib/ai/tools/helpers': {
      userHasProjectAccess: () => true,
      validateMentionUsers: async () => null,
      commentInclude: () => ({}),
      mapCommentToResponse: (comment) => comment,
      applyDurableCommentAttribution: (comment) => comment,
      sanitizeForJson: (value) => value,
    },
  })
  const tools = createUpdateCommentTool({ user: { id: 6 }, actingAgentId: 'agent-ai', sendStatus: () => {} })
  const response = await tools.hypertask_update_comment.execute({ comment_id: 44, text: 'AI edit' })
  assert.equal(response.success, true)
  assert.equal(fixture.stored.editedByUserId, 6)
  assert.equal(fixture.stored.editedByAgentId, 'agent-ai')
  assert.equal(fixture.stored.creatorId, 6)
  assert.equal(fixture.stored.agentId, null)
})

test('non-text mutation paths do not set comment edit metadata', () => {
  const metadata = /\bedited(?:At|ByUserId|ByAgentId)\b/
  assert.match('data: { text, editedAt: new Date(), editedByUserId: userId }', metadata)
  for (const file of [
    'src/utils/controllers/activities/createTaskMovedActivity.ts',
    'src/app/api/ai/_lib/commentSummaries.ts',
    'src/lib/mcp/agents/ownedAgents.ts',
    'src/lib/api/notification-writes/comments-seen.ts',
    'src/lib/mcp/comments/reactionStore.ts',
  ]) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), metadata, file)
  }
})

test('reaction writes select original creation times and the HTTP handler returns them without editing the comment', async () => {
  const { writeCommentReaction } = load('src/lib/mcp/comments/reactionStore.ts')
  const { mapReactionWriteResult, commentReactionInclude } = load('src/lib/mcp/comments/reactionResponse.ts')
  const { createCommentReactionHandler } = load('src/lib/mcp/comments/reactionHandler.ts', { 'next/server': { NextResponse: { json } } })
  assert.equal(commentReactionInclude.select.createdAt, true)
  const row = { id: 'reaction-1', emoji: '👍', userId: 6, createdAt, agentId: null, agentDisplayName: null }
  const tx = { reaction: {
    findMany: async ({ select }) => { if (select) assert.equal(select.createdAt, true); return [row] },
    update: async ({ select, data }) => { assert.equal(select.createdAt, true); assert.equal(data.createdAt, undefined); return row },
  } }
  const handler = createCommentReactionHandler({
    checkRateLimit: async () => null,
    validateAuth: async () => ({ userId: 6 }),
    authorizeWrite: async () => null,
    actorUserId: (ctx) => ctx.userId,
    findTarget: async () => ({ commentId: 44, taskId: 91 }),
    setReaction: async (target, userId, emoji, active) => {
      const result = await writeCommentReaction(tx, { ...target, userId, emoji, active, agent: null })
      return mapReactionWriteResult({ changed: false, ...result }, async () => new Map())
    },
    afterChange: async () => {},
  })
  const response = await handler({ json: async () => ({ emoji: '👍', active: true }) }, { params: Promise.resolve({ comment_id: '44' }) })
  assert.equal(response.status, 200)
  assert.equal(response.body.reaction.createdAt, createdAt.toISOString())
  assert.equal(response.body.reactions[0].createdAt, createdAt.toISOString())
  const agent = await mapReactionWriteResult({ reaction: { ...row, agentId: 'agent-1' }, reactions: [] }, async () => new Map())
  assert.equal(agent.reaction.createdAt, createdAt.toISOString())
  assert.equal(agent.reaction.agent.displayName, 'Private agent')
})
