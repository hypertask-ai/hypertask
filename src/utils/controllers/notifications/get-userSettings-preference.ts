import prisma from "@/lib/prisma"
import { NotificationType } from "@prisma/client";

export const getUserPreferenceFromUserId = async (userId: number, type: NotificationType) => {
    const userSetting = await prisma.userSetting.findUnique({
        where: { userId }
    })
    if (!userSetting) return false;
    const preference = userSetting.notificationPreference ?? "direct";

    // Decide whether to send based on preference:
    // - "all": send all emails (followers + mentions)
    // - "direct": only send direct @mention emails
    // - "nothing": never send

    let shouldSend = false;
    if (preference==="all"){
        shouldSend = true;
    }
    else if (preference==="nothing"){
        shouldSend = false;
    }
    else if (preference==="direct"){
        shouldSend = type === "Mentioned" || type === "AddedToFollowerInTask" || type === "Assigned";
    }
    return shouldSend;
}