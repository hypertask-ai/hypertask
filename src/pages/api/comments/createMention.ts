
import prisma from "@/lib/prisma";
import checkReminderAndCreateNotification from "@/utils/controllers/notifications/creation-service/check-reminder_create-notification";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { shouldNotify } from "@/utils/controllers/notifications/shouldNotify";
import { sendDataNewCommentFCM } from "@/utils/controllers/FCM";
import { broadcastTaskComment } from "@/lib/realtime/server";
import { mentionPlainPreview } from "@/utils/controllers/notifications/mentionText";
import { omitCommentSeen } from "@/utils/controllers/comments/readReceipts";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {

    try {
        if (req.method !== "POST") {
            return res.status(405).json({ message: "Method not allowed" });
        }

        // HTPR-4667: derive the mention actor from the signed session.
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

        const task = await prisma.task.findUnique({
            where: { id: taskId },
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
        // Agents are scoped by their own board membership, like getProjectWhere()
        // on the MCP path — their owning user need not be a member too. But
        // fromAgentId comes from the body, so it only counts for an agent this
        // session owns; otherwise a borrowed UUID would be a way back in.
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

        // first check if its a description mention or a comment mention, if commentId is present its obviously a comment mention

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

        // Send push notification for mention if notification was created
        if (notificationCreated && commentId) {
            try {
                // Get task and comment information
                const [comment, mentionedUser, recipientUser] = await Promise.all([
                    // Keep the push preview scoped to the validated task/comment pair.
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
                    // Get mentioned user's devices
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
                        // displayName is nullable, and "null mentioned you" is
                        // now the headline rather than a buried body line.
                        const actor = mentionedUser.displayName?.trim() || "Someone";
                        const recip = recipientUser?.displayName?.trim();
                        const notificationTitle = recip
                            ? `${recip}, directly mentioned by ${actor}`
                            : `You were directly mentioned by ${actor}`;
                        const notificationBody = preview ? `${preview}\n${task.title}` : task.title;
                        
                        // Create preference map for this user
                        const preferenceMap = new Map<number, boolean>();
                        preferenceMap.set(userId, shouldSend);
                        
                        // Prepare data field for mention notification
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
                        
                        // Send push notification using reusable function
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
                // Don't fail the request if push notification fails
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

export default handler
