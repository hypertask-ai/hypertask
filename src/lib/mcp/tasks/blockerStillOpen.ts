import { isDoneColumn } from '@/lib/doneColumns'
import { columnRole } from '@/lib/mcp/boards/columnRole'

const mcpDoneNameFallback = (title: string) => columnRole(title) === 'done'

/**
 * Whether a blocking task still blocks. In Hypertask "done" is a column, not a
 * status (a finished task keeps status Normal), so a blocker is resolved once it
 * is archived/deleted OR sits in a resolved done column.
 */
export function blockerStillOpen(blocker: {
  status: string
  section: string
}, doneTitles?: ReadonlySet<string>): boolean {
  return (
    blocker.status === 'Normal' &&
    !isDoneColumn(blocker.section, doneTitles, mcpDoneNameFallback)
  )
}
