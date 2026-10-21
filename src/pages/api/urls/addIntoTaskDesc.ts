import addIntoTaskDesc from '@/utils/controllers/urls/addIntoTaskDesc';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "POST" && req.method !== "PUT") {
    return res.status(405).json({ message: "Method not allowed" });
  }
  try {
    const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
    if (!session) return res.status(401).json({ message: "Unauthorized" });
    const {urlsToAdd, taskId}=req.body
    if (!urlsToAdd || !taskId) return res.status(300).json({message:"Missing Required Data"})
    const parsedTaskId = Number(taskId)
    if (!Number.isInteger(parsedTaskId) || parsedTaskId <= 0) {
      return res.status(300).json({message:"Missing Required Data"})
    }
    const task = await prisma.task.findFirst({
      where: { id: parsedTaskId, project: taskWriteAccessWhere(session.userId) },
      select: { id: true },
    })
    if (!task) return res.status(404).json({ message: "Task not found or access denied" })

    const response = await addIntoTaskDesc(urlsToAdd, parsedTaskId, req.method)
    return res.status(response.status).json(response.json)
  } 
  catch (error) {
    return res.status(500).json({message:"Something went wrong!", error:error})
  }
}

export default handler;