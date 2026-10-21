import { buildToolName } from '@/lib/mcp-server/config/mcp-standards'

type GuidedBoard = { id: number; title: string; createdAt: Date }

export function buildGuidedStart(boards: GuidedBoard[]) {
  const newestBoardANewUserJustMade = boards.reduce<GuidedBoard | null>(
    (best, board) => (!best || board.createdAt > best.createdAt ? board : best),
    null
  )
  if (!newestBoardANewUserJustMade) return { startBoard: null, nextSteps: [] }

  const id = newestBoardANewUserJustMade.id
  return {
    startBoard: {
      id,
      title: newestBoardANewUserJustMade.title,
      boardUrl: `https://app.hypertask.ai/project?id=${id}`,
    },
    nextSteps: [
      {
        step: 'See the board',
        command: `hypertask task list --project ${id}`,
        tool: buildToolName('list_tasks'),
        arguments: { project_id: id },
      },
      {
        step: 'Create a first task',
        command: `hypertask task create --project ${id} --title "My first task"`,
        tool: buildToolName('create_task'),
        arguments: { project_id: id, title: 'My first task' },
      },
      {
        step: 'Read the board rules',
        command: `hypertask project playbook ${id}`,
        tool: buildToolName('get_board_playbook'),
        arguments: { project_id: id },
      },
    ],
  }
}
