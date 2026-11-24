import { Status } from "@prisma/client";
import { IUser } from "@/models/model";
import { fetchTaskDetail, findTaskNumberAlias, parseDetailSlug } from "@/utils/controllers/taskDetail/load";
import { findReusedKeyCollisions, TICKET_KEY_PATTERN } from "@/lib/mcp/tasks/resolveTask";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

const tasksGetTask = async (project: string, uniqueIndex: any, user: IUser) => {
  try {
    const slug = parseDetailSlug([project, String(uniqueIndex)]);
    const found = await fetchTaskDetail(project, uniqueIndex, user.id);
    const alias = !found && slug ? await findTaskNumberAlias(slug, user.id) : null;
    const task = found ?? (alias ? await fetchTaskDetail(`project-${alias.projectId}`, alias.uniqueIndex, user.id) : null);
    if (!task) return { status: 404, json: null };
    const reqTicket = typeof uniqueIndex === "string" && TICKET_KEY_PATTERN?.test(uniqueIndex.trim()) ? uniqueIndex.trim() : null;
    const collisions = found && typeof findReusedKeyCollisions === "function" && (slug || reqTicket) ? await findReusedKeyCollisions({ id: user.id }, [task], { ticketNumbers: reqTicket ? [reqTicket] : undefined, uniqueIndex: slug?.uniqueIndex ?? null, projectId: slug?.projectId ?? null }, null, { status: { not: Status.Deleted }, ...projectContentAccessWhere(user.id) }) : [];
    return { status: 200, json: collisions.length ? { ...task, reusedKeyCollision: collisions[0] } : task };
  } catch (error) {
    console.log({ error });
    return { status: 500, json: null };
  }
};

/** @deprecated use fetchDescriptionReactions from taskDetail/load */
export { fetchDescriptionReactions as getReactionsByDescriptionId } from "@/utils/controllers/taskDetail/load";

export default tasksGetTask;
