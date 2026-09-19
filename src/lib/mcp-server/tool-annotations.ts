import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { TOOL_METADATA } from './config/tool-metadata'

type ToolBehavior =
  | 'read'
  | 'write'
  | 'destructive'
  | 'open-read'
  | 'open-write'
  | 'open-destructive'

const TOOL_BEHAVIOR_BY_NAME: Record<string, ToolBehavior> = {
  [TOOL_METADATA.HELLO.name]: 'read',
  [TOOL_METADATA.AGENT_PRESENCE.name]: 'read',
  [TOOL_METADATA.LIST_AGENTS.name]: 'read',
  [TOOL_METADATA.AGENT_WEBHOOK.name]: 'open-destructive',
  [TOOL_METADATA.CREATE_AGENT.name]: 'write',
  [TOOL_METADATA.REVOKE_AGENT.name]: 'destructive',
  [TOOL_METADATA.ARCHIVE_AGENT.name]: 'write',
  [TOOL_METADATA.DELETE_AGENT.name]: 'destructive',
  [TOOL_METADATA.MINT_TOKEN.name]: 'write',
  [TOOL_METADATA.REVOKE_TOKEN.name]: 'destructive',
  [TOOL_METADATA.LIST_CONNECTIONS.name]: 'read',
  [TOOL_METADATA.GET_USER_CONTEXT.name]: 'read',
  [TOOL_METADATA.UPDATE_PROFILE.name]: 'destructive',
  [TOOL_METADATA.LIST_TASKS.name]: 'read',
  [TOOL_METADATA.GET_TASKS.name]: 'read',
  [TOOL_METADATA.TASK_CONTEXT.name]: 'read',
  [TOOL_METADATA.TASK_DESCRIPTION_HISTORY.name]: 'destructive',
  [TOOL_METADATA.GET_TASK_TREE.name]: 'read',
  [TOOL_METADATA.NEXT_TASKS.name]: 'read',
  [TOOL_METADATA.LINK_TASKS.name]: 'write',
  [TOOL_METADATA.SEARCH_TASKS.name]: 'read',
  [TOOL_METADATA.RAG_RETRIEVAL.name]: 'read',
  [TOOL_METADATA.SEARCH_HELP_DOCS.name]: 'open-read',
  [TOOL_METADATA.FIND_RELATED_TASKS.name]: 'read',
  [TOOL_METADATA.LIST_PROJECTS.name]: 'read',
  [TOOL_METADATA.PROJECT_ADMIN.name]: 'destructive',
  [TOOL_METADATA.BOARD_MANIFEST.name]: 'read',
  [TOOL_METADATA.GET_BOARD_PLAYBOOK.name]: 'read',
  [TOOL_METADATA.BOARD_CONFIG.name]: 'destructive',
  [TOOL_METADATA.CREATE_BOARD.name]: 'write',
  [TOOL_METADATA.LIST_PROJECT_MEMBERS.name]: 'read',
  [TOOL_METADATA.CREATE_LABEL.name]: 'write',
  [TOOL_METADATA.LIST_LABELS.name]: 'read',
  [TOOL_METADATA.LIST_CUSTOM_FIELDS.name]: 'read',
  [TOOL_METADATA.SET_CUSTOM_FIELD_VALUE.name]: 'destructive',
  [TOOL_METADATA.SECTION_CRUD.name]: 'destructive',
  [TOOL_METADATA.GET_COMMENTS.name]: 'read',
  [TOOL_METADATA.ADD_COMMENT.name]: 'destructive',
  [TOOL_METADATA.UPDATE_COMMENT.name]: 'destructive',
  [TOOL_METADATA.DELETE_COMMENT.name]: 'destructive',
  [TOOL_METADATA.CREATE_PAGE.name]: 'write',
  [TOOL_METADATA.GET_PAGE.name]: 'read',
  [TOOL_METADATA.UPDATE_PAGE.name]: 'destructive',
  [TOOL_METADATA.LIST_PAGES.name]: 'read',
  [TOOL_METADATA.SEARCH_PAGES.name]: 'read',
  [TOOL_METADATA.PAGE_HISTORY.name]: 'destructive',
  [TOOL_METADATA.REPORT_CRUD.name]: 'destructive',
  [TOOL_METADATA.LIST_VIEWS.name]: 'read',
  [TOOL_METADATA.GET_VIEW.name]: 'read',
  [TOOL_METADATA.CREATE_VIEW.name]: 'write',
  [TOOL_METADATA.UPDATE_VIEW.name]: 'destructive',
  [TOOL_METADATA.DELETE_VIEW.name]: 'destructive',
  [TOOL_METADATA.SWITCH_VIEW.name]: 'write',
  [TOOL_METADATA.LIST_SKILLS.name]: 'read',
  [TOOL_METADATA.GET_SKILL.name]: 'read',
  [TOOL_METADATA.CREATE_SKILL.name]: 'write',
  [TOOL_METADATA.UPDATE_SKILL.name]: 'destructive',
  [TOOL_METADATA.DELETE_SKILL.name]: 'destructive',
  [TOOL_METADATA.IMPORT_SKILLS.name]: 'open-destructive',
  [TOOL_METADATA.ATTACH_FILES.name]: 'open-write',
  [TOOL_METADATA.UPDATE_TASK.name]: 'open-destructive',
  [TOOL_METADATA.CREATE_TASK.name]: 'open-write',
  [TOOL_METADATA.MOVE_TASK_BETWEEN_BOARDS.name]: 'write',
  [TOOL_METADATA.ASSIGN_USER.name]: 'destructive',
  [TOOL_METADATA.INBOX_LIST.name]: 'read',
  [TOOL_METADATA.INBOX_ARCHIVE.name]: 'write',
  [TOOL_METADATA.INBOX_UNARCHIVE.name]: 'write',
  [TOOL_METADATA.MOVE_TASK_TO_INBOX.name]: 'destructive',
  [TOOL_METADATA.TIME.name]: 'write',
  [TOOL_METADATA.PAUSE_TIMER.name]: 'write',
  [TOOL_METADATA.RESUME_TIMER.name]: 'write',
  [TOOL_METADATA.DECISION_REQUEST.name]: 'destructive',
  [TOOL_METADATA.DRAFT_CRUD.name]: 'destructive',
}

const ANTHROPIC_TOOL_DESCRIPTIONS: Record<string, string> = {
  [TOOL_METADATA.LIST_PROJECTS.name]:
    'Lists boards the signed-in user can access, with optional status, text, and pagination filters.',
  [TOOL_METADATA.LIST_TASKS.name]:
    'Lists tasks in an accessible board with filters, sorting, selected fields, and pagination.',
  [TOOL_METADATA.GET_TASKS.name]:
    'Returns details for specified accessible tasks, including assignments, labels, dates, and task links.',
  [TOOL_METADATA.TASK_CONTEXT.name]:
    'Returns the parent, subtasks, relations, recent comments, and linked pull requests for one accessible task.',
  [TOOL_METADATA.SEARCH_TASKS.name]:
    'Searches accessible tasks by text, assignee, priority, column, due date, and status.',
  [TOOL_METADATA.LIST_PROJECT_MEMBERS.name]:
    'Lists the people and agents who belong to an accessible board.',
  [TOOL_METADATA.LIST_LABELS.name]:
    'Lists labels available on an accessible board, with optional text and pagination filters.',
  [TOOL_METADATA.GET_COMMENTS.name]:
    'Lists comments and optional activity history for one accessible task.',
  [TOOL_METADATA.CREATE_LABEL.name]: 'Creates a label on an accessible board.',
  [TOOL_METADATA.CREATE_TASK.name]:
    'Creates a task on an accessible board with optional description, column, planning fields, labels, and attachments.',
  [TOOL_METADATA.UPDATE_TASK.name]:
    'Updates an accessible task, including its text, column, planning fields, followers, labels, and attachments.',
  [TOOL_METADATA.ASSIGN_USER.name]: 'Assigns or unassigns people and agents on an accessible task.',
  [TOOL_METADATA.ATTACH_FILES.name]:
    'Adds inline files or files fetched from supplied HTTP URLs to an accessible task.',
  [TOOL_METADATA.CREATE_PAGE.name]: 'Creates a rich document attached to an accessible task.',
  [TOOL_METADATA.GET_PAGE.name]: 'Returns one accessible task document as markdown or HTML.',
  [TOOL_METADATA.LIST_PAGES.name]: 'Lists accessible task documents for one task or board.',
  [TOOL_METADATA.SEARCH_PAGES.name]: 'Searches titles and content across accessible task documents.',
  [TOOL_METADATA.UPDATE_PAGE.name]:
    'Renames, replaces, appends to, or prepends content to an accessible task document.',
}

export type DirectoryProfile = 'anthropic' | 'openai'

type DirectoryTool = {
  name: string
  description: string
}

function behaviorForTool(name: string): ToolBehavior {
  const behavior = TOOL_BEHAVIOR_BY_NAME[name]
  if (!behavior) throw new Error(`Missing directory annotations for MCP tool: ${name}`)
  return behavior
}

function titleForToolName(name: string): string {
  return name
    .replace(/^hypertask_/, '')
    .split('_')
    .map((word) => (word === 'rag' ? 'RAG' : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join(' ')
}

export function directoryProfileFromUrl(url: string | URL): DirectoryProfile | undefined {
  const profile = new URL(url).searchParams.get('directory')
  return profile === 'anthropic' || profile === 'openai' ? profile : undefined
}

export function openAiDirectoryToolAnnotations(name: string): ToolAnnotations {
  const behavior = behaviorForTool(name)
  return {
    title: titleForToolName(name),
    readOnlyHint: behavior === 'read' || behavior === 'open-read',
    destructiveHint: behavior === 'destructive' || behavior === 'open-destructive',
    openWorldHint: behavior.startsWith('open-'),
  }
}

export function anthropicDirectoryToolAnnotations(name: string): ToolAnnotations {
  const behavior = behaviorForTool(name)
  const readOnly = behavior === 'read' || behavior === 'open-read'
  return {
    title: titleForToolName(name),
    readOnlyHint: readOnly,
    destructiveHint: !readOnly,
    openWorldHint: behavior.startsWith('open-'),
  }
}

export function toolsForDirectoryProfile<T extends DirectoryTool>(
  tools: readonly T[],
  profile: DirectoryProfile
): Array<T & { annotations: ToolAnnotations }> {
  if (profile === 'openai') {
    return tools.map((tool) => ({
      ...tool,
      annotations: openAiDirectoryToolAnnotations(tool.name),
    }))
  }

  return tools
    .filter((tool) => tool.name in ANTHROPIC_TOOL_DESCRIPTIONS)
    .map((tool) => ({
      ...tool,
      description: ANTHROPIC_TOOL_DESCRIPTIONS[tool.name],
      annotations: anthropicDirectoryToolAnnotations(tool.name),
    }))
}
