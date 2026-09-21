import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";
import { Prisma } from "@prisma/client";

export function createHypertaskListProjectsTool(context: ChatToolContext) {
  const { getProjectWhere, prisma, sanitizeForJson, sendStatus, sortOrderSchema, statusSchema, tool, user, z } = context;
  return tool({
      description:
        "List projects/boards the authenticated user can access. Supports status, search, pagination, and sorting.",
      inputSchema: z.object({
        status: statusSchema.default("Normal"),
        search: z.string().max(200).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        sort_by: z.enum(["title", "createdAt", "updatedAt"]).default("title"),
        sort_order: sortOrderSchema.default("asc"),
      }),
      execute: async (input) => {
        sendStatus("hypertask_list_projects");
        const where: Prisma.ProjectWhereInput = {
          status: input.status,
          AND: [
            getProjectWhere(user.id),
            ...(input.search
              ? [
                  {
                    OR: [
                      { title: { contains: input.search, mode: "insensitive" } },
                      { name: { contains: input.search, mode: "insensitive" } },
                      {
                        description: {
                          contains: input.search,
                          mode: "insensitive",
                        },
                      },
                    ],
                  } satisfies Prisma.ProjectWhereInput,
                ]
              : []),
          ],
        };
        const orderBy: Prisma.ProjectOrderByWithRelationInput =
          input.sort_by === "createdAt"
            ? { createdAt: input.sort_order }
            : input.sort_by === "updatedAt"
              ? { id: input.sort_order }
              : { title: input.sort_order };
        const [total, projects] = await Promise.all([
          prisma.project.count({ where }),
          prisma.project.findMany({
            where,
            select: {
              id: true,
              title: true,
              description: true,
              name: true,
              ownerId: true,
              owner: { select: { id: true, email: true, displayName: true } },
              status: true,
              sections: true,
              section: { select: { id: true, section_title: true } },
              labels: { select: { id: true, value: true } },
              createdAt: true,
              _count: {
                select: {
                  members: true,
                  tasks: { where: { status: "Normal" } },
                },
              },
            },
            orderBy,
            take: input.limit,
            skip: input.offset,
          }),
        ]);

        return sanitizeForJson({
          success: true,
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
          total,
          limit: input.limit,
          offset: input.offset,
        });
      },
    });
}
