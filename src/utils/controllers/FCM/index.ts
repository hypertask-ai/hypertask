import axios from "axios";
import fcmConfig from "@/utils/api/fcmConfig";
import { FCMDeviceInfo } from "@/models/model";
import admin from "firebase-admin";
import { Message } from "firebase-admin/messaging";
import prisma from "@/lib/prisma";
import { getFirebaseServiceAccount } from "@/lib/firebaseServiceAccount";
import { resolveNotificationChannelPreference } from "@/utils/controllers/notifications/shouldNotify";
import { NotificationType } from "@prisma/client";

// Call sites pass a mix of enum values and legacy free-form strings; map the
// known ones so the per-category matrix can govern push. Unmapped types keep
// the old all-or-nothing behaviour.
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
    creatorId?: number, // Optional: if provided, will filter based on user preferences
    commentId?: number, // Optional: if provided, will check for "Mentioned" notifications
    data?: Record<string, string>, // Optional: custom data field for the FCM message (e.g., for mentions)
    skipPreferenceFilter?: boolean, // Optional: if true, skip preference filtering and use all devices
    customPreferenceCheck?: Map<number, boolean>, // Optional: pre-computed preference map to use instead of filtering
}

interface FilterDevicesByPreferencesParams {
    devices: Array<{ userId: number; [key: string]: any }>;
    creatorId: number;
    commentId?: number; // Optional: if provided, checks for "Mentioned" notifications
    isHyperAI: boolean;
    type?: string; // Event type; when recognized, the per-category matrix decides
}

/**
 * Filters devices based on user preferences and mention status.
 * Returns a map of userId -> shouldSend boolean.
 * 
 * Logic:
 * - Filters out creator
 * - If user is mentioned (and commentId provided), they should NOT get regular notification
 * - For non-mentioned users: "all" = send, "direct"/"nothing" = don't send
 * - Defaults to false for users without settings
 */
export const filterDevicesByPreferences = async ({
    devices,
    creatorId,
    commentId,
    isHyperAI = false,
    type,
}: FilterDevicesByPreferencesParams): Promise<Map<number, boolean>> => {
    // Filter out creator and get unique user IDs
    const validDevices = devices.filter(device => device && device.userId !== creatorId);
    const uniqueUserIds = [...new Set(validDevices.map(device => device.userId))];
    
    if (uniqueUserIds.length === 0) {
        return new Map();
    }
    
    // Check which users have "Mentioned" type notifications for this comment (if commentId provided)
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
    
    // Create a map of userId -> shouldSend
    const userPreferenceMap = new Map<number, boolean>();
    
    for (const setting of userSettings) {
        const preference = setting.notificationPreference ?? "direct";
        const isMentioned = mentionedUserIds.has(setting.userId);
        
        // If user is mentioned, they should NOT get the regular notification
        // They'll get the "mentioned you" notification instead
        if (isMentioned) {
            userPreferenceMap.set(setting.userId, false);
            continue;
        }
        
        // For recognized event types the per-category matrix (with legacy
        // preference fallback) decides; unmapped types keep the old
        // all-or-nothing rule.
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
    
    // A user with no UserSetting row behaves as the schema default
    // (notificationPreference "all" -> send). Defaulting them to false would
    // silently drop push for legacy accounts that predate the settings table.
    for (const userId of uniqueUserIds) {
        if (!userPreferenceMap.has(userId)) {
            userPreferenceMap.set(userId, true);
        }
    }
    
    return userPreferenceMap;
}

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
    const serviceAccount = getFirebaseServiceAccount();
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

// FCM rejects any message whose data payload exceeds 4KB. The whole comment was
// packed into data.comment, so a long comment meant no push at all, and the
// rejection was logged as an ordinary error while the caller reported success
// (HTPR-4668). The payload only has to carry enough for the notification; the
// app fetches the real comment when it opens the link.
const FCM_DATA_LIMIT_BYTES = 4096;
const FCM_COMMENT_TEXT_BUDGET = 1500;

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

function firebaseMessagingErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("errorInfo" in error)) {
    return undefined;
  }
  const errorInfo = error.errorInfo;
  if (!errorInfo || typeof errorInfo !== "object" || !("code" in errorInfo)) {
    return undefined;
  }
  return typeof errorInfo.code === "string" ? errorInfo.code : undefined;
}

/**
 * Sends FCM push notifications for new comments to assignees, followers, and task owner.
 * Used by both Pages API and MCP via createCommentService.
 */
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

  const validDevices = devices.filter(device => device && device.userId !== creatorId);

  const commentPayload = fcmCommentPayload(comment, commentCreator);
  // Same payload for every device, so one check covers the whole loop. Nothing
  // to shorten beyond the comment itself: the rest is a title, a body and a link.
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

    let deliveryResolved = false;
    try {
      const response = await admin.messaging().send(body);
      console.log("🚀 ~ sendDataOnlyFcm ~ response:", response);
      deliveryResolved = true;
    } catch (error) {
      // Loud: a swallowed rejection here is a push nobody ever receives, and
      // the caller goes on to log success (HTPR-4668).
      console.error("🚀 ~ sendDataOnlyFcm ~ send failed:", error);
      await removeDeadDeviceToken(error, device.firebaseId);
      if (
        firebaseMessagingErrorCode(error) ===
        "messaging/registration-token-not-registered"
      ) {
        deliveryResolved = true;
      } else if (deliveryOptions?.failOnError) {
        deliveryErrors.push(error);
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

// FCM says the token no longer exists (app reinstalled, browser data cleared),
// so the row is permanent garbage: every future send to it would fail too.
const removeDeadDeviceToken = async (error: unknown, firebaseId: string) => {
  if (
    firebaseMessagingErrorCode(error) !==
    "messaging/registration-token-not-registered"
  ) {
    return;
  }
  try {
    await prisma.subscribedDevices.deleteMany({ where: { firebaseId } });
    console.log("🚀 ~ removed dead device token", firebaseId.slice(0, 12));
  } catch (cleanupError) {
    console.log("🚀 ~ dead token cleanup failed:", cleanupError);
  }
};

// ================== GET ARCHIVED PROJECTS
export const sendDataNewCommentFCM = async(props:newCommentFCM) => {
    const link = process.env.NEXT_PUBLIC_BASEURL + '/' + props.afterAppDomain
    
    const creatorId = props.creatorId;
    const commentId = props.commentId;

    // A recognized event type must run through the per-category matrix even when
    // the caller passes no creatorId (assign, follower, reaction, task-move
    // callers don't). Object.hasOwn keeps inherited keys like "toString" out.
    const isRecognizedType =
        typeof props.type === "string" &&
        Object.hasOwn(fcmTypeToNotificationType, props.type);

    let userPreferenceMap: Map<number, boolean> | null = null;
    if (!props.skipPreferenceFilter) {
        if (props.customPreferenceCheck !== undefined) {
            userPreferenceMap = props.customPreferenceCheck;
        } else if (creatorId !== undefined || isRecognizedType) {
            try {
                // -1 never matches a real userId, so no device is dropped.
                userPreferenceMap = await filterDevicesByPreferences({
                    devices: props.devices,
                    creatorId: creatorId ?? -1,
                    commentId,
                    isHyperAI: false,
                    type: props.type,
                });
            } catch (error) {
                // On a settings-query failure, fall back to the device-level
                // gate (userPreferenceMap stays null) rather than throwing an
                // unhandled rejection into the fire-and-forget callers.
                console.log("🚀 ~ sendDataNewCommentFCM ~ preference filter error:", error);
                userPreferenceMap = null;
            }
        }
    }
    
    // console.log("🚀 ~ file: index.ts:21 ~ sendDataNewCommentFCM ~ props:", props)
    for (const device of props.devices){
        console.log("🚀 ~ sendDataNewCommentFCM ~ device:", device.firebaseId)
        
        // Check device-level notification setting
        if (!device.sendNotifications) {
            continue;
        }
        
        // Check user preferences if available
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
        
        // Always carry the deep link in `data` so the service worker can
        // navigate to the task on click (not just focus the open window).
        payload.data = { ...(props.data || {}), click_action: link };
        
        try {
            const response = await admin.messaging().send(payload);
            console.log("🚀 ~ sendDataNewCommentFCM ~ response:", response)
            
        } catch (error) {
            console.log("🚀 ~ sendDataNewCommentFCM ~ error:", error)
            await removeDeadDeviceToken(error, device.firebaseId);
        }
        // console.log("🚀 ~ file: index.ts:20 ~ sendDataNewCommentFCM ~ body:", body)
    //    const response = await axios.post("https://fcm.googleapis.com/fcm/send", body, fcmConfig)
    //    console.log("🚀 ~ sendDataNewCommentFCM ~ response:", response.status)
    }
}


