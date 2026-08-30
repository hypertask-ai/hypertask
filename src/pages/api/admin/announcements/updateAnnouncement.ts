import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import NextCors from "nextjs-cors";
import { requireAnnouncementAdmin } from "@/lib/admin/requireAnnouncementAdmin";

// /api/admin/postAnnouncements
const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  console.log(req.method);
  if (req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", "POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    await NextCors(req, res, {
      // Options
      methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
      origin: ["*"], // replace this with your actual origin
      optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
    });
    if (!(await requireAnnouncementAdmin(req, res))) return;
    if (req.method === "POST") {
      const { jsonBody, announcementId } = req.body;
      console.log("🚀 ~ announcementId:", announcementId)

      const updatedAnnouncement = await prisma.announcments.update({
        where: {
          id: announcementId,
        },
        data: {
          body: jsonBody,
        },
      });

      await prisma.userAnnouncement.updateMany({
        where: {
          announcementId: updatedAnnouncement.id,
        },
        data: {
          readAt: null,
        },
      });

      return res.status(200).json({ message: "Success" });
    } else if (req.method === "DELETE") {
      const { announcementId } = req.query;

      // Ensure announcementId is a valid integer
      const id = parseInt(announcementId as string, 10);
      if (isNaN(id))
        return res.status(400).json({ error: "Invalid announcementId" });

      const deleteCommand = await prisma.userAnnouncement.deleteMany({
        where: { announcementId: id },
      });
      const deleteAnnouncements = await prisma.announcments.deleteMany({
        where: { id: id },
      });
      console.log(
        "🚀 ~ consthandler:NextApiHandler= ~ deleteCommand:",
        deleteCommand
      );
      console.log(
        "🚀 ~ consthandler:NextApiHandler= ~ deleteAnnouncements:",
        deleteAnnouncements
      );
      return res.status(200).end();
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

export default handler;
