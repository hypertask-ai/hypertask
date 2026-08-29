import prisma from "@/lib/prisma";

export async function listOwnedConnections(userId: number) {
  const authorizedCodes = await prisma.oAuthAuthorizationCode.findMany({
    where: { user_id: userId, used: true },
    include: {
      client: true,
      agent: { select: { displayName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const clients = new Map<
    string,
    {
      client_id: string;
      client_name: string | null;
      created_at: string;
      last_authorized: string;
      connected_via_agent: boolean;
      agent_display_name: string | null;
    }
  >();

  for (const code of authorizedCodes) {
    if (clients.has(code.client_id)) continue;
    clients.set(code.client_id, {
      client_id: code.client_id,
      client_name: code.client.client_name,
      created_at: code.client.createdAt.toISOString(),
      last_authorized: code.createdAt.toISOString(),
      connected_via_agent: Boolean(code.agent_id),
      agent_display_name: code.agent?.displayName ?? null,
    });
  }

  return [...clients.values()];
}
