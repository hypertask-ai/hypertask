import { NextRequest } from 'next/server'
import { putAwayTask } from '@/lib/mcp/tasks/putAwayTask'

export async function POST(request: NextRequest) {
  return putAwayTask(request, 'archive')
}
