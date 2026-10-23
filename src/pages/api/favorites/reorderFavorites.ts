import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "PUT") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getSessionUser(
    new Headers(req.headers as Record<string, string>)
  );
  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const userId = session.userId;

  const { favorites } = req.body as {
    favorites?: { projectId: number }[];
  };
  if (!Array.isArray(favorites)) {
    return res.status(400).json({ message: "Missing Required information" });
  }
  if (favorites.length > 10) {
    return res.status(400).json({ message: "Too many favorites (max 10)" });
  }

  const setting = await prisma.userSetting.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!setting) {
    return res.status(404).json({ message: "User settings not found" });
  }
  const userSettingId = setting.id;

  const seen = new Set<number>();
  const clean: { projectId: number; index: number }[] = [];
  for (const f of favorites) {
    const pid = Number(f?.projectId);
    if (!Number.isSafeInteger(pid) || pid <= 0 || seen.has(pid)) continue;
    seen.add(pid);
    const pos = clean.length;
    clean.push({ projectId: pid, index: pos >= 9 ? 0 : pos + 1 });
  }

  if (clean.length > 0) {
    const allowed = await prisma.project.findMany({
      where: { id: { in: clean.map((f) => f.projectId) }, ...getProjectWhere(userId) },
      select: { id: true },
    });
    if (allowed.length !== clean.length) {
      return res.status(403).json({ message: "Forbidden" });
    }
  }

  try {
    await prisma.$transaction([
      prisma.favorites.deleteMany({ where: { userSettingId } }),
      prisma.favorites.createMany({
        data: clean.map((f) => ({
          userSettingId,
          projectId: f.projectId,
          index: f.index,
        })),
      }),
    ]);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: JSON.stringify(error) });
  }
};

export default handler;
