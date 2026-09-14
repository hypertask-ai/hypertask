import prisma from "@/lib/prisma";
import getAllMinimal from "../projects/getAllMinimal";
import { groupMyTasksByBoard } from "@/lib/myTasksGrouping";
import type { MyTasksBoardTask } from "@/lib/myTasksGrouping";
import type { MyTasksBoardMetadata } from "@/models/MyTasksView";
import { boardAgentVisibilityWhere } from "@/lib/agents/visibility";

export { groupMyTasksByBoard } from "@/lib/myTasksGrouping";

const getMyTasks = async (userId: number) => {
  try {
    const { json: projects } = await getAllMinimal(userId, "Calendar");
    const projectIds = projects.map((project) => project.id);
    if (projectIds.length === 0) {
      return { sections: [], tabs: ["All"], boards: [] as MyTasksBoardMetadata[] };
    }

    const [tasks, taskSections] = await Promise.all([
      prisma.task.findMany({
        where: {
          projectId: { in: projectIds },
          deletedAt: null,
          status: "Normal",
          assignees: { some: { userId, agentId: null } },
        },
        include: {
          project: {
            select: { id: true, title: true, uniqueIdentifier: true },
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
      }),
      prisma.section.findMany({
        where: { projectId: { in: projectIds }, deleted: false },
        orderBy: [{ projectId: "asc" }, { ranking: "asc" }],
        select: {
          id: true,
          projectId: true,
          section_title: true,
          isDone: true,
        },
      }),
    ]);

    const sectionById = new Map(taskSections.map((section) => [section.id, section]));
    const sectionByLegacyName = new Map(
      taskSections.map((section) => [
        `${section.projectId}:${section.section_title}`,
        section,
      ]),
    );
    const tasksWithSections = tasks.map((task) => {
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
    });
    const grouped = groupMyTasksByBoard(
      tasksWithSections as unknown as MyTasksBoardTask[],
    );
    const boards: MyTasksBoardMetadata[] = projects.map((project) => ({
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
    }));

    return { ...grouped, boards };
  } catch (error) {
    console.log("🚀 ~ getMyTasks ~ error:", error);
    return { sections: [], tabs: ["All"], boards: [] as MyTasksBoardMetadata[] };
  }
};

export default getMyTasks;
