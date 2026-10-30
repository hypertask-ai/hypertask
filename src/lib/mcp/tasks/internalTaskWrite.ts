import { signSession, SESSION_COOKIE } from '@/lib/auth/session'
import { slimUserForCookie } from '@/lib/auth/slimUserCookie'
import type { McpAuthContext } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'

type InternalTaskWriteContext = Pick<McpAuthContext, 'user' | 'agentId' | 'teamScope' | 'agentTokenGeneration'>

export async function postInternalTaskWrite(
  ctx: InternalTaskWriteContext,
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const user = await prisma.user.findUnique({
    where: { id: ctx.user.id },
    select: { id: true, email: true, displayName: true, photoURL: true },
  })
  if (!user) return { ok: false, status: 404, data: { message: 'User not found' } }
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
  const baseUrl = process.env.NEXT_PUBLIC_BASEURL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `nookies_user=${encodeURIComponent(userCookie)}; ${SESSION_COOKIE}=${sessionToken}`,
    },
    body: JSON.stringify({ ...body, agentId: ctx.agentId || undefined }),
  })
  const data = await response.json().catch(() => null)
  return { ok: response.ok, status: response.status, data }
}
