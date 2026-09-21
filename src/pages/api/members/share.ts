import membersShare from "@/utils/controllers/members/share";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    try {
      const { userId, shareId } = req.body;
      if (!userId || !shareId) {
        return res
          .status(400)
          .json({ message: "Missing required information" });
      }

      const response = await membersShare(userId, shareId);
      return res.status(200).json(response.json);
    } catch (error) {
      console.log(error);
      return res.status(400).json({ message: JSON.stringify(error) });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
