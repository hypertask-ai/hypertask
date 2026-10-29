import { FCMDeviceInfo } from "@/models/model";
import type { Message } from "firebase-admin/messaging";
import prisma from "@/lib/prisma";
import { filterTaskReadersNow } from "@/lib/access/canReadTaskNow";
import { resolveNotificationChannelPreference } from "@/utils/controllers/notifications/shouldNotify";
import { NotificationType } from "@prisma/client";

const fcmTypeToNotificationType: Record<string, NotificationType> = {
    Comment: "Comment",
    newComment: "Comment",
    Reacted: "Reacted",
    Assigned: "Assigned",
    newAssignee: "Assigned",
    removeAssignee: "Assigned",
    AddedToFollowerInTask: "AddedToFollowerInTask",
    addFollower: "AddedToFollowerInTask",
    Mentioned: "Mentioned",
    TaskMoved: "TaskMoved",
    taskMoved: "TaskMoved",
    TaskArchived: "TaskArchived",
    TaskMovedToInbox: "TaskMovedToInbox",
    TaskUpdateDescription: "TaskUpdateDescription",
    TaskDueDate: "TaskDueDate",
    TaskOverdue: "TaskOverdue",
    TaskReminder: "TaskReminder",
};

interface newCommentFCM {
    notificationBody:string,
    notificationTitle:string,
    type:string,
    devices:FCMDeviceInfo[],
    payload:any,
    taskTitle:string,
    afterAppDomain:string,
    creatorId?: number,
    commentId?: number,
    taskId: number,
    data?: Record<string, string>,
    skipPreferenceFilter?: boolean,
    customPreferenceCheck?: Map<number, boolean>,
}

interface FilterDevicesByPreferencesParams {
    devices: Array<{ userId: number; [key: string]: any }>;
    creatorId: number;
    commentId?: number;
    isHyperAI: boolean;
    type?: string;
}

export const filterDevicesByPreferences = async ({
    devices,
    creatorId,
    commentId,
    isHyperAI = false,
    type,
}: FilterDevicesByPreferencesParams): Promise<Map<number, boolean>> => {
    const validDevices = devices.filter(device => device && device.userId !== creatorId);
    const uniqueUserIds = [...new Set(validDevices.map(device => device.userId))];
    
    if (uniqueUserIds.length === 0) {
        return new Map();
    }
    
    const queries: Promise<any>[] = [
        prisma.userSetting.findMany({
            where: {
                userId: { in: uniqueUserIds }
            },
            select: {
                userId: true,
                notificationPreference: true,
                notificationMatrix: true,
                notification: true
            }
        })
    ];
    
    if (commentId) {
        queries.push(
            prisma.notification.findMany({
                where: {
                    commentId: commentId,
                    type: {in: ["Mentioned", "AddedToFollowerInTask", "Assigned"]},
                    userId: { in: uniqueUserIds }
                },
                select: {
                    userId: true
                }
            })
        );
    }
    
    const results = await Promise.all(queries);
    const userSettings = results[0];
    const mentionedNotifications = commentId ? results[1] : [];
    
    const mentionedUserIds = new Set(mentionedNotifications.map((n: any) => n.userId));
    
    const userPreferenceMap = new Map<number, boolean>();
    
    for (const setting of userSettings) {
        const preference = setting.notificationPreference ?? "direct";
        const isMentioned = mentionedUserIds.has(setting.userId);
        
        if (isMentioned) {
            userPreferenceMap.set(setting.userId, false);
            continue;
        }
        
        const notificationType = type ? fcmTypeToNotificationType[type] : undefined;
        let shouldSend = false;
        if (isHyperAI) {
            shouldSend = true;
        } else if (notificationType) {
            shouldSend = resolveNotificationChannelPreference(
                setting,
                notificationType,
                "push"
            );
        } else if (preference === "all") {
            shouldSend = true;
        }

        userPreferenceMap.set(setting.userId, shouldSend);
    }
    
    for (const userId of uniqueUserIds) {
        if (!userPreferenceMap.has(userId)) {
            userPreferenceMap.set(userId, true);
        }
    }
    
    return userPreferenceMap;
}

const FCM_DATA_LIMIT_BYTES = 4096;
const FCM_COMMENT_TEXT_BUDGET = 1500;

const sendFirebaseMessage = async (message: Message) => {
  const [{ getMessaging }, { getFirebaseAdmin }] = await Promise.all([
    import("firebase-admin/messaging"),
    import("@/lib/firebase-admin"),
  ]);
  return getMessaging(getFirebaseAdmin()).send(message);
};

const fcmCommentPayload = (comment: any, creator: any) => {
  const text = typeof comment?.text === "string" ? comment.text : "";
  const truncated = text.length > FCM_COMMENT_TEXT_BUDGET;
  return JSON.stringify({
    ...comment,
    text: truncated ? text.slice(0, FCM_COMMENT_TEXT_BUDGET) : text,
    ...(truncated ? { textTruncated: true } : {}),
    creator: {
      displayName: creator?.displayName,
      photoURL: creator?.photoURL,
    },
  });
};

const UNREGISTERED_TOKEN_CODE = "messaging/registration-token-not-registered";

function firebaseMessagingErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  if ("code" in error && typeof error.code === "string") {
    return error.code;
  }
  if (!("errorInfo" in error)) {
    return undefined;
  }
  const errorInfo = error.errorInfo;
  if (!errorInfo || typeof errorInfo !== "object" || !("code" in errorInfo)) {
    return undefined;
  }
  return typeof errorInfo.code === "string" ? errorInfo.code : undefined;
}

function isUnregisteredTokenError(error: unknown): boolean {
  return firebaseMessagingErrorCode(error) === UNREGISTERED_TOKEN_CODE;
}

export const sendDataOnlyFcm = async (
  devices: any[],
  commentCreator: any,
  taskTitle: string,
  uniqueIndex: number,
  projectId: number,
  creatorId: number,
  comment: any,
  deliveryOptions?: {
    failOnError?: boolean;
    deliveredDeviceIds?: ReadonlySet<string>;
    beforeDelivery?: () => Promise<void>;
    markDelivered?: (firebaseId: string) => Promise<void>;
  },
) => {
  const deliveryErrors: unknown[] = [];
  const deliveredDeviceIds = new Set(deliveryOptions?.deliveredDeviceIds);
  const link = `${process.env.NEXT_PUBLIC_BASEURL}/detail/project-${projectId}/${uniqueIndex}?commentId=comment-${comment.id}`;

  const userPreferenceMap = await filterDevicesByPreferences({
    devices,
    creatorId,
    commentId: comment.id,
    isHyperAI: creatorId === parseInt(process.env.NEXT_PUBLIC_HYPERAI_ID || "332"),
    type: "Comment",
  });

  const candidateDevices = devices.filter(device =>
    device && device.userId !== creatorId && !deliveredDeviceIds.has(device.firebaseId)
  );
  const allowedUserIds = new Set(await filterTaskReadersNow(
    candidateDevices.map(device => device.userId),
    comment.taskId,
  ));
  const validDevices = candidateDevices.filter(device => allowedUserIds.has(device.userId));

  const commentPayload = fcmCommentPayload(comment, commentCreator);
  const payloadBytes = Buffer.byteLength(commentPayload, "utf8");
  if (payloadBytes > FCM_DATA_LIMIT_BYTES) {
    console.error(
      `🚀 ~ sendDataOnlyFcm ~ data payload still ${payloadBytes}B after truncation, FCM will reject it (comment ${comment?.id})`
    );
  }

  for (const device of validDevices) {
    if (deliveredDeviceIds.has(device.firebaseId)) continue;
    const shouldSend = userPreferenceMap.get(device.userId);

    if (!shouldSend) {
      console.log(`🚀 ~ sendDataOnlyFcm ~ Push notification blocked for user ${device.userId} (mentioned or preference)`);
      continue;
    }

    const body: Message = {
      token: device.firebaseId,
      data: {
        type: "newComment",
        comment: commentPayload,
        body: `${commentCreator.displayName} posted a comment`,
        title: taskTitle,
        click_action: link,
      },
      notification: {
        body: `${commentCreator.displayName} posted a comment`,
        title: taskTitle,
      },
      webpush: {
        fcmOptions: {
          link: link,
        },
      },
    };

    await deliveryOptions?.beforeDelivery?.();
    let deliveryResolved = false;
    try {
      const response = await sendFirebaseMessage(body);
      console.log("🚀 ~ sendDataOnlyFcm ~ response:", response);
      deliveryResolved = true;
    } catch (error) {
      if (isUnregisteredTokenError(error)) {
        console.log(
          `🚀 ~ sendDataOnlyFcm ~ dropping unregistered device token ${device.firebaseId.slice(0, 12)}`
        );
        await removeDeadDeviceToken(device.firebaseId);
        deliveryResolved = true;
      } else {
        console.error("🚀 ~ sendDataOnlyFcm ~ send failed:", error);
        if (deliveryOptions?.failOnError) {
          deliveryErrors.push(error);
        }
      }
    }
    if (deliveryResolved) {
      await deliveryOptions?.markDelivered?.(device.firebaseId);
      deliveredDeviceIds.add(device.firebaseId);
    }
  }
  if (deliveryErrors.length > 0) {
    throw new AggregateError(deliveryErrors, "FCM delivery failed");
  }
};

const removeDeadDeviceToken = async (firebaseId: string) => {
  try {
    await prisma.subscribedDevices.deleteMany({ where: { firebaseId } });
    console.log("🚀 ~ removed dead device token", firebaseId.slice(0, 12));
  } catch (cleanupError) {
    console.log("🚀 ~ dead token cleanup failed:", cleanupError);
  }
};

export const sendDataNewCommentFCM = async(props:newCommentFCM) => {
    const link = process.env.NEXT_PUBLIC_BASEURL + '/' + props.afterAppDomain
    
    const creatorId = props.creatorId;
    const commentId = props.commentId;

    const isRecognizedType =
        typeof props.type === "string" &&
        Object.hasOwn(fcmTypeToNotificationType, props.type);

    let userPreferenceMap: Map<number, boolean> | null = null;
    if (!props.skipPreferenceFilter) {
        if (props.customPreferenceCheck !== undefined) {
            userPreferenceMap = props.customPreferenceCheck;
        } else if (creatorId !== undefined || isRecognizedType) {
            try {
                userPreferenceMap = await filterDevicesByPreferences({
                    devices: props.devices,
                    creatorId: creatorId ?? -1,
                    commentId,
                    isHyperAI: false,
                    type: props.type,
                });
            } catch (error) {
                console.log("🚀 ~ sendDataNewCommentFCM ~ preference filter error:", error);
                userPreferenceMap = null;
            }
        }
    }
    
    let readerIds: number[];
    try {
        readerIds = await filterTaskReadersNow(
            props.devices.map(device => device.userId),
            props.taskId,
        );
    } catch (error) {
        console.error("🚀 ~ sendDataNewCommentFCM ~ task access check failed, push skipped:", error);
        return;
    }
    const allowedUserIds = new Set(readerIds);
    const validDevices = props.devices.filter(device => allowedUserIds.has(device.userId));

    for (const device of validDevices){
        console.log("🚀 ~ sendDataNewCommentFCM ~ device:", device.firebaseId)
        
        if (!device.sendNotifications) {
            continue;
        }
        
        if (userPreferenceMap !== null && !props.skipPreferenceFilter) {
            const shouldSend = userPreferenceMap.get(device.userId);
            if (!shouldSend) {
                console.log(`🚀 ~ sendDataNewCommentFCM ~ Push notification blocked for user ${device.userId} (mentioned or preference)`);
                continue;
            }
        }
        
        const payload: Message = {
            token:device.firebaseId,
            notification: {
              title: props.notificationTitle,
              body: props.notificationBody,
            },
            webpush:  {
              fcmOptions: {
                link:link,
              },
            },
          };
        
        payload.data = { ...(props.data || {}), click_action: link };
        
        try {
            const response = await sendFirebaseMessage(payload);
            console.log("🚀 ~ sendDataNewCommentFCM ~ response:", response)
            
        } catch (error) {
            console.log("🚀 ~ sendDataNewCommentFCM ~ error:", error)
            if (isUnregisteredTokenError(error)) {
                await removeDeadDeviceToken(device.firebaseId);
            }
        }
    }
}


