import { withTaskWriteFlag } from "@/lib/api/task-writes/route";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import tasksGetTask from "@/utils/controllers/tasks/getTask";

import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  try {
    const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
    if (!session) return res.status(401).json({ message: "Unauthorized" });
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ message: "Missing required field" });
    }
    const response = await prisma.task.findFirst({
      where: { id, project: projectContentAccessWhere(session.userId) },
    });
    if (!response) return res.status(404).json({ message: "Task not found" });
    return res.status(200).json(response);
  } catch (error) {
    console.log({ error });
    return res
      .status(500)
      .json({ message: "Internal server error" + JSON.stringify(error) });
  }
};

// Legacy accepts every method; reads now require authenticated board access.
export default ((req, res) => withTaskWriteFlag(
  handler, req.method ?? "", async () =>
    (await import("@/lib/api/task-writes/minimal-read")).READ,
)(req, res)) satisfies NextApiHandler;
