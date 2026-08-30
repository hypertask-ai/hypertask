import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { requireAnnouncementAdmin } from "@/lib/admin/requireAnnouncementAdmin";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse,
) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!(await requireAnnouncementAdmin(req, res))) return;
    const announcements = await prisma.announcments.findMany({
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json(announcements);
  } catch (error) {
    console.log("🚀 ~ consthandler:NextApiHandler= ~ error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export default handler;
