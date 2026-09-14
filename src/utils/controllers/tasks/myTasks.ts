import prisma from "@/lib/prisma";
import getAllMinimal from "../projects/getAllMinimal";
import { groupMyTasksByBoard } from "@/lib/myTasksGrouping";
import type { MyTasksBoardTask } from "@/lib/myTasksGrouping";
import type { MyTasksBoardMetadata } from "@/models/MyTasksView";
import { boardAgentVisibilityWhere } from "@/lib/agents/visibility";
import {
  buildMyTasksScopeOr,
  effectiveMyTasksScopes,
  type MyTasksScope,
} from "@/lib/myTasksScopes";

export { groupMyTasksByBoard } from "@/lib/myTasksGrouping";

const getMyTasks = async (
  userId: number,
  includeViewMetadata = false,
  scopes: MyTasksScope[] = ["assigned"],
) => {
  try {
    const { json: projects } = await getAllMinimal(
      userId,
      "Calendar",
      includeViewMetadata,
    );
    const projectIds = projects.map((project) => project.id);
    if (projectIds.length === 0) {
      return { sections: [], tabs: ["All"], boards: [] as MyTasksBoardMetadata[] };
    }

    const taskSectionsPromise = includeViewMetadata
      ? prisma.section.findMany({
          where: { projectId: { in: projectIds }, deleted: false },
          orderBy: [{ projectId: "asc" }, { ranking: "asc" }],
          select: {
            id: true,
            projectId: true,
            section_title: true,
            isDone: true,
          },
        })
      : Promise.resolve([]);

    const scopeOr = buildMyTasksScopeOr(
      userId,
      effectiveMyTasksScopes(scopes, true),
    );
    const tasks = await prisma.task.findMany({
      where: {
        AND: [
          {
            projectId: { in: projectIds },
            deletedAt: null,
            status: "Normal",
          },
          { OR: scopeOr },
        ],
      },
      include: {
        project: {
          select: {
            id: true,
            title: true,
            uniqueIdentifier: true,
            timeTrackingEnabled: true,
            stalenessEnabled: true,
            staleWarnDays: true,
            staleHotDays: true,
          },
        },
        priority: true,
        estimate: true,
        // HTPR-5024: this used to be include: { user: true, agent: true },
        // which serialises the whole User row (uid, stripe_customer_id,
        // accountId, the token timestamps and the rest) for every co-assignee
        // on every task. The avatars need four fields. Kept as include so the
        // Assignees scalars
        // (userId, agentId, taskId) still come through: the My Tasks built-in
        // view filters on assignee.userId, and dropping it would empty the page.
        // agent.userId is deliberate: the assignee modal cannot remove an agent
        // without it (HTPR-5090).
        assignees: {
          where: {
            OR: [
              { agentId: null },
              { agent: boardAgentVisibilityWhere(userId) },
            ],
          },
          include: {
            // email stays: several avatar/initials fallbacks use it when a
            // user has no displayName. It is one short column against the
            // nine this select drops.
            user: {
              select: {
                id: true,
                displayName: true,
                photoURL: true,
                email: true,
              },
            },
            agent: {
              select: {
                id: true,
                userId: true,
                displayName: true,
                photoURL: true,
              },
            },
          },
        },
        taskLabels: { include: { label: true } },
        customFieldValues: {
          select: { fieldId: true, value: true, numericValue: true },
        },
        savedContent: { where: { userId, commentId: null } },
        _count: {
          select: { comments: { where: { creatorId: { not: null } } } },
        },
        notifications: {
          where: { status: "Normal", userId },
          select: { seen: true, id: true, userId: true, taskId: true, type: true },
          take: 1,
          orderBy: { createdAt: "desc" },
        },
      },
    });
    const taskSections = await taskSectionsPromise;
    const sectionById = new Map(taskSections.map((section) => [section.id, section]));
    const sectionByLegacyName = new Map(
      taskSections.map((section) => [
        `${section.projectId}:${section.section_title}`,
        section,
      ]),
    );
    const tasksWithSections = includeViewMetadata
      ? tasks.map((task) => {
          const taskSection =
            (task.sectionId ? sectionById.get(task.sectionId) : undefined) ??
            sectionByLegacyName.get(`${task.projectId}:${task.section}`) ??
            null;
          return {
            ...task,
            myTasksSection: taskSection
              ? { id: taskSection.id, isDone: taskSection.isDone }
              : null,
          };
        })
      : tasks;
    const grouped = groupMyTasksByBoard(
      tasksWithSections as unknown as MyTasksBoardTask[],
    );
    const boards: MyTasksBoardMetadata[] = includeViewMetadata
      ? projects.map((project) => {
          const memberMap = new Map<
            number,
            { id: number; displayName: string; photoURL: string | null }
          >();
          const owner = "owner" in project ? project.owner : null;
          if (owner && typeof owner === "object" && owner && "id" in owner) {
            const o = owner as {
              id: number;
              displayName?: string | null;
              photoURL?: string | null;
            };
            memberMap.set(o.id, {
              id: o.id,
              displayName: o.displayName ?? "Unknown",
              photoURL: o.photoURL ?? null,
            });
          }
          const members = "members" in project ? project.members : [];
          if (Array.isArray(members)) {
            for (const row of members) {
              const user = row?.user;
              if (user?.id) {
                memberMap.set(user.id, {
                  id: user.id,
                  displayName: user.displayName ?? "Unknown",
                  photoURL: user.photoURL ?? null,
                });
              }
            }
          }
          return {
            id: project.id,
            title: project.title ?? project.name,
            sections: taskSections
              .filter((section) => section.projectId === project.id)
              .map((section) => ({
                id: section.id,
                title: section.section_title,
                isDone: section.isDone,
              })),
            labels: ("labels" in project ? project.labels : []).map((label) => ({
              id: label.id,
              name: label.value ?? "Untitled label",
            })),
            members: [...memberMap.values()],
          };
        })
      : [];

    return { ...grouped, boards };
  } catch (error) {
    console.log("🚀 ~ getMyTasks ~ error:", error);
    return { sections: [], tabs: ["All"], boards: [] as MyTasksBoardMetadata[] };
  }
};

export default getMyTasks;
