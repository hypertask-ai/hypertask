// Assert-based demo because this repository has no Vitest setup.
// Run: npx tsx src/lib/mcp-server/validations/parity-tools.validation.test.ts
//
// These schemas are the only thing standing between an LLM's guess and a
// malformed request to the REST API. Each case below is a request shape that
// would fail server-side, or silently do the wrong thing, if the refinement
// were dropped.
import assert from 'node:assert/strict'
import { PageHistoryInputSchema } from './page.validation'
import {
  CreateTaskInputSchema,
  TaskDescriptionHistoryInputSchema,
  LinkTasksInputSchema,
  UpdateTaskInputSchema,
} from './task.validation'
import {
  AddCommentCrudInputSchema,
  AddCommentInputSchema,
} from './comment.validation'
import {
  BoardConfigInputSchema,
  ProjectAdminInputSchema,
} from './project.validation'
import { UpdateProfileInputSchema } from './user.validation'
import { InboxListInputSchema } from './inbox.validation'

function rejects(schema: { parse: (v: unknown) => unknown }, value: unknown, because: string) {
  assert.throws(() => schema.parse(value), `expected rejection: ${because}`)
}

function demo() {
  const markdown = '**Bold markdown** without HTML tags'
  const markdownComment = {
    task_id: 1,
    text: markdown,
    content_type: 'markdown' as const,
  }

  assert.equal(
    AddCommentCrudInputSchema.parse({
      action: 'add',
      ...markdownComment,
    }).text,
    markdown
  )
  assert.equal(AddCommentInputSchema.parse(markdownComment).text, markdown)
  assert.equal(
    AddCommentCrudInputSchema.parse({
      action: 'add',
      ...markdownComment,
      reply_to_comment_id: 42,
    }).reply_to_comment_id,
    42
  )
  rejects(
    AddCommentCrudInputSchema,
    { action: 'add', task_id: 1, text: markdown },
    'add_comment keeps HTML validation when content_type is absent'
  )
  rejects(
    AddCommentInputSchema,
    { task_id: 1, text: markdown },
    'add_comment service validation keeps HTML validation when content_type is absent'
  )
  assert.equal(
    AddCommentCrudInputSchema.parse({
      action: 'update',
      comment_id: 1,
      text: '<p>Updated comment</p>',
    }).text,
    '<p>Updated comment</p>'
  )
  rejects(
    AddCommentCrudInputSchema,
    {
      action: 'update',
      comment_id: 1,
      text: '<p>Updated comment</p>',
      content_type: 'markdown',
    },
    'content_type is only available for add_comment action add'
  )
  rejects(
    AddCommentCrudInputSchema,
    {
      action: 'update',
      comment_id: 1,
      text: '<p>Updated comment</p>',
      reply_to_comment_id: 42,
    },
    'reply_to_comment_id is only available for add_comment action add'
  )

  assert.equal(
    CreateTaskInputSchema.parse({
      project_id: 1,
      title: 'Markdown task',
      description: markdown,
      content_type: 'markdown',
    }).description,
    markdown
  )
  rejects(
    CreateTaskInputSchema,
    { project_id: 1, title: 'HTML task', description: markdown },
    'create_task keeps HTML validation when content_type is absent'
  )

  assert.equal(
    UpdateTaskInputSchema.parse({
      task_id: 1,
      description: markdown,
      content_type: 'markdown',
    }).description,
    markdown
  )
  rejects(
    UpdateTaskInputSchema,
    { task_id: 1, description: markdown },
    'update_task keeps HTML validation when content_type is absent'
  )

  // page_history: restoring without naming a version would archive-or-restore
  // nothing and return a 400 from /mcp/pages/restore.
  assert.equal(PageHistoryInputSchema.parse({ action: 'versions', id: 1 }).action, 'versions')
  assert.equal(PageHistoryInputSchema.parse({ action: 'archive', id: 1 }).action, 'archive')
  rejects(PageHistoryInputSchema, { action: 'restore', id: 1 }, 'restore needs version_id')

  // task_description_history: same trap on the task side.
  assert.equal(
    TaskDescriptionHistoryInputSchema.parse({ action: 'restore', task_id: 1, version_id: 2 })
      .version_id,
    2
  )
  rejects(
    TaskDescriptionHistoryInputSchema,
    { action: 'restore', task_id: 1 },
    'restore needs version_id'
  )
  // It must take the same identifiers as its sibling task tools. Requiring the
  // internal numeric id made every caller holding a ticket number do a lookup
  // first, which nothing else on this surface does.
  assert.equal(
    TaskDescriptionHistoryInputSchema.parse({
      action: 'versions',
      ticket_number: 'HTPR-4834',
    }).ticket_number,
    'HTPR-4834'
  )
  assert.equal(
    TaskDescriptionHistoryInputSchema.parse({
      action: 'versions',
      project_id: 15,
      unique_index: 4834,
    }).unique_index,
    4834
  )
  rejects(
    TaskDescriptionHistoryInputSchema,
    { action: 'versions' },
    'needs some task identifier'
  )
  rejects(
    TaskDescriptionHistoryInputSchema,
    { action: 'versions', unique_index: 4834 },
    'unique_index alone is ambiguous without project_id'
  )

  // link_tasks: the default must stay 'link', or every existing caller that
  // omits action silently starts listing instead of linking.
  const linked = LinkTasksInputSchema.parse({
    source_task_id: 1,
    target_task_id: 2,
    relation_type: 'RelatedTo',
  })
  assert.equal(linked.action, 'link')
  assert.equal(LinkTasksInputSchema.parse({ action: 'list', task_id: 1 }).action, 'list')
  rejects(
    LinkTasksInputSchema,
    { source_task_id: 1, target_task_id: 2 },
    'link needs a relation_type'
  )
  rejects(
    LinkTasksInputSchema,
    { action: 'list', task_id: 1, ticket_number: 'HTPR-1' },
    'list takes exactly one identifier'
  )

  // board_config: writing instructions with no instruction would blank the
  // board's AI behaviour rather than leave it alone.
  assert.equal(
    BoardConfigInputSchema.parse({ action: 'get_playbook', project_id: 15 }).action,
    'get_playbook'
  )
  rejects(
    BoardConfigInputSchema,
    { action: 'set_instructions', project_id: 15 },
    'set_instructions needs custom_instruction'
  )

  // project_admin: an invite with nobody to invite.
  assert.equal(
    ProjectAdminInputSchema.parse({ action: 'archive', project_id: 15 }).action,
    'archive'
  )
  assert.equal(
    ProjectAdminInputSchema.parse({
      action: 'invite_member',
      project_id: 15,
      userToAdd: 'someone@example.com',
    }).project_id,
    15
  )
  rejects(
    ProjectAdminInputSchema,
    { action: 'invite_member', project_id: 15 },
    'invite_member needs userToAdd'
  )
  rejects(
    ProjectAdminInputSchema,
    { action: 'invite_member', project_id: 15, userToAdd: 'not an email' },
    'userToAdd must be an email or agent UUID'
  )

  // update_profile mirrors the route's own guards: at least one field, no
  // angle brackets in a display name, http(s) photo URLs only.
  assert.equal(UpdateProfileInputSchema.parse({ displayName: 'Valentin' }).displayName, 'Valentin')
  rejects(UpdateProfileInputSchema, {}, 'needs displayName or photoURL')
  rejects(UpdateProfileInputSchema, { displayName: '<script>' }, 'no angle brackets')
  rejects(UpdateProfileInputSchema, { photoURL: 'ftp://example.com/a.png' }, 'http(s) only')
  // The route reads an exact empty string as "leave this one alone", so the
  // tool must not be stricter than the endpoint it wraps.
  assert.equal(
    UpdateProfileInputSchema.parse({ displayName: 'Alice', photoURL: '' }).displayName,
    'Alice'
  )

  // inbox_list: composition hits a different endpoint that requires a board.
  assert.equal(
    InboxListInputSchema.parse({ composition: true, project_id: 15 }).project_id,
    15
  )
  rejects(InboxListInputSchema, { composition: true }, 'composition needs project_id')

  console.log('parity-tools.validation: all assertions passed')
}

demo()
