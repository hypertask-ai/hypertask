import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import prisma from "@/lib/prisma";

// Replaces the entire favorites set for the *authenticated* user in one
// transaction. The client sends the desired order; slots (= Cmd/Alt shortcut)
// are assigned server-side by position, so a bad payload can't corrupt them.
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "PUT") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  // Identity. proxy.ts guarantees a *present* nookies_user is backed by a
  // matching signed ht_session, but it lets cookie-less requests through — so
  // require it here and derive the user's own settings row. Never trust a
  // client-supplied userSettingId (that would let one user rewrite another's).
  let userId: number | null = null;
  try {
    const raw = req.cookies?.nookies_user;
    if (raw) userId = Number(JSON.parse(raw)?.id);
  } catch {
    userId = null;
  }
  if (!userId || !Number.isFinite(userId)) {
    return res.status(401).json({ message: "Unauthorized" });
  }

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

  // Assign slots by position (index 1-9, then 0 for the tenth) and dedupe, so
  // duplicate/invalid client indexes can't collide two boards onto one shortcut.
  const seen = new Set<number>();
  const clean: { projectId: number; index: number }[] = [];
  for (const f of favorites) {
    const pid = Number(f?.projectId);
    if (!Number.isFinite(pid) || seen.has(pid)) continue;
    seen.add(pid);
    const pos = clean.length;
    clean.push({ projectId: pid, index: pos >= 9 ? 0 : pos + 1 });
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
