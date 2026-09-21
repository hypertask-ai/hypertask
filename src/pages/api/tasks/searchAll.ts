import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { verifyCookieIdentity } from "@/lib/auth/cookieIdentity";
import tasksSearchAll from "@/utils/controllers/tasks/searchAll";
import getRecentlyWorkedTasks from "@/utils/controllers/tasks/getRecentlyWorkedTasks";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    try {
      const { projectIds, searchQuery, mode, currentTaskId } = req.body;

      if (mode === "recent") {
        const identity = await verifyCookieIdentity(
          req.cookies.nookies_user,
          req.cookies.ht_session
        );
        if (identity.status !== "verified") {
          return res.status(401).json({ message: "Not authenticated" });
        }

        const response = await getRecentlyWorkedTasks({
          userId: identity.id,
          projectIds,
          currentTaskId: Number(currentTaskId),
        });
        return res.status(response.status).json(response.json);
      }

      if (!projectIds || !searchQuery) {
        return res.status(200).json("Missing Required Data");
      }

      // =========== instant search
      const response = await tasksSearchAll(projectIds, searchQuery);
      // Assuming otherResponse and response are arrays of objects

      return res.status(response.status).json(response.json);
    } catch (error) {
      console.log(error);
      return res.status(200).json([]);
    }
  } else {
    return res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
