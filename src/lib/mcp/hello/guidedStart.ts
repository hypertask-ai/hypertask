import type { AgentRole } from '@/lib/mcp/agents/scopes'
import { buildToolName } from '@/lib/mcp-server/config/mcp-standards'

type GuidedBoard = { id: number; title: string | null; name: string }

export function buildGuidedStart(
  newestBoard: GuidedBoard | null,
  consolidated: boolean,
  agentRole: AgentRole
) {
  if (!newestBoard) return { startBoard: null, nextSteps: [] }

  const id = newestBoard.id
  return {
    startBoard: {
      id,
      title: newestBoard.title ?? newestBoard.name,
      boardUrl: `https://app.hypertask.ai/project?id=${id}`,
    },
    nextSteps: [
      {
        step: 'See the board',
        command: `hypertask task list --project ${id}`,
        tool: buildToolName(consolidated ? 'tasks' : 'list_tasks'),
        arguments: consolidated ? { action: 'list', input: { project_id: id } } : { project_id: id },
      },
      ...(agentRole === 'read' ? [] : [{
        step: 'Create a first task',
        command: `hypertask task create --project ${id} --title "My first task"`,
        tool: buildToolName(consolidated ? 'tasks' : 'create_task'),
        arguments: consolidated
          ? { action: 'create', input: { project_id: id, title: 'My first task' } }
          : { project_id: id, title: 'My first task' },
      }]),
      {
        step: 'Read the board rules',
        command: `hypertask project playbook ${id}`,
        tool: buildToolName(consolidated ? 'projects' : 'get_board_playbook'),
        arguments: consolidated ? { action: 'playbook', input: { project_id: id } } : { project_id: id },
      },
    ],
  }
}
