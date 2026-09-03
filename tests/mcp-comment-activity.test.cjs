const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const routePath = path.join(root, 'src/app/api/mcp/comments/route.ts')
const servicePath = path.join(
  root,
  'src/lib/mcp-server/lib/services/comment.service.ts'
)
const routeSource = fs.readFileSync(routePath, 'utf8').replace(/\s+/g, ' ')
const serviceSource = fs.readFileSync(servicePath, 'utf8').replace(/\s+/g, ' ')

const jiti = require('jiti')(
  path.join(root, 'tests/mcp-comment-activity-entry.cjs'),
  {
    interopDefault: true,
    alias: { '@': path.join(root, 'src') },
  }
)
const { withActivityMetadata } = jiti(
  path.join(root, 'src/lib/mcp/comments/activityMetadata.ts')
)
const { GetCommentsInputSchema } = jiti(
  path.join(root, 'src/lib/mcp-server/validations/comment.validation.ts')
)

test('comments query excludes activity by default', () => {
  assert.match(
    routeSource,
    /const includeActivity = searchParams\.get\('include_activity'\) === 'true'/
  )
  assert.match(
    routeSource,
    /const commentWhere: Prisma\.CommentWhereInput = includeActivity \? \{ taskId: task\.id \} : \{ taskId: task\.id, activity: \{ equals: Prisma\.DbNull \} \}/
  )
  assert.equal(
    GetCommentsInputSchema.parse({ task_id: 42 }).include_activity,
    false
  )
})

test('include_activity=true drops the DbNull filter and passes through the MCP client', () => {
  assert.match(
    routeSource,
    /includeActivity \? \{ taskId: task\.id \} : \{ taskId: task\.id, activity:/
  )
  // History defaults to oldest-first like the app endpoint, but an explicit
  // sort_order from the caller must still win.
  assert.match(
    routeSource,
    /includeActivity && !requestedSortOrder \? 'asc' : \(sortOrder as 'asc' \| 'desc'\)/
  )
  assert.equal(
    GetCommentsInputSchema.parse({
      task_id: 42,
      include_activity: true,
    }).include_activity,
    true
  )
  assert.match(
    serviceSource,
    /queryParams\.append\('include_activity', 'true'\)/
  )
})

test('comment agent identities are filtered for the requesting user', () => {
  assert.match(routeSource, /select: mcpVisibleAgentSelect\(userId\)/)
  assert.match(
    routeSource,
    /mapVisibleMcpAgent\(comment\.agent, userId\)/
  )
  assert.match(routeSource, /!comment\.agent \? !comment\.agentDisplayName/)
  assert.match(routeSource, /mapCommentToResponse\(comment, user\.id, includeActivity\)/)
})

test('activity serialization preserves TaskLabel status and label payload', () => {
  assert.match(
    routeSource,
    /if \(!includeActivity\) return mappedComment return withActivityMetadata\(mappedComment, comment\.activity\)/
  )

  const activity = {
    type: 'TaskLabel',
    status: 'Removed',
    data: {
      fromUser: { id: 6, displayName: 'Valentin' },
      toLabel: { label: { id: 75, value: 'Recovery' } },
    },
  }

  const serialized = withActivityMetadata(
    { id: 5107, text: '', createdAt: '2026-08-07T00:00:00.000Z' },
    activity
  )

  assert.equal(serialized.type, 'activity')
  assert.equal(serialized.activity.status, 'Removed')
  assert.equal(serialized.activity.data.toLabel.label.value, 'Recovery')
  assert.equal(serialized.activity.data.fromUser.displayName, 'Valentin')

  const comment = withActivityMetadata({ id: 5108, text: '<p>Done</p>' }, null)
  assert.equal(comment.type, 'comment')
  assert.equal(comment.activity, null)
})
