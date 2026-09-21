import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { Status } from "@prisma/client";
import { broadcastInboxChange, socketIdFromHeader } from "@/lib/realtime/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        try {
            // HTPR-4772: bulk notification writes belong to the signed user only.
            const session = await getSessionUser(
                new Headers(req.headers as Record<string, string>)
            );
            if (!session) return res.status(401).json({ message: "Unauthorized" });

            const { notificationIds, status } = req.body;
            const archiveStatus:Status = status ?? "Archive"
            if (!notificationIds || !Array.isArray(notificationIds) || notificationIds.length === 0) {
                return res.status(400).json({ message: "Array of {notificationId, taskId, userId} objects is required" });
            }

            // taskId is optional: task-less notifications (e.g. moved/deleted-task notifications)
            // must still be archivable by their own id, otherwise they stay stuck in the inbox.
            const validEntries = notificationIds.filter(({ notificationId }) =>
                notificationId
            );

            if (validEntries.length === 0) {
                return res.status(400).json({ message: "No valid notification entries found" });
            }

            const otherUsersNotification = await prisma.notification.findFirst({
                where: {
                    id: { in: validEntries.map(({ notificationId }) => notificationId) },
                    userId: { not: session.userId },
                },
                select: { id: true },
            });
            if (otherUsersNotification) {
                return res.status(403).json({ message: "Forbidden" });
            }

            const result = await prisma.$transaction(async (tx) => {
                const operations = validEntries.map(({ notificationId, taskId }) => {
                    // HTPR-5640: one batch timestamp shared by the representative and its
                    // siblings, so a later undo (status Normal) can restore exactly what
                    // this archive action hid.
                    const archivedAt = new Date();
                    const ops = [
                        tx.notification.updateMany({
                            where: {
                                id: notificationId,
                                userId: session.userId,
                                status: { not: "Deleted" },
                            },
                            data: {
                                status: archiveStatus,
                                archivedAt,
                            },
                        }),
                    ];
                    // Only clean up sibling notifications for the same task when there is a task,
                    // and only when archiving. On unarchive (status Normal) a sibling write would
                    // re-delete what an earlier archive just hid, and archiving them here would
                    // undo the restore. Siblings are archived with the batch timestamp, never
                    // Deleted, so undo stays lossless (HTPR-5640).
                    if (taskId && archiveStatus !== "Normal") {
                        ops.push(
                            tx.notification.updateMany({
                                where: {
                                    taskId,
                                    userId: session.userId,
                                    id: { not: notificationId },
                                    status: { not: "Deleted" },
                                },
                                data: {
                                    status: "Archive",
                                    archivedAt,
                                },
                            })
                        );
                    }
                    return Promise.all(ops);
                });

                const results = await Promise.all(operations);

                const totalArchived = results.reduce((sum, [archived]) => sum + archived.count, 0);
                const totalDeleted = results.reduce((sum, [, deleted]) => sum + (deleted?.count ?? 0), 0);

                return { totalArchived, totalDeleted };
            });

            // Acting tab's socket id — excluded from the broadcast so it doesn't refetch itself (HTPR-3998).
            const excludeSocketId = socketIdFromHeader(req.headers["x-socket-id"]);
            void broadcastInboxChange(
                session.userId,
                { originUserId: session.userId },
                excludeSocketId
            );

            return res.status(200).json({
                message: "Notifications processed successfully",
                archivedCount: result.totalArchived,
                deletedCount: result.totalDeleted,
            });

        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: "Internal server error" });
        }
    } else {
        return res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;
