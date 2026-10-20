import { withAgentScopeRequest, recordAgentBoardScopeMiss } from "@/lib/auth/agentScope";

import prisma from "@/lib/prisma";
import checkReminderAndCreateNotification from "@/utils/controllers/notifications/creation-service/check-reminder_create-notification";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { shouldNotify } from "@/utils/controllers/notifications/shouldNotify";
import { sendDataNewCommentFCM } from "@/utils/controllers/FCM";
import { broadcastTaskComment } from "@/lib/realtime/server";
import { mentionPlainPreview } from "@/utils/controllers/notifications/mentionText";
import { omitCommentSeen } from "@/utils/controllers/comments/readReceipts";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {

    try {
        if (req.method !== "POST") {
            return res.status(405).json({ message: "Method not allowed" });
        }

        const session = await getSessionUser(
            new Headers(req.headers as Record<string, string>)
        );
        if (!session) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const { projectId, taskId, userId, commentId, fromAgentId } = req.body
        const mentionedBy = session.userId;
        if (!projectId || !taskId || !userId) {
            return res.status(400).json({
                message: "Missing required information!"
            })
        }

        const task = await prisma.task.findFirst({
            where: { id: taskId, project: projectContentAccessWhere(mentionedBy, fromAgentId) },
            select: {
                title: true,
                uniqueIndex: true,
                projectId: true,
                project: {
                    select: {
                        ownerId: true,
                        members: {
                            select: {
                                userId: true,
                                agentId: true,
                                agent: { select: { userId: true } }
                            }
                        }
                    }
                }
            }
        });
        if (!task) return res.status(404).json({ message: "Task not found" });
        recordAgentBoardScopeMiss(task.projectId, "write");
        let commentExists: { creatorId: number | null; agentId: string | null } | null = null;
        if (commentId) {
            commentExists = await prisma.comment.findFirst({
                where: { id: commentId, taskId },
                select: { creatorId: true, agentId: true }
            });
            if (!commentExists) {
                return res.status(403).json({ message: "Forbidden" });
            }
        }
        const callerHasProjectAccess = fromAgentId
            ? task?.project.members.some(
                member => member.agentId === fromAgentId && member.agent?.userId === mentionedBy
            )
            : task?.project.ownerId === mentionedBy || task?.project.members.some(
                member => member.userId === mentionedBy && member.agentId === null
            );
        const callerCreatedComment = commentExists?.creatorId === mentionedBy &&
            commentExists.agentId === (fromAgentId ?? null);
        const recipientHasAccess = task?.project.ownerId === userId || task?.project.members.some(
            member => member.userId === userId && member.agentId === null
        );
        if (
            !task ||
            task.projectId !== projectId ||
            (!callerHasProjectAccess && !callerCreatedComment) ||
            !recipientHasAccess
        ) {
            return res.status(403).json({ message: "Forbidden" });
        }


        const notificationCreated = await checkReminderAndCreateNotification(
            userId,
            projectId,
            taskId,
            {
                type: "Mentioned",
                commentId,
                taskId,
                userId,
                fromUserId: mentionedBy,
                projectId,
                ...(fromAgentId ? { fromAgentId } : {}),
            }
        );

        if (notificationCreated && commentId) {
            try {
                const [comment, mentionedUser, recipientUser] = await Promise.all([
                    prisma.comment.findFirst({
                        where: { id: commentId, taskId },
                        include: {
                            creator: {
                                select: { displayName: true, photoURL: true }
                            }
                        }
                    }),
                    prisma.user.findUnique({
                        where: { id: mentionedBy },
                        select: { displayName: true, photoURL: true }
                    }),
                    prisma.user.findUnique({
                        where: { id: userId },
                        select: { displayName: true }
                    })
                ]);

                if (task && comment && mentionedUser) {
                    const devices = await prisma.subscribedDevices.findMany({
                        where: {
                            userId: userId,
                            sendNotifications: true
                        }
                    });

                    const shouldSend = await shouldNotify(userId, "Mentioned", "push");

                    if (shouldSend && devices.length > 0) {
                        const link = `detail/project-${projectId}/${task.uniqueIndex}?commentId=comment-${commentId}`;
                        const preview = mentionPlainPreview(comment.text, 140);
                        const actor = mentionedUser.displayName?.trim() || "Someone";
                        const recip = recipientUser?.displayName?.trim();
                        const notificationTitle = recip
                            ? `${recip}, directly mentioned by ${actor}`
                            : `You were directly mentioned by ${actor}`;
                        const notificationBody = preview ? `${preview}\n${task.title}` : task.title;
                        
                        const preferenceMap = new Map<number, boolean>();
                        preferenceMap.set(userId, shouldSend);
                        
                        const mentionData = {
                            type: "mention",
                            comment: JSON.stringify({
                                ...omitCommentSeen(comment),
                                creator: {
                                    displayName: mentionedUser.displayName,
                                    photoURL: mentionedUser.photoURL,
                                },
                            }),
                            body: notificationBody,
                            title: notificationTitle,
                            click_action: `${process.env.NEXT_PUBLIC_BASEURL}/${link}`,
                        };
                        
                        await sendDataNewCommentFCM({
                            notificationBody,
                            notificationTitle,
                            type: "mention",
                            devices: devices,
                            payload: {},
                            taskTitle: task.title,
                            afterAppDomain: link,
                            data: mentionData,
                            skipPreferenceFilter: false,
                            customPreferenceCheck: preferenceMap,
                        });
                        
                        console.log("🚀 ~ Mention push notification sent to user", userId);
                    }
                }
            } catch (error) {
                console.log("🚀 ~ Error in mention push notification flow:", error);
            }
        }

        void broadcastTaskComment(taskId, { originUserId: mentionedBy })

        return res.status(200).json({
            notificationCreated
        })

    } catch (error) {
        console.log("🚀 ~ consthandler:NextApiHandler= ~ error:", error)
        return res.status(500).json(error)
    }
}

export default ((req, res) => withAgentScopeRequest(req, () => handler(req, res))) satisfies NextApiHandler;
