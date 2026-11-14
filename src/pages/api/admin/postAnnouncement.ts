import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import NextCors from "nextjs-cors";
import { requireAnnouncementAdmin } from "@/lib/admin/requireAnnouncementAdmin";
import { createAnnouncement } from "@/utils/controllers/announcements/createAnnouncement";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  console.log(req.method);
  try {
    await NextCors(req, res, {
      methods: ["POST"],
      origin: ["*"],
      optionsSuccessStatus: 200,
      preflightContinue: true,
    });

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!(await requireAnnouncementAdmin(req, res))) return;

    const { jsonBody } = req.body;
    console.log("🤔 ~ handler ~ jsonBody:", jsonBody);

    const result = await createAnnouncement({ body: jsonBody });
    return res.status(200).json({ message: "Success", result });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

export default handler;
