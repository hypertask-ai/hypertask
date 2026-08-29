import prisma from "@/lib/prisma";
import { IReminder } from "@/models/model";
import type { Prisma } from "@prisma/client";
import {
  TASK_INBOX_REMINDER_LOCK_CLASS,
  withTaskInboxWriteLock,
} from "@/lib/taskCardActions/writeLocks";


type ClaimedReminderRow = {
  id: number;
  createdAt: Date;
  status: string;
  invokeCondition: string;
  updatedAt: Date | null;
  remindAt: Date | null;
  userId: number;
  projectId: number;
  taskId: number;
};

const invokeReminderWithClient = async (
  reminder: IReminder,
  client: Prisma.TransactionClient,
) => {
  const currentDate = new Date();
  console.log("🚀 ~ currentDate:", currentDate)

  // A queued or stale caller must not resurrect an Inbox item after an
  // explicit removal archived its reminder under the same task lock.
  const claimed = await client.reminder.updateMany({
    where: {
      id: reminder.id,
      userId: reminder.userId,
      taskId: reminder.taskId,
      status: "Normal",
    },
    data: { status: "Archive", updatedAt: currentDate },
  });
  if (claimed.count === 0) return "skipped";

  await restoreReminderNotifications(reminder, client);
  return "invoked";
}

const invokeReminder = async (
  reminder: IReminder,
  client?: Prisma.TransactionClient,
) => client
  ? invokeReminderWithClient(reminder, client)
  : withTaskInboxWriteLock(
      reminder.taskId,
      (tx) => invokeReminderWithClient(reminder, tx),
    );

export const invokeDueReminder = async (reminder: IReminder) => {
  const expectedRemindAt = reminder.remindAt
    ? reminder.remindAt instanceof Date
      ? reminder.remindAt
      : new Date(String(reminder.remindAt))
    : null;
  const expectedUpdatedAt = reminder.updatedAt
    ? reminder.updatedAt instanceof Date
      ? reminder.updatedAt
      : new Date(String(reminder.updatedAt))
    : null;
  if (!expectedRemindAt || Number.isNaN(expectedRemindAt.getTime())) return "skipped";
  return prisma.$transaction(async (tx) => {
    // Delivery and both reminder writers use the same task-scoped transaction
    // lock. A reschedule therefore cannot archive notifications between this
    // claim and restore, and a failed restore rolls the claim back atomically.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(${TASK_INBOX_REMINDER_LOCK_CLASS}::int, ${reminder.taskId}::int)
    `;
    const claimed = await tx.$queryRaw<ClaimedReminderRow[]>`
      UPDATE "Reminder" AS r
      SET status = 'Archive', "updatedAt" = now()
      WHERE r.id = ${reminder.id}
        AND r.status = 'Normal'
        AND r."remindAt" IS NOT NULL
        AND r."remindAt" <= now()
        AND r."remindAt" = ${expectedRemindAt}
        AND r."updatedAt" IS NOT DISTINCT FROM ${expectedUpdatedAt}
        AND r."userId" = ${reminder.userId}
        AND r."taskId" = ${reminder.taskId}
        AND EXISTS (
          SELECT 1
          FROM "Task" AS t
          WHERE t.id = r."taskId"
            AND t.status <> 'Deleted'
        )
      RETURNING r.*
    `;

    if (claimed.length === 0) return "skipped";

    await restoreReminderNotifications(
      claimed[0] as unknown as IReminder,
      tx
    );
    return "invoked";
  });
};

const restoreReminderNotifications = async (
  reminder: IReminder,
  client: Prisma.TransactionClient | typeof prisma = prisma
) => {
  // ----------- get the notification we'll archive
  const notifications = await client.notification.findMany({
      where:{
        userId:reminder.userId,
        taskId:reminder.taskId,
        projectId:reminder.projectId,
        // just for safety check if the user is even a part of the project or not anymore by now
        project:{
          AND: [
            {
              OR:[
                {
                  members:{some:{userId:reminder.userId}}
                },
                {
                  ownerId:reminder.userId
                },
              ]
            },
            {
              projectMutes:{none:{userId:reminder.userId}}
            }
          ]
        }
      },
      orderBy:{
        createdAt:"desc"
      },
      distinct:["type"],
      take:1

    })
  console.log("🚀 ~ notifications:", notifications)

  for (const notf of notifications){
    await client.notification.update({
      where:{
        id:notf.id
      },
      data:{
        status:"Normal",
        returnedFromReminders:true,
        seen:false
      }
    })
  }
};

export default invokeReminder
