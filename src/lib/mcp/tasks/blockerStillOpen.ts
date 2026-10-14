import { isDoneColumn } from '@/lib/doneColumns'
import { columnRole } from '@/lib/mcp/boards/columnRole'

const mcpDoneNameFallback = (title: string) => columnRole(title) === 'done'

export function blockerStillOpen(blocker: {
  status: string
  section: string
}, doneTitles?: ReadonlySet<string>): boolean {
  return (
    blocker.status === 'Normal' &&
    !isDoneColumn(blocker.section, doneTitles, mcpDoneNameFallback)
  )
}
