import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskGetUserContextTool(context: ChatToolContext) {
  const { agentStore, getProjectWhere, prisma, sanitizeForJson, sendStatus, tool, user, z } = context;
  return tool({
      description:
        "Get the current Hypertask user context, accessible teams, projects, labels, sections, and available agents.",
      inputSchema: z.object({}),
      execute: async () => {
        sendStatus("hypertask_get_user_context");
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { accountId: true },
        });
        const [ownedTeams, memberRows, projects, agentsByUser] =
          await Promise.all([
            dbUser?.accountId
              ? prisma.team.findMany({
                  where: { googleAccountId: dbUser.accountId },
                  select: { id: true, title: true },
                })
              : [],
            prisma.member_Team.findMany({
              where: { userId: user.id, status: "Accepted" },
              include: {
                team: { select: { id: true, title: true } },
              },
            }),
            prisma.project.findMany({
              where: {
                status: "Normal",
                ...getProjectWhere(user.id),
              },
              select: {
                id: true,
                title: true,
                description: true,
                name: true,
                ownerId: true,
                owner: {
                  select: { id: true, email: true, displayName: true },
                },
                status: true,
                sections: true,
                section: {
                  select: { id: true, section_title: true },
                },
                labels: {
                  select: { id: true, value: true },
                },
                createdAt: true,
                _count: {
                  select: {
                    members: true,
                    tasks: { where: { status: "Normal" } },
                  },
                },
              },
              orderBy: { title: "asc" },
            }),
            agentStore().findMany({
              where: { userId: user.id },
              select: { id: true, displayName: true },
            }),
          ]);

        const teamById = new Map<string, { id: string; title?: string }>();
        ownedTeams.forEach((team) =>
          teamById.set(team.id, { id: team.id, title: team.title ?? undefined })
        );
        memberRows.forEach((row) => {
          if (row.team) {
            teamById.set(row.team.id, {
              id: row.team.id,
              title: row.team.title ?? undefined,
            });
          }
        });

        return sanitizeForJson({
          success: true,
          user: {
            id: user.id,
            email: user.email,
            displayName: user.displayName || undefined,
          },
          teams: Array.from(teamById.values()).sort((a, b) =>
            (a.title ?? a.id).localeCompare(b.title ?? b.id)
          ),
          projects: projects.map((project) => ({
            id: project.id,
            title: project.title || "",
            description: project.description || undefined,
            name: project.name,
            ownerId: project.ownerId,
            owner: project.owner
              ? {
                  id: project.owner.id,
                  email: project.owner.email,
                  displayName: project.owner.displayName || undefined,
                }
              : undefined,
            memberCount: project._count.members,
            taskCount: project._count.tasks,
            defaultSections: project.sections || [],
            sections: project.section,
            labels: (project.labels || []).map((label) => ({
              id: label.id,
              name: label.value || "",
            })),
            status: project.status,
            createdAt: project.createdAt.toISOString(),
          })),
          all_agents: agentsByUser.map((agent) => ({
            id: agent.id,
            displayName: agent.displayName,
          })),
        });
      },
    });
}
