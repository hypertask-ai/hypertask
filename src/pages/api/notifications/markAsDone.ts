import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import prisma from "@/lib/prisma";
import { broadcastInboxChange, socketIdFromHeader } from "@/lib/realtime/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        try {
            // HTPR-4772: ignore the query userId and use the signed session.
            const session = await getSessionUser(
                new Headers(req.headers as Record<string, string>)
            );
            if (!session) return res.status(401).json({ message: "Unauthorized" });

            const {id, taskId, tutorial} = req.query;
            const userId = session.userId;
            // Acting tab's socket id — excluded from the broadcast so it doesn't refetch itself (HTPR-3998).
            const excludeSocketId = socketIdFromHeader(req.headers["x-socket-id"]);
            // Need at least a notification id (inbox) or a taskId (task detail page) to act on.
            if (!taskId && !id) {
                return res.status(400).json({ message: "Notification id or taskId is required" });
            }
            // Some notifications legitimately have no task (moved/deleted-task notifications).
            // parsedTaskId is null in that case so we skip taskId-scoped sibling cleanup and
            // archive the notification by its own id instead.
            const parsedTaskId = Number.isInteger(Number(taskId)) ? parseInt(taskId as string) : null;
            
            const timeNow = new Date()

            if (tutorial === "1" && !id) {
              return res.status(400).json({
                message: "Tutorial notification id is required",
              });
            }

            
            // ================= archiving from [TASK DETAIL PAGE]. we dont have the id, we just want to assume we are archiving all the notifications of that task. 
            if (!id){
             if (parsedTaskId === null) {
                return res.status(400).json({ message: "taskId is required when no notification id is provided" });
             }
             const updatedCount= await prisma.notification.updateMany({
                where:{
                  taskId:parsedTaskId,
                  userId,
                  status:{not:"Deleted"}
                },
                data:{
                  status:"Archive",
                  archivedAt:timeNow
                  
                }
              })
              void broadcastInboxChange(userId, { originUserId: userId }, excludeSocketId);
              return res.status(200).json(updatedCount);

            }

          // ----------------------------------------------------------------------------------------------------------------------------------
            // ================== archiving from [INBOX PAGE]
            const notification_ = await prisma.notification.findUnique({
              where:{
                id:parseInt(id as string),

              }
            
            })
            console.log("🚀 ~ consthandler:NextApiHandler= ~ notification_:", notification_)

            if (notification_ && notification_.userId !== userId) {
              return res.status(403).json({ message: "Forbidden" });
            }

            // HTPR-4877: an id that matches nothing used to reach the end of
            // the try with no response sent, so the request hung until the
            // client timed out. Answer explicitly.
            if (!notification_) {
              return res.status(404).json({ message: "Notification not found" });
            }

            if (tutorial === "1") {
              const tutorialNotification =
                notification_.projectId !== null && notification_.taskId !== null
                  ? await prisma.notification.findFirst({
                      where: {
                        fromAgentId: null,
                        fromUserId: userId,
                        id: notification_.id,
                        projectId: notification_.projectId,
                        project: {
                          ownerId: userId,
                          status: "Normal",
                          title: "Learn Hypertask",
                        },
                        returnedFromReminders: false,
                        taskId: notification_.taskId,
                        task: {
                          projectId: notification_.projectId,
                          status: "Normal",
                        },
                        type: "TaskMovedToInbox",
                        userId,
                      },
                      select: { id: true },
                    })
                  : null;
              if (!tutorialNotification) {
                return res.status(403).json({ message: "Forbidden" });
              }
              if (
                notification_.status !== "Normal" ||
                notification_.archivedAt !== null
              ) {
                return res.status(409).json({ message: "Tutorial notification is not active" });
              }
              const updatedNotification = await prisma.notification.update({
                where: { id: notification_.id },
                data: { status: "Archive", archivedAt: timeNow },
              });
              void broadcastInboxChange(
                updatedNotification.userId,
                { originUserId: updatedNotification.userId },
                excludeSocketId,
              );
              return res.status(200).json(updatedNotification);
            }

            // =================== archive all of that task and that userid. 
            if (notification_?.status==="Normal"){
              if (notification_.type==="Invited"){
                const updatedNotification = await prisma.notification.update({where:{id:notification_.id}, data:{status:"Archive",archivedAt:timeNow}})
                void broadcastInboxChange(updatedNotification.userId, { originUserId: updatedNotification.userId }, excludeSocketId);
                return res.status(200).json(updatedNotification);

              }

              // Only clean up sibling notifications when this notification is tied to a task.
              // Task-less notifications have no siblings to group, and a NaN taskId here would throw
              // before the representative gets archived, leaving it stuck in the inbox.
              // HTPR-5640: siblings are ARCHIVED with the exact same batch timestamp instead of
              // Deleted. The undo path restores every notification sharing that timestamp, so
              // Ctrl+Z brings back what the archive removed; a hard delete made undo lossy.
              if (parsedTaskId !== null) {
                await prisma.notification.updateMany({
                  where:{
                    id:{not:notification_.id},
                    taskId:parsedTaskId,
                    userId,
                    status:{not:"Deleted"}
                  },
                  data:{
                    status:"Archive",
                    archivedAt:timeNow
                  }
                })
              }
              const updatedNotifiction = await prisma.notification.update({where:{id:notification_.id},data:{status:"Archive", archivedAt:timeNow}})
              void broadcastInboxChange(notification_.userId, { originUserId: notification_.userId }, excludeSocketId);
              return res.status(200).json(updatedNotifiction);

            }


            // =================== unarchive only single.
            else if (notification_?.status==="Archive"){
              const onlySingleNotificationUpdate = await prisma.notification.update({
                where:{
                  id:notification_?.id
                },
                data:{
                  status:"Normal",
                  archivedAt:null
                }
              })
              // HTPR-5640: bring back the siblings hidden by the same archive action.
              // They share the representative's exact batch archivedAt, so an unrelated
              // earlier archive of the same task is never touched.
              if (
                parsedTaskId !== null &&
                notification_.archivedAt !== null &&
                notification_.archivedAt !== undefined
              ) {
                await prisma.notification.updateMany({
                  where:{
                    id:{not:notification_.id},
                    taskId:parsedTaskId,
                    userId,
                    status:"Archive",
                    archivedAt:notification_.archivedAt
                  },
                  data:{
                    status:"Normal",
                    archivedAt:null
                  }
                })
              }
              void broadcastInboxChange(onlySingleNotificationUpdate.userId, { originUserId: onlySingleNotificationUpdate.userId }, excludeSocketId);
              return res.status(200).json(onlySingleNotificationUpdate);

            }

            // Any other status (today: Deleted) has nothing to toggle. Same
            // reason as the 404 above: falling out of the branches sent no
            // response at all and the request hung. HTPR-4877.
            return res.status(200).json(notification_);

        } catch (error) {
            console.log(error);
            
            return res.status(500).json({ message: "Internal server error" });
        }
    }
    else {
        return res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;
