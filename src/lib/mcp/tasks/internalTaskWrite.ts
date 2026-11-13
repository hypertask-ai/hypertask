import { signSession, SESSION_COOKIE } from '@/lib/auth/session'
import { slimUserForCookie } from '@/lib/auth/slimUserCookie'
import type { McpAuthContext } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'

type InternalTaskWriteContext = Pick<McpAuthContext, 'user' | 'agentId' | 'teamScope' | 'agentTokenGeneration'>

export type InternalTaskWriteResult = { ok: boolean; status: number; data: unknown }

async function sessionCookieFor(ctx: InternalTaskWriteContext): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: ctx.user.id },
    select: { id: true, email: true, displayName: true, photoURL: true },
  })
  if (!user) return null
  const userCookie = JSON.stringify(slimUserForCookie({
    id: user.id, email: user.email, displayName: user.displayName, photoURL: user.photoURL ?? undefined,
  }))
  const sessionToken = signSession({
    id: user.id,
    email: user.email,
    ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
    teamScope: ctx.teamScope,
    agentTokenGeneration: ctx.agentTokenGeneration,
  })
  return `nookies_user=${encodeURIComponent(userCookie)}; ${SESSION_COOKIE}=${sessionToken}`
}

function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BASEURL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
}

async function readResult(response: Response): Promise<InternalTaskWriteResult> {
  const data = await response.json().catch(() => null)
  return { ok: response.ok, status: response.status, data }
}

const USER_NOT_FOUND: InternalTaskWriteResult = { ok: false, status: 404, data: { message: 'User not found' } }

export async function archiveTaskAsSession(ctx: InternalTaskWriteContext, taskId: number): Promise<InternalTaskWriteResult> {
  const cookie = await sessionCookieFor(ctx)
  if (!cookie) return USER_NOT_FOUND
  const baseUrl = appBaseUrl()
  const response = await fetch(`${baseUrl}/api/tasks/(un)archive`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ taskId, status: 'Archive', agentId: ctx.agentId || undefined }),
  })
  return readResult(response)
}

export async function trashTaskAsSession(ctx: InternalTaskWriteContext, taskId: number): Promise<InternalTaskWriteResult> {
  const cookie = await sessionCookieFor(ctx)
  if (!cookie) return USER_NOT_FOUND
  const baseUrl = appBaseUrl()
  const response = await fetch(`${baseUrl}/api/queues/tasks/taskDeleteReminder`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ taskId, agentId: ctx.agentId || undefined }),
  })
  return readResult(response)
}
