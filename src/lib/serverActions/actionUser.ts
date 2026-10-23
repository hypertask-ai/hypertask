import { headers } from "next/headers"
import { getSessionUser } from "@/lib/auth/getSessionUser"

export async function actionUserIdOrNull(userId?: number): Promise<number | null> {
  const session = await getSessionUser(new Headers(await headers()))
  if (!session || session.agentId || (userId !== undefined && userId !== session.userId)) {
    return null
  }
  return session.userId
}
