/**
 * First-line tool blurbs for progressive disclosure.
 * Each line states what the tool returns and stays under 100 characters.
 */
import { buildToolName } from './mcp-standards'

export const TOOL_SUMMARIES: Record<string, string> = {
  HELLO: 'Returns a welcome map.',
  AGENT_PRESENCE: 'Returns live agent status.',
  LIST_AGENTS: 'Returns owned agents.',
  AGENT_WEBHOOK: 'Returns webhook settings.',
  CREATE_AGENT: 'Returns the new agent token.',
  REVOKE_AGENT: 'Returns revoke confirmation.',
  ARCHIVE_AGENT: 'Returns the archived agent.',
  DELETE_AGENT: 'Returns delete confirmation.',
  MINT_TOKEN: 'Returns a new MCP token.',
  REVOKE_TOKEN: 'Returns token revoke result.',
  LIST_CONNECTIONS: 'Returns OAuth connections.',
  GET_USER_CONTEXT: 'Returns user and boards.',
  UPDATE_PROFILE: 'Returns the updated profile.',
  LIST_TASKS: 'Returns matching tasks.',
  GET_TASKS: 'Returns named task details.',
  TASK_CONTEXT: 'Returns task context.',
  TASK_DESCRIPTION_HISTORY: 'Returns description versions.',
  GET_TASK_TREE: 'Returns the task tree.',
  NEXT_TASKS: 'Returns the next tasks.',
  LINK_TASKS: 'Returns the task relation.',
  SEARCH_TASKS: 'Returns keyword matches.',
  RAG_RETRIEVAL: 'Returns semantic matches.',
  SEARCH_HELP_DOCS: 'Returns help articles.',
  FIND_RELATED_TASKS: 'Returns related tasks.',
  LIST_PROJECTS: 'Returns accessible boards.',
  PROJECT_ADMIN: 'Returns the board change.',
  BOARD_MANIFEST: 'Returns the board manifest.',
  GET_BOARD_PLAYBOOK: 'Returns the board playbook.',
  BOARD_CONFIG: 'Returns board instructions.',
  CREATE_BOARD: 'Returns the new board.',
  LIST_PROJECT_MEMBERS: 'Returns board members.',
  CREATE_LABEL: 'Returns the created label.',
  LIST_LABELS: 'Returns board labels.',
  LIST_CUSTOM_FIELDS: 'Returns custom fields.',
  SET_CUSTOM_FIELD_VALUE: 'Returns the field value.',
  SECTION_CRUD: 'Returns the column.',
  GET_COMMENTS: 'Returns task comments.',
  ADD_COMMENT: 'Returns the comment.',
  UPDATE_COMMENT: 'Returns the updated comment.',
  DELETE_COMMENT: 'Returns comment deletion.',
  CREATE_PAGE: 'Returns the created page.',
  GET_PAGE: 'Returns the page.',
  UPDATE_PAGE: 'Returns the updated page.',
  LIST_PAGES: 'Returns task or board pages.',
  SEARCH_PAGES: 'Returns matching pages.',
  PAGE_HISTORY: 'Returns page history.',
  REPORT_CRUD: 'Returns the report.',
  LIST_VIEWS: 'Returns saved views.',
  GET_VIEW: 'Returns one saved view.',
  CREATE_VIEW: 'Returns the created view.',
  UPDATE_VIEW: 'Returns the updated view.',
  DELETE_VIEW: 'Returns view deletion.',
  SWITCH_VIEW: 'Returns the active view.',
  LIST_SKILLS: 'Returns skills.',
  GET_SKILL: 'Returns one skill.',
  CREATE_SKILL: 'Returns the created skill.',
  UPDATE_SKILL: 'Returns the updated skill.',
  DELETE_SKILL: 'Returns skill deletion.',
  IMPORT_SKILLS: 'Returns imported skills.',
  ATTACH_FILES: 'Returns attachment URLs.',
  UPDATE_TASK: 'Returns the updated task.',
  CREATE_TASK: 'Returns the created task.',
  MOVE_TASK_BETWEEN_BOARDS: 'Returns the moved task.',
  ASSIGN_USER: 'Returns the assignees.',
  INBOX_LIST: 'Returns inbox items.',
  INBOX_ARCHIVE: 'Returns archived ids.',
  INBOX_UNARCHIVE: 'Returns restored ids.',
  MOVE_TASK_TO_INBOX: 'Returns inbox routing.',
  TIME: 'Returns timer or report.',
  PAUSE_TIMER: 'Returns the paused timer.',
  RESUME_TIMER: 'Returns the resumed timer.',
  DECISION_REQUEST: 'Returns the decision.',
  DRAFT_CRUD: 'Returns the draft.',
  SEARCH_TOOLS: 'Returns matching tools.',
  DESCRIBE_TOOL: 'Returns one tool schema.',
}

export const SEARCH_TOOLS_NAME = 'hypertask_search_tools'
export const DESCRIBE_TOOL_NAME = 'hypertask_describe_tool'

const TOOL_NAME_BASE_OVERRIDES: Record<string, string> = {
  SECTION_CRUD: 'section',
  GET_COMMENTS: 'get_comments_for_task',
  ADD_COMMENT: 'add_comment_to_task',
  REPORT_CRUD: 'report',
  DRAFT_CRUD: 'draft',
}

const TOOL_SUMMARY_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(TOOL_SUMMARIES).map(([key, summary]) => {
    if (key === 'SEARCH_TOOLS') return [SEARCH_TOOLS_NAME, summary]
    if (key === 'DESCRIBE_TOOL') return [DESCRIBE_TOOL_NAME, summary]
    return [buildToolName(TOOL_NAME_BASE_OVERRIDES[key] ?? key.toLowerCase()), summary]
  })
)

export function summaryForToolName(name: string, fallback: string): string {
  return TOOL_SUMMARY_BY_NAME[name] ?? fallback
}
