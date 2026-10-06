import { withTaskWriteFlag } from "@/lib/api/task-writes/route";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import tasksGetTask from "@/utils/controllers/tasks/getTask";

import prisma from "@/lib/prisma";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ message: "Missing required field" });
    }
    const response = await prisma.task.findUnique({ where: { id } });
    return res.status(200).json(response);
  } catch (error) {
    console.log({ error });
    return res
      .status(500)
      .json({ message: "Internal server error" + JSON.stringify(error) });
  }
};

// Legacy accepts every method and does not require authentication.
export default ((req, res) => withTaskWriteFlag(
  handler, req.method ?? "", async () =>
    (await import("@/lib/api/task-writes/minimal-read")).READ,
)(req, res)) satisfies NextApiHandler;
