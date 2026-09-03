import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import assigneesGetAll from "@/utils/controllers/assignees/getAll";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "GET") {
    try {
      const { taskId } = req.query;
      if (!taskId) return res.status(304).json({ message: "Missing Task Id" });
      const response = await assigneesGetAll(taskId);
      res.status(response.status).json(response.json);
    } catch (error) {
      console.error("🚀 ~ handler /api/assignees/getAll ~ error:", error);
      res.status(500).json({ message: error });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
