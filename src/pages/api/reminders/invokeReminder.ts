import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { IReminder } from "@/models/model";
import invokeReminder from '@/utils/controllers/reminders/invokeReminder';

// HTPR-7175: the caller may only fire their own active reminder, and the
// stored row (never the submitted body) decides which user and task it hits.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" })

  const session = await getSessionUser(
    new Headers(req.headers as Record<string, string>)
  );
  if (!session) return res.status(401).json({ message: "Unauthorized" })

  const reminderId = Number(req.body?.reminder?.id)
  if (!Number.isInteger(reminderId) || reminderId <= 0) {
    return res.status(400).json({ message: "Missing required information" })
  }

  try {
    const reminder = await prisma.reminder.findFirst({
      where: { id: reminderId, userId: session.userId, status: "Normal" },
    })
    if (!reminder) return res.status(404).json({ message: "Reminder not found" })

    await invokeReminder(reminder as unknown as IReminder)
    return res.status(200).json(reminder)
  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Could not invoke reminder" })
  }
}
