import { logger as htLogger } from "#logger";
import { withAuth } from "#with-auth";
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
    htLogger.info({ error });
    return res
      .status(500)
      .json({ message: "Internal server error" + JSON.stringify(error) });
  }
};

export default withAuth(handler, { authenticateInHandler: true });
