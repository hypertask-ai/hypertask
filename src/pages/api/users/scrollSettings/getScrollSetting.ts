import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import getScrollSetting from "@/utils/controllers/scrollSetting/getScrollSetting";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const userid: any = JSON.parse(req.cookies?.nookies_user!);
  if (req.method === "GET") {
    try {
      const response = await getScrollSetting(userid?.id);
      return res.status(200).json(response);
    } catch (error) {
      console.log(error);
      return res.status(400).json({ message: JSON.stringify(error) });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
