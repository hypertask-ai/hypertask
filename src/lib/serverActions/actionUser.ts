import { headers } from "next/headers"
import { getSessionUser } from "@/lib/auth/getSessionUser"

export async function requireActionUser(userId?: number) {
  const session = await getSessionUser(new Headers(await headers()))
  if (!session || session.agentId || (userId !== undefined && userId !== session.userId)) {
    throw new Error("Forbidden")
  }
  return session.userId
}
