import prisma from "@/lib/prisma";
import { IComment } from "@/models/model";
import { sendDataNewCommentFCM } from "@/utils/controllers/FCM";
import checkReminderAndCreateNotification from "@/utils/controllers/notifications/creation-service/check-reminder_create-notification";
import { broadcastTaskComment } from "@/lib/realtime/server";
import { omitCommentSeen } from "@/utils/controllers/comments/readReceipts";
import { persistCommentReactionWebhook, prepareCommentReactionWebhook } from "@/lib/agentWebhooks/commentReaction";
import { publishAgentWebhookDeliveries } from "@/lib/agentWebhooks/outbox";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { userCanAccessTaskContent } from "@/utils/controllers/tasks/assertTaskAccess";

// HTPR-5522: every failure here used to answer with the same bare 500, so a
// missing id, a comment that no longer exists, and a failed push notification
// were indistinguishable to the client. Worse, the notification ran after the
// reaction was already stored, so a notification error reported failure for
// work that had succeeded.
const isId = (value: any) => Number.isInteger(value) && value > 0;
const isText = (value: any) => typeof value === "string" && value.trim().length > 0;

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {

        try {
            const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
            if (!session) return res.status(401).json({ message: "Unauthorized" });
            const { userId: bodyUserId, taskId, commentId, emoji, unified, names,alreadyReacted } = req.body;
            if (bodyUserId != null && Number(bodyUserId) !== session.userId) {
                return res.status(403).json({ message: "Forbidden" });
            }
            const userId = session.userId;
            if (!isId(taskId) || !isId(commentId) || !isText(unified) || !isText(emoji)) {
                return res.status(400).json({
                    message: "taskId and commentId must be ids, and unified and emoji must be non-empty.",
                });
            }
            if (!(await userCanAccessTaskContent(userId, taskId))) {
                return res.status(403).json({ message: "Forbidden" });
            }
            // A reaction on a deleted or moved comment would otherwise fail as a
            // foreign key violation, which reads as a server fault, not stale UI.
            const commentExists = await prisma.comment.findFirst({
                where: { id: commentId, taskId: taskId },
                select: { id: true },
            });
            if (!commentExists) {
                return res.status(404).json({ message: "Comment not found" });
            }
            const reactionNames = Array.isArray(names) ? names : [];
            const findReaction = await prisma.reaction.findMany({
                where:{
                    unified:unified,
                    commentId:commentId,
                    userId:userId,
                },
            })
            if (findReaction.length===0 ){
                // HTPR-7095: the reaction and its agent webhook outbox row are written together, then published after commit.
                const webhookInput = { commentId, reactorUserId: userId, reactorIsAgent: false, emoji, added: true };
                const preparedWebhook = await prepareCommentReactionWebhook(webhookInput).catch((error) => {
                    console.error("[comment-reaction] agent webhook prepare failed", error);
                    return null;
                });
                const { reaction, deliveryIds } = await prisma.$transaction(async (tx) => {
                    const reaction = await tx.reaction.create({
                        data:{
                            unified:unified,
                            commentId:commentId,
                            userId:userId,
                            taskId:taskId,
                            names:reactionNames,
                            emoji:emoji
                        },
                        include:{
                        user:true,
                        comment:{include:{creator:true}},
                        task:true
                        }
                    })
                    const deliveryIds = preparedWebhook
                        ? await persistCommentReactionWebhook(tx, preparedWebhook, webhookInput)
                        : [];
                    return { reaction, deliveryIds };
                })
                const afterAppDomain=`detail/project-${reaction.task.projectId}/${reaction.task.uniqueIndex}`

                if (reaction.userId!==reaction.comment?.creatorId){
                    await notifySafely(
                        reaction,
                        afterAppDomain,
                        userId

                     )
                }
                await publishAgentWebhookDeliveries(deliveryIds).catch((error) => {
                    // The outbox row is stored; the outbox retry delivers it later.
                    console.error("[comment-reaction] agent webhook publish failed", error);
                });
                void broadcastTaskComment(taskId, { originUserId: userId });
                return res.status(200).json({
                    ...reaction,
                    comment: reaction.comment
                        ? omitCommentSeen(reaction.comment)
                        : reaction.comment,
                });
            }

            // ============== it means for the user, the item does exist, so we  must update it.
            else if (alreadyReacted!==undefined){
                var reaction;
                // ================= delete all the other reactions just for safety.
                const deleted= await prisma.reaction.deleteMany({
                    where:{
                        unified:unified,
                        commentId:commentId,
                        userId:userId,
                    }
                })

                if (!alreadyReacted && findReaction.length==0){
                    reaction = await prisma.reaction.create({
                       data:{
                           unified:unified,
                           commentId:commentId,
                           userId:userId,
                           taskId:taskId,
                           names:reactionNames,
                           emoji:emoji
                       },
                       include:{
                        user:true,
                        comment:{include:{creator:true}},
                        task:true
                       }
                   })
                   const afterAppDomain=`detail/project-${reaction.task.projectId}/${reaction.task.uniqueIndex}`
                   if (reaction.userId!==reaction.comment?.creatorId){

                       await notifySafely(
                        reaction,
                        afterAppDomain,
                        userId

                        )
                   }


                }
                 void broadcastTaskComment(taskId, { originUserId: userId });
                 return res.status(200).json(reaction ? {
                    ...reaction,
                    comment: reaction.comment
                        ? omitCommentSeen(reaction.comment)
                        : reaction.comment,
                 } : reaction);

            }
            else if (findReaction.length>0){
                const deleted= await prisma.reaction.deleteMany({
                    where:{
                        unified:unified,
                        commentId:commentId,
                        userId:userId,
                    }
                })
                void broadcastTaskComment(taskId, { originUserId: userId });
                return res.status(202).json(deleted);

            }
        } catch (error) {
            console.error("POST /api/comments/addReaction failed", error);
            res.status(500).json({ message: "Internal server error" });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

// The reaction is already stored by the time this runs, so a notification
// failure must not hand the user an error for work that succeeded.
const notifySafely = async(reaction:any,afterAppDomain:string,userId:number)=>{
    try {
        await sendNotification(reaction, afterAppDomain, userId)
    } catch (error) {
        console.error("addReaction: reaction notification failed", error)
    }
}

const sendNotification = async(reaction:any,afterAppDomain:string,userId:number)=>{
    const recipientUserId = reaction.comment?.creatorId
    if (typeof recipientUserId !== "number") return

    const devices = await prisma.subscribedDevices.findMany({
        where:{
            user:{
                id:recipientUserId
            }
        },
        include:{
            user:true
        }
    })
       const body = {
        type:"newComment",
        notificationTitle:`${reaction.user.displayName} reacted ${reaction.emoji} on your comment`,
        notificationBody:`${(reaction.comment.text ?? "").replace(/<[^>]+>/g, '')}`,
        devices,
        payload:"",
        taskTitle:reaction.comment.taskTitle,
        afterAppDomain}

        const notificationBody = {
            commentId:reaction.commentId,
            taskId:reaction.taskId,
            reactionId:reaction.id,
            userId:recipientUserId,
            type:"Reacted",
            projectId:reaction.task.projectId,
            fromUserId:userId
        }

        const notification = await checkReminderAndCreateNotification(
            recipientUserId,
            reaction.task.projectId,
            reaction.taskId,
            notificationBody,
        )
        if (notification) {
            sendDataNewCommentFCM(body)
        }
}

export default handler;
