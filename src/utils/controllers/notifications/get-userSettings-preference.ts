import prisma from "@/lib/prisma"
import { NotificationType } from "@prisma/client";

export const getUserPreferenceFromUserId = async (userId: number, type: NotificationType) => {
    const userSetting = await prisma.userSetting.findUnique({
        where: { userId }
    })
    if (!userSetting) return false;
    const preference = userSetting.notificationPreference ?? "direct";


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