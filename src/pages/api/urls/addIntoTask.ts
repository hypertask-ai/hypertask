import { isPlanLimitReachedError, planLimitResponse } from "@/lib/planLimits";
import { TaskAttachmentLinkError } from "@/lib/storage/linkTaskAttachment";
import { IUrl } from '@/models/model';
import addIntoTask from '@/utils/controllers/urls/addIntoTask';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

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
      select: { id: true, taskId: true },
    })
    if (!comment) return res.status(404).json({ message: "Comment not found" })

    const response = await addIntoTask(urlsToAdd.map((url) => ({ ...url, TaskId: comment.taskId })), parsedCommentId, req.method, prisma, { actorUserId: session.userId, agentId: session.agentId, entryPoint: "urls.addIntoTask" })
    return res.status(response?.status).json(response?.json)
  } 
  
  catch (error) {
    if (isPlanLimitReachedError(error)) {
      const response = planLimitResponse(error);
      return res.status(response.status).json(response.body);
    }
    if (error instanceof TaskAttachmentLinkError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.log(error)
    return res.status(500).json({message:"Something went wrong", error:error})
  }

}

export default handler;