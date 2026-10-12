import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import prisma from "@/lib/prisma";
import { invalidateHyperAiCommentOrigin } from "@/lib/ai/hyperAiConfirmation";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method==="PUT"){
      const {updatedComment}=req.body
      // console.log("🚀 ~ file: updateComment.ts:7 ~ consthandler:NextApiHandler= ~ updatedComment:", updatedComment)
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
        // console.log("🚀 ~ file: updateComment.ts:24 ~ consthandler:NextApiHandler= ~ toUpdate:", toUpdate)

        if(!toUpdate) return res.status(400).json({message:"Section Not Found"})
        // if(toUpdate.deleted===true) return res.status(204).json(toUpdate)
    
        return res.status(200).json(toUpdate);
        // Get field names of the "Section" model
        
      } catch (error) {
        console.error('Error:', error);
      }
    }
    }
    
    // Run the main function
    export default handler;
