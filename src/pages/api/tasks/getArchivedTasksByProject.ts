import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import tasksGetArchivedTasksByProject from "@/utils/controllers/tasks/getArchivedTasksByProject";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "GET") {
    try {
      const user =
        req.cookies.nookies_user && JSON.parse(req.cookies.nookies_user);
      const { projectId } = req.query;

      if (!user?.id || !projectId) {
        return res.status(400).json({ message: "Missing required field" });
      }

      const response = await tasksGetArchivedTasksByProject(projectId, user.id);
      return res.status(response.status).json(response.json);
    } catch (error) {
      console.log(error);
      return res.status(400).json([]);
    }
  } else {
    return res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
