import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import taskSearchByParam from "@/utils/controllers/tasks/taskSearchByParam";
import { httpStatusConfig } from "@/lib/configs/http-status.config";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "GET") {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = session.userId;
    try {
      const query = req.query;
      const { param, projectId } = query;
      if (!param || !projectId)
        return res
          .status(400)
          .json({ message: httpStatusConfig.statusCodes[400].userMessage });

      const response = await taskSearchByParam(
        param as string,
        userId,
        parseInt(projectId as string)
      );
      return res.status(response.status).json(response.json);
    } catch (error) {
      console.log("🤔 ~ TaskSearchByParams ERROR:", error);
      return res
        .status(500)
        .json({ message: httpStatusConfig.statusCodes[500].userMessage });
    }
  } else {
    return res
      .status(405)
      .json({ message: httpStatusConfig.statusCodes[405].userMessage });
  }
};

export default handler;
