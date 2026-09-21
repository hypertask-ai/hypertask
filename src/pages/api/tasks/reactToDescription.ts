import prisma from "@/lib/prisma";
import { IComment } from "@/models/model";
import { sendDataNewCommentFCM } from "@/utils/controllers/FCM";
import checkReminderAndCreateNotification from "@/utils/controllers/notifications/creation-service/check-reminder_create-notification";
import { getReactionsByDescriptionId } from "@/utils/controllers/tasks/getTask";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {

        try {
            const { userId, taskId,descriptionId, emoji, unified, names,alreadyReacted } = req.body;
            const findReaction = await prisma.reaction.findMany({
                where:{
                    unified:unified,
                    descriptionId:descriptionId,
                    userId:userId,
                },
            })
            console.log("🚀 ~ consthandler:NextApiHandler= ~ findReaction:", findReaction)
            if (findReaction.length===0 ){
                const reaction = await prisma.reaction.create({
                    data:{
                        unified:unified,
                        descriptionId:descriptionId,
                        userId:userId,
                        taskId:taskId,
                        names:names,
                        emoji:emoji
                    },
                    include:{
                    user:true,
                    description:{include:{creator:true}},
                    task:true
                    }
                })
                const afterAppDomain=`detail/project-${reaction.task.projectId}/${reaction.task.uniqueIndex}`

                if (reaction.userId!==reaction.description?.creatorId){
                    await sendNotification(
                        reaction,
                        afterAppDomain,
                        userId
 
                     )
                }
                const reactionsToReturn = await getReactionsByDescriptionId(descriptionId)
                return res.status(200).json(reactionsToReturn);
            }

            // ============== it means for the user, the item does exist, so we  must update it. 
            else if (alreadyReacted!==undefined){                
                var reaction;
                // ================= delete all the other reactions just for safety.
                const deleted= await prisma.reaction.deleteMany({
                    where:{
                        unified:unified,
                        descriptionId:descriptionId,
                        userId:userId,
                    }
                })

                if (!alreadyReacted && findReaction.length==0){
                    reaction = await prisma.reaction.create({
                       data:{
                           unified:unified,
                           descriptionId:descriptionId,
                           userId:userId,
                           taskId:taskId,
                           names:names,
                           emoji:emoji
                       },
                       include:{
                        user:true,
                        description:{include:{creator:true}},
                        task:true
                       }
                   })
                   const afterAppDomain=`detail/project-${reaction.task.projectId}/${reaction.task.uniqueIndex}`
                   if (reaction.userId!==reaction.description?.creatorId){

                       await sendNotification(
                        reaction,
                        afterAppDomain,
                        userId
    
                        )
                   }
                
                
                }
                const reactionsToReturn = await getReactionsByDescriptionId(descriptionId)
                return res.status(200).json(reactionsToReturn);                
            }
            else if (findReaction.length>0){
                const deleted= await prisma.reaction.deleteMany({
                    where:{
                        unified:unified,
                        descriptionId:descriptionId,
                        userId:userId,
                    },
                })
                const reactionsToReturn = await getReactionsByDescriptionId(descriptionId)
                return res.status(200).json(reactionsToReturn);
            }
        } catch (error) {
            console.log(error);
            res.status(500).json({ message: "Internal server error" });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

const sendNotification = async(reaction:any,afterAppDomain:string,userId:number)=>{
    const devices = await prisma.subscribedDevices.findMany({
        where:{
            user:{
                id:reaction.description.creatorId
            }
        },
        include:{
            user:true
        }
    })
        // also create notification
        const notification = await checkReminderAndCreateNotification(
            userId,
            reaction.task.projectId,
            reaction.taskId,
            {
                taskId:reaction.taskId,
                reactionId:reaction.id,
                userId:reaction.task.userId,
                type:"Reacted",
                projectId:reaction.task.projectId,
                fromUserId:userId
            }
          );
        
        if(notification) {
            const body = {
                type:"newComment",
                notificationTitle:`${reaction.user.displayName} reacted ${reaction.emoji} on description`,
                notificationBody:`${reaction.description.content.replace(/<[^>]+>/g, '')}`,
                devices, 
                payload:"",
                taskTitle:reaction.task.title, 
                afterAppDomain
            }
            sendDataNewCommentFCM(body)
        }
     
        // console.log("🚀 ~ sendNotification ~ notification:", notification)

}

export default handler;