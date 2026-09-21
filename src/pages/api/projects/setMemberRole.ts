import setMemberRole from "@/utils/controllers/projects/setMemberRole";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === "POST") {
    try {
      const { projectId, targetUserId, role } = req.body;
      const user = JSON.parse(req.cookies.nookies_user!);
      const response = await setMemberRole(
        parseInt(user.id),
        projectId,
        targetUserId,
        role,
      );
      return res.status(response.status).json(response.json);
    } catch (error) {
      console.error(error);
      return res.status(400).json({ message: JSON.stringify(error) });
    }
  } else {
    return res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
