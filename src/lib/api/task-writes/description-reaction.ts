import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "./route";
import prisma from "@/lib/prisma";
import { sendDataNewCommentFCM } from "@/utils/controllers/FCM";
import checkReminderAndCreateNotification from "@/utils/controllers/notifications/creation-service/check-reminder_create-notification";
import { getReactionsByDescriptionId } from "@/utils/controllers/tasks/getTask";
import { userCanAccessTaskContent } from "@/utils/controllers/tasks/assertTaskAccess";

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (body, session) => {
    const req = { body };
    const { userId: bodyUserId, taskId,descriptionId, emoji, unified, names,alreadyReacted } = req.body;
    if (bodyUserId != null && Number(bodyUserId) !== session.userId) {
        return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }
    const userId = session.userId;
    const parsedTaskId = Number(taskId);
    if (!Number.isInteger(parsedTaskId) || parsedTaskId <= 0 || !descriptionId || !unified || !emoji) {
        return NextResponse.json({ message: "Missing required information" }, { status: 400 });
    }
    if (!(await userCanAccessTaskContent(userId, parsedTaskId))) {
        return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }
    const description = await prisma.description.findFirst({
        where: { id: String(descriptionId), taskId: parsedTaskId },
        select: { id: true },
    });
    if (!description) return NextResponse.json({ message: "Description not found" }, { status: 404 });
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
                taskId:parsedTaskId,
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
        return NextResponse.json(reactionsToReturn, { status: 200 });
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
                   taskId:parsedTaskId,
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
        return NextResponse.json(reactionsToReturn, { status: 200 });
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
        return NextResponse.json(reactionsToReturn, { status: 200 });
    }
  },
});

export const POST: TaskWriteRoute = async (request, session) => {
  try {
    return await route(request, session);
  } catch (error) {
    console.log(error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
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
            let notificationBody = reaction.description.content;
            let previousBody;
            do {
                previousBody = notificationBody;
                notificationBody = notificationBody.replace(/<[^>]+>/g, '');
            } while (notificationBody !== previousBody);
            notificationBody = notificationBody.replace(/[<>]/g, '');
            const body = {
                type:"newComment",
                notificationTitle:`${reaction.user.displayName} reacted ${reaction.emoji} on description`,
                notificationBody,
                devices,
                payload:"",
                taskTitle:reaction.task.title,
                afterAppDomain
            }
            sendDataNewCommentFCM(body)
        }

        // console.log("🚀 ~ sendNotification ~ notification:", notification)

}
