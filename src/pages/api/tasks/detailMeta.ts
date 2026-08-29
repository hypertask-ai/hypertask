// Opening a task detail used to fire priority, estimate, labels and followers
// as four separate requests. Each one is a distinct serverless route, so each
// one could pay its own cold start, and a cold start here costs far more than
// the query: measured on production, the same route takes ~1300ms cold and
// ~140ms warm. Four routes collapsed into one removes three of those
// (HTPR-3708).
//
// Unlike the four routes it replaces, this one authorises. It has to: it is a
// GET keyed on an autoincrement task id, and it returns follower rows that
// include full User records (email included). Without a membership check that
// is a trivially enumerable dump of every user who has ever been mentioned on
// a task. src/proxy.ts only rejects a *forged* nookies_user; a request with no
// cookie at all passes through untouched, so the check belongs here.
import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { taskId } = req.query;
  if (!taskId) {
    return res.status(400).json({ message: "Missing Required Task ID" });
  }

  const id = parseInt(taskId as string);
  if (Number.isNaN(id)) {
    return res.status(400).json({ message: "Invalid Task ID" });
  }

  let userId = NaN;
  try {
    userId = Number(JSON.parse(req.cookies.nookies_user!).id);
  } catch {
    // no cookie, or not JSON
  }
  if (!userId || Number.isNaN(userId)) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  try {
    // Resolved first, and scoped to projects this user is in: everything below
    // is only fetched once the caller is known to be able to see the task.
    // Also supplies the creator ids the follower filter needs.
    const task = await prisma.task.findFirst({
      where: {
        id,
        // Membership only, no project status filter. Archived boards are a real
        // surface: /archived lists their tasks and opening one mounts the normal
        // task detail, so filtering on status here 404s the fields for an owner
        // who can legitimately see the task. Sibling routes (tasks/waiting-on,
        // assignees/assign) scope the same way.
        project: getProjectWhere(userId),
      },
      select: { userId: true, agentId: true },
    });

    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    const [priority, estimate, labels, followersRaw] = await Promise.all([
      prisma.priority.findFirst({ where: { taskId: id } }),
      prisma.estimate.findFirst({ where: { taskId: id } }),
      prisma.taskLabel.findMany({
        where: { taskId: id },
        include: { label: true },
      }),
      prisma.follower.findMany({
        where: { taskId: id },
        select: {
          id: true,
          taskId: true,
          userId: true,
          agentId: true,
          mentionById: true,
          mentionAt: true,
        // The follower list renders as an avatar plus a name (AssigneeCard in
        // MainPageComponents/index.tsx reads photoURL and displayName, nothing
        // else), so that is all this returns. It used to send whole User rows,
        // email included, which made an unauthenticated request keyed on an
        // autoincrement task id an enumerable address book (HTPR-3708).
        user: { select: { id: true, displayName: true, photoURL: true } },
        agent: { select: { id: true, displayName: true, photoURL: true } },
        },
      }),
    ]);

    // Same rule as /api/follower/getFollower: the task's own creator is not
    // listed as a follower of it, whether that creator is a user or an agent.
    let followers = followersRaw;
    if (task.agentId) {
      followers = followersRaw.filter((f) => f.agentId !== task.agentId);
    } else if (task.userId) {
      followers = followersRaw.filter((f) => f.userId !== task.userId);
    }

    return res.status(200).json({ priority, estimate, labels, followers });
  } catch (error) {
    console.log(error);
    return res.status(400).json({ message: JSON.stringify(error) });
  }
}
