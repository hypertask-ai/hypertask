import type { NextRequest } from 'next/server'
import { ApiError } from '@/lib/mcp-server/utils/errors'

type Operation = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response> | Response
type OperationModule = Record<string, unknown>
type OperationDefinition = {
  pattern: RegExp
  params: string[]
  methods: string[]
  load: () => Promise<OperationModule>
}

const operations: OperationDefinition[] = [
  { pattern: /^\/mcp\/tasks\/description-versions$/, params: [], methods: ["GET"], load: () => import('./tasks/description-versions/operation') },
  { pattern: /^\/mcp\/tasks\/description-restore$/, params: [], methods: ["POST"], load: () => import('./tasks/description-restore/operation') },
  { pattern: /^\/mcp\/custom-fields\/value$/, params: [], methods: ["POST"], load: () => import('./custom-fields/value/operation') },
  { pattern: /^\/mcp\/admin\/connections$/, params: [], methods: ["GET"], load: () => import('./admin/connections/operation') },
  { pattern: /^\/mcp\/tasks\/attachments$/, params: [], methods: ["GET","POST"], load: () => import('./tasks/attachments/operation') },
  { pattern: /^\/mcp\/inbox\/composition$/, params: [], methods: ["GET"], load: () => import('./inbox/composition/operation') },
  { pattern: /^\/mcp\/assignees\/assign$/, params: [], methods: ["POST"], load: () => import('./assignees/assign/operation') },
  { pattern: /^\/mcp\/projects\/archive$/, params: [], methods: ["POST"], load: () => import('./projects/archive/operation') },
  { pattern: /^\/mcp\/agents\/presence$/, params: [], methods: ["GET"], load: () => import('./agents/presence/operation') },
  { pattern: /^\/mcp\/tasks\/relations$/, params: [], methods: ["POST","GET","DELETE"], load: () => import('./tasks/relations/operation') },
  { pattern: /^\/mcp\/inbox\/unarchive$/, params: [], methods: ["POST"], load: () => import('./inbox/unarchive/operation') },
  { pattern: /^\/mcp\/pages\/versions$/, params: [], methods: ["GET"], load: () => import('./pages/versions/operation') },
  { pattern: /^\/mcp\/reports\/create$/, params: [], methods: ["POST"], load: () => import('./reports/create/operation') },
  { pattern: /^\/mcp\/reports\/update$/, params: [], methods: ["POST"], load: () => import('./reports/update/operation') },
  { pattern: /^\/mcp\/reports\/delete$/, params: [], methods: ["POST"], load: () => import('./reports/delete/operation') },
  { pattern: /^\/mcp\/tasks\/context$/, params: [], methods: ["GET"], load: () => import('./tasks/context/operation') },
  { pattern: /^\/mcp\/tasks\/related$/, params: [], methods: ["GET","POST"], load: () => import('./tasks/related/operation') },
  { pattern: /^\/mcp\/custom-fields$/, params: [], methods: ["GET","POST"], load: () => import('./custom-fields/operation') },
  { pattern: /^\/mcp\/inbox\/archive$/, params: [], methods: ["POST"], load: () => import('./inbox/archive/operation') },
  { pattern: /^\/mcp\/pages\/restore$/, params: [], methods: ["POST"], load: () => import('./pages/restore/operation') },
  { pattern: /^\/mcp\/pages\/archive$/, params: [], methods: ["POST"], load: () => import('./pages/archive/operation') },
  { pattern: /^\/mcp\/skills\/import$/, params: [], methods: ["POST"], load: () => import('./skills/import/operation') },
  { pattern: /^\/mcp\/admin\/agents$/, params: [], methods: ["GET","POST","DELETE"], load: () => import('./admin/agents/operation') },
  { pattern: /^\/mcp\/admin\/tokens$/, params: [], methods: ["POST","DELETE"], load: () => import('./admin/tokens/operation') },
  { pattern: /^\/mcp\/tasks\/create$/, params: [], methods: ["POST"], load: () => import('./tasks/create/operation') },
  { pattern: /^\/mcp\/tasks\/update$/, params: [], methods: ["POST"], load: () => import('./tasks/update/operation') },
  { pattern: /^\/mcp\/tasks\/search$/, params: [], methods: ["GET"], load: () => import('./tasks/search/operation') },
  { pattern: /^\/mcp\/pages\/create$/, params: [], methods: ["POST"], load: () => import('./pages/create/operation') },
  { pattern: /^\/mcp\/pages\/update$/, params: [], methods: ["POST"], load: () => import('./pages/update/operation') },
  { pattern: /^\/mcp\/pages\/search$/, params: [], methods: ["GET"], load: () => import('./pages/search/operation') },
  { pattern: /^\/mcp\/reports\/list$/, params: [], methods: ["GET"], load: () => import('./reports/list/operation') },
  { pattern: /^\/mcp\/time\/running$/, params: [], methods: ["GET"], load: () => import('./time/running/operation') },
  { pattern: /^\/mcp\/user\/context$/, params: [], methods: ["GET"], load: () => import('./user/context/operation') },
  { pattern: /^\/mcp\/user\/profile$/, params: [], methods: ["PATCH"], load: () => import('./user/profile/operation') },
  { pattern: /^\/mcp\/reports\/get$/, params: [], methods: ["GET"], load: () => import('./reports/get/operation') },
  { pattern: /^\/mcp\/time\/resume$/, params: [], methods: ["POST"], load: () => import('./time/resume/operation') },
  { pattern: /^\/mcp\/time\/status$/, params: [], methods: ["POST"], load: () => import('./time/status/operation') },
  { pattern: /^\/mcp\/time\/report$/, params: [], methods: ["GET"], load: () => import('./time/report/operation') },
  { pattern: /^\/mcp\/tasks\/move$/, params: [], methods: ["POST"], load: () => import('./tasks/move/operation') },
  { pattern: /^\/mcp\/tasks\/next$/, params: [], methods: ["GET"], load: () => import('./tasks/next/operation') },
  { pattern: /^\/mcp\/tasks\/tree$/, params: [], methods: ["GET"], load: () => import('./tasks/tree/operation') },
  { pattern: /^\/mcp\/inbox\/list$/, params: [], methods: ["GET"], load: () => import('./inbox/list/operation') },
  { pattern: /^\/mcp\/inbox\/move$/, params: [], methods: ["POST"], load: () => import('./inbox/move/operation') },
  { pattern: /^\/mcp\/pages\/list$/, params: [], methods: ["GET"], load: () => import('./pages/list/operation') },
  { pattern: /^\/mcp\/time\/start$/, params: [], methods: ["POST"], load: () => import('./time/start/operation') },
  { pattern: /^\/mcp\/time\/pause$/, params: [], methods: ["POST"], load: () => import('./time/pause/operation') },
  { pattern: /^\/mcp\/decisions$/, params: [], methods: ["POST","GET"], load: () => import('./decisions/operation') },
  { pattern: /^\/mcp\/pages\/get$/, params: [], methods: ["GET"], load: () => import('./pages/get/operation') },
  { pattern: /^\/mcp\/time\/stop$/, params: [], methods: ["POST"], load: () => import('./time/stop/operation') },
  { pattern: /^\/mcp\/comments$/, params: [], methods: ["GET","POST"], load: () => import('./comments/operation') },
  { pattern: /^\/mcp\/projects$/, params: [], methods: ["GET"], load: () => import('./projects/operation') },
  { pattern: /^\/mcp\/time\/log$/, params: [], methods: ["POST"], load: () => import('./time/log/operation') },
  { pattern: /^\/mcp\/webhooks$/, params: [], methods: ["GET","POST","DELETE"], load: () => import('./webhooks/operation') },
  { pattern: /^\/mcp\/agents$/, params: [], methods: ["GET"], load: () => import('./agents/operation') },
  { pattern: /^\/mcp\/drafts$/, params: [], methods: ["POST","GET"], load: () => import('./drafts/operation') },
  { pattern: /^\/mcp\/skills$/, params: [], methods: ["GET","POST"], load: () => import('./skills/operation') },
  { pattern: /^\/mcp\/tasks$/, params: [], methods: ["GET"], load: () => import('./tasks/operation') },
  { pattern: /^\/mcp\/hello$/, params: [], methods: ["GET","POST"], load: () => import('./hello/operation') },
  { pattern: /^\/mcp\/view$/, params: [], methods: ["GET","POST"], load: () => import('./view/operation') },
  { pattern: /^\/mcp\/projects\/([^\/]+)\/sections\/([^\/]+)$/, params: ["projectId","sectionId"], methods: ["PATCH","DELETE"], load: () => import('./projects/[projectId]/sections/[sectionId]/operation') },
  { pattern: /^\/mcp\/projects\/([^\/]+)\/instructions$/, params: ["projectId"], methods: ["GET","PUT"], load: () => import('./projects/[projectId]/instructions/operation') },
  { pattern: /^\/mcp\/projects\/([^\/]+)\/manifest$/, params: ["projectId"], methods: ["GET"], load: () => import('./projects/[projectId]/manifest/operation') },
  { pattern: /^\/mcp\/projects\/([^\/]+)\/playbook$/, params: ["projectId"], methods: ["GET","PUT"], load: () => import('./projects/[projectId]/playbook/operation') },
  { pattern: /^\/mcp\/projects\/([^\/]+)\/sections$/, params: ["projectId"], methods: ["POST","GET"], load: () => import('./projects/[projectId]/sections/operation') },
  { pattern: /^\/mcp\/projects\/([^\/]+)\/members$/, params: ["projectId"], methods: ["GET","POST"], load: () => import('./projects/[projectId]/members/operation') },
  { pattern: /^\/mcp\/projects\/([^\/]+)\/labels$/, params: ["projectId"], methods: ["GET","POST"], load: () => import('./projects/[projectId]/labels/operation') },
  { pattern: /^\/mcp\/drafts\/([^\/]+)\/publish$/, params: ["draft_id"], methods: ["POST"], load: () => import('./drafts/[draft_id]/publish/operation') },
  { pattern: /^\/mcp\/agents\/([^\/]+)\/archive$/, params: ["agentId"], methods: ["POST"], load: () => import('./agents/[agentId]/archive/operation') },
  { pattern: /^\/mcp\/comments\/([^\/]+)$/, params: ["comment_id"], methods: ["PATCH","DELETE"], load: () => import('./comments/[comment_id]/operation') },
  { pattern: /^\/mcp\/teams\/([^\/]+)\/boards$/, params: ["teamId"], methods: ["POST"], load: () => import('./teams/[teamId]/boards/operation') },
  { pattern: /^\/mcp\/projects\/([^\/]+)$/, params: ["projectId"], methods: ["PATCH"], load: () => import('./projects/[projectId]/operation') },
  { pattern: /^\/mcp\/view\/([^\/]+)\/apply$/, params: ["viewId"], methods: ["POST"], load: () => import('./view/[viewId]/apply/operation') },
  { pattern: /^\/mcp\/drafts\/([^\/]+)$/, params: ["draft_id"], methods: ["PATCH","DELETE"], load: () => import('./drafts/[draft_id]/operation') },
  { pattern: /^\/mcp\/skills\/([^\/]+)$/, params: ["skill_id"], methods: ["GET","PATCH","DELETE"], load: () => import('./skills/[skill_id]/operation') },
  { pattern: /^\/mcp\/agents\/([^\/]+)$/, params: ["agentId"], methods: ["GET","POST","DELETE","PATCH"], load: () => import('./agents/[agentId]/operation') },
  { pattern: /^\/mcp\/decisions\/([^\/]+)$/, params: ["id"], methods: ["GET","PATCH"], load: () => import('./decisions/[id]/operation') },
  { pattern: /^\/mcp\/view\/([^\/]+)$/, params: ["viewId"], methods: ["GET","PATCH","DELETE"], load: () => import('./view/[viewId]/operation') },
]

export async function executeMcpOperation(request: NextRequest): Promise<Response> {
  const pathname = request.nextUrl.pathname
  for (const operation of operations) {
    const match = operation.pattern.exec(pathname)
    if (!match) continue
    if (!operation.methods.includes(request.method)) {
      throw new ApiError('Method Not Allowed', 405)
    }
    const params = Object.fromEntries(operation.params.map((name, index) => [name, decodeURIComponent(match[index + 1])]))
    const handlers = await operation.load()
    const handler = handlers[request.method] as Operation
    return handler(request, { params: Promise.resolve(params) })
  }
  throw new ApiError('MCP operation not found', 404)
}
