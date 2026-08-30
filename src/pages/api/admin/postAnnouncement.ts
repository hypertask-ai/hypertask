import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import NextCors from "nextjs-cors";
import { requireAnnouncementAdmin } from "@/lib/admin/requireAnnouncementAdmin";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  console.log(req.method);
  try {
    await NextCors(req, res, {
      // Options
      methods: ["POST"],
      origin: ["*"], // replace this with your actual origin
      optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
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

    const result = await getUsersInBatches(40, jsonBody);
    return res.status(200).json({ message: "Success", result });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

async function getUsersInBatches(batchSize: number, jsonBody: any) {
  let offset = 0;
  let users: number[] = [];
  let user_announcements = [];

  const announcement = await prisma.announcments.create({
    data: {
      body: jsonBody,
      isWelcome: jsonBody.newUserMark ?? false,
    },
  });
  console.log("🚀 ~ getUsersInBatches ~ announcement:", announcement);

  if (announcement.isWelcome) {
    users = [1, 4, 6, 46, 193];
    const user_announcement = await prisma.userAnnouncement.createMany({
      data: users.map((user) => ({
        userId: user,
        announcementId: announcement.id,
      })),
    });
    user_announcements.push(user_announcement);
  } else {
    do {
      const currentBatchUsers = await prisma.user.findMany({
        skip: offset,
        take: batchSize,
        select: { id: true },
      });

      users = currentBatchUsers.map((x) => x.id);

      if (users.length > 0) {
        const user_announcement = await prisma.userAnnouncement.createMany({
          data: users.map((user) => ({
            userId: user,
            announcementId: announcement.id,
          })),
        });
        user_announcements.push(user_announcement);
      }

      offset += batchSize;
    } while (users.length === batchSize);
  }

  return { announcement, user_announcements };
}
export default handler;
