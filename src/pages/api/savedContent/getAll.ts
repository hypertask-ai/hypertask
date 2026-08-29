import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { IUser } from "@/models/model";
import { getAllStarred } from "@/utils/controllers/savedContent/getAllStarred";
import { getAllPinned } from "@/utils/controllers/savedContent/getAllPinned";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  try {
    const user: IUser = JSON.parse(req.cookies.nookies_user!);
    if (!user) {
      return res.status(400).json({ message: "Missing required information" });
    }

    const { pinned } = req.body;

    let response: any;
    if (pinned) response = await getAllPinned(user.id);
    else response = await getAllStarred(user.id);
    res.status(response.status).json(response.json);
  } catch (error) {
    console.log("🚀 ~ error:", error);
    return res.status(400).json({ message: JSON.stringify(error) });
  }
};

export default handler;
