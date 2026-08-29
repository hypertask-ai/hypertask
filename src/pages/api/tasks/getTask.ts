import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import tasksGetTask from "@/utils/controllers/tasks/getTask";
import { httpStatusConfig } from "@/lib/configs/http-status.config";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "GET") {
    try {
      const { project, uniqueIndex } = req.query;
      if (!uniqueIndex || !project) {
        return res
          .status(400)
          .json({ message: httpStatusConfig.statusCodes[400].userMessage });
      }
      const userObj = JSON.parse(req.cookies?.nookies_user!);
      const response = await tasksGetTask(
        project as string,
        uniqueIndex as string,
        userObj
      );

      return res.status(response.status).json(response.json);
    } catch (error) {
      console.log({ error });
      return res
        .status(500)
        .json({ message: httpStatusConfig.statusCodes[500].userMessage });
    }
  } else {
    res
      .status(405)
      .json({ message: httpStatusConfig.statusCodes[405].userMessage });
  }
};

export default handler;
