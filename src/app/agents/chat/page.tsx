import prisma from "@/lib/prisma";
import { accessibleAgentWhere } from "@/lib/agents/visibility";
import { resolveOwnedAgent } from "@/lib/agents/ownedSlugs";
import { looksLikeAgentId } from "@/lib/agents/slug";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { headers } from "next/headers";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG } from "@/lib/flags/keys";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { IUser } from "@/models/model";
import AgentChatClient from "./AgentChatClient";
import AgentRoomClient from "./AgentRoomClient";
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- This server component must expose its gate directly to CI.
import { isFeatureEnabled } from "@/lib/flags";

export const metadata: Metadata = {
  title: "Agent Chat",
};

export default async function AgentChatPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; agent?: string; projectId?: string }>;
}) {
  const query = await searchParams;
  const sessionUser = await getSessionUser(await headers());
  if (query.view !== "rooms" && sessionUser && !sessionUser.agentId &&
      await isFeatureEnabled(HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG, sessionUser.userId)) {
    const target = new URLSearchParams({ agentSidebar: "1" });
    const agentId = query.agent && (looksLikeAgentId(query.agent) ? query.agent : (await resolveOwnedAgent(sessionUser.userId, query.agent))?.id);
    if (agentId) target.set("sidebarAgent", agentId);
    if (!query.agent && query.projectId && /^[1-9]\d*$/.test(query.projectId)) target.set("id", query.projectId);
    if (agentId) {
      const board = await prisma.project.findFirst({
        where: { ...getProjectWhere(sessionUser.userId, sessionUser.agentId, sessionUser.teamScope), status: "Normal",
          ...(query.projectId && /^[1-9]\d*$/.test(query.projectId) ? { id: Number(query.projectId) } : {}),
          AND: [{ OR: [{ ownerId: sessionUser.userId }, { members: { some: { userId: sessionUser.userId, agentId: null, status: "Accepted" } } }] }],
          members: { some: { agentId, status: "Accepted", agent: { ...accessibleAgentWhere(sessionUser.userId), revokedAt: null, archivedAt: null } } } },
        orderBy: { id: "asc" }, select: { id: true },
      });
      if (board) target.set("id", String(board.id));
    }
    if (!query.agent || target.has("id")) return redirect(`/project?${target.toString()}`);
  }
  const cookieStore = await cookies();
  const userCookie = cookieStore.get("nookies_user");
  if (!userCookie) return redirect("/login");

  const currentUser: IUser = JSON.parse(userCookie.value);
  if (query.view === "rooms") {
    return <AgentRoomClient />;
  }

  return (
    <AgentChatClient currentUser={currentUser} roomsEnabled={true} />
  );
}
