// Import PrismaClient from the generated Prisma client
import { IUrl } from '@/models/model';
import addIntoTask from '@/utils/controllers/urls/addIntoTask';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
// Create an instance of PrismaClient

// Example usage
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
  const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
  if (!session) return res.status(401).json({ message: "Unauthorized" });
  try {
    const { urlsToAdd,commentId}:{urlsToAdd:IUrl[], commentId:number} = req.body;
    if (!urlsToAdd || !commentId) return res.status(300).json({message:"Missing Required Data"})
    const parsedCommentId = Number(commentId)
    if (!Number.isInteger(parsedCommentId) || parsedCommentId <= 0) {
      return res.status(300).json({message:"Missing Required Data"})
    }
    const comment = await prisma.comment.findFirst({
      where: {
        id: parsedCommentId,
        task: { project: taskWriteAccessWhere(session.userId) },
      },
      select: { id: true },
    })
    if (!comment) return res.status(404).json({ message: "Comment not found" })

    const response = await addIntoTask(urlsToAdd,commentId, req.method)
    return res.status(response?.status).json(response?.json)
  } 
  
  catch (error) {
    console.log(error)
    return res.status(500).json({message:"Something went wrong", error:error})
  }

}

// Run the main function
export default handler;