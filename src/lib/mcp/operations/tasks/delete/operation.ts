import { NextRequest } from 'next/server'
import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { putAwayTask } from '@/lib/mcp/tasks/putAwayTask'

export async function POST(request: NextRequest) {
  return wrapMcpRoute((req: NextRequest) => putAwayTask(req, 'delete'))(request)
}
