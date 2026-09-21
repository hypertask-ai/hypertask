import prisma from "@/lib/prisma";
import { inboxConfig } from "@/lib/configs/inbox.config";

const notificationGetCount = async (userId: number) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: {
        status: "Normal",
        userId,
        agentId: null, //We are only getting user notifications here
        // Keep this in step with inboxWhere in getAll.ts, or the rail counts rows the
        // inbox does not show.
        NOT: {
          fromUserId: userId,
          fromAgentId: null,
          type: { in: inboxConfig.selfTriggeredHidden },
        },
        AND: [
          {
            OR: [
              { task: { status: "Normal" } },
              // Mirrors visibleUserInboxWhere: a returned reminder still counts even
              // if its task archived after the reminder was set (HTPR-5683).
              { task: { status: "Archive" }, returnedFromReminders: true },
            ],
          },
          {
            OR: [
              {
                task: {
                  Reminders: {
                    every: {
                      status: { not: "Normal" },
                    },
                  },
                },
              },
              {
                taskId: null,
              },
            ],
          },
        ],
      },
      select: { seen: true },
      orderBy: {
        createdAt: "desc",
      },
      distinct: ["taskId"],
    });
    const unseenNotifications = notifications.find(
      (notification) => notification.seen === false,
    );

    return {
      status: 200,
      json: { all: notifications.length, unseen: unseenNotifications ? 1 : 0 },
    };
  } catch (error) {
    console.log("🚀 ~ notificationGetCount ~ error:", error);

    return {
      status: 500,
      json: { message: "Internal server error" },
    };
    // res.status(500).json({ message: "Internal server error" });
  }
};

export default notificationGetCount;
