import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import changeScrollSetting from "@/utils/controllers/scrollSetting/changeScrollSetting";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const userid: any = JSON.parse(req.cookies?.nookies_user!);
  if (req.method === "POST") {
    try {
      const { setting } = req.body;
      const response = await changeScrollSetting(userid?.id, setting);
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
