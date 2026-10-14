import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import prisma from "@/lib/prisma";
import { invalidateHyperAiCommentOrigin } from "@/lib/ai/hyperAiConfirmation";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method==="PUT"){
      const {updatedComment}=req.body
      const { text, creatorId,taskId, commentId  } = updatedComment;
      
      if (!text || !creatorId ||!taskId ||!commentId) {
          return res.status(400).json({ message: "Missing Required Data" });
      }
      try {
        await invalidateHyperAiCommentOrigin(commentId);

        const toUpdate = await prisma.comment.update({
            where:{
                id:commentId
            },
            data:{
                text:text
            }
        });

        if(!toUpdate) return res.status(400).json({message:"Section Not Found"})
    
        return res.status(200).json(toUpdate);
      } catch (error) {
        console.error('Error:', error);
      }
    }
    }
    
    export default handler;
