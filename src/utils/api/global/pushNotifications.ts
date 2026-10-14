import { FCMDeviceInfo } from "@/models/model"
import axios from "axios"

export const fetchPushNotificationStatus = async (firebaseId:string|undefined|null):Promise<FCMDeviceInfo> => {
    if (firebaseId) {
        try {
            const response = await axios.get(`/api/notifications/getPushNotificationStatus?firebaseId=${firebaseId}`)
            const returnObj: FCMDeviceInfo = response.data
            return returnObj;
        } catch (error) {
            console.error("Error fetching push notification status:", error);
            throw error;
        }
    } else {
        console.error("Invalid firebaseId:", firebaseId);
        throw new Error("Invalid firebaseId");
    }
}



export const changePushNotificationStatus = async (firebaseId:string, newStatus:boolean)=>{
    try {

        const body ={
            firebaseId:firebaseId,
            newStatus:newStatus
        }
        console.log("🚀 ~ file: pushNotifications.ts:39 ~ changePushNotificationStatus ~ body:", body)
        const response = await axios.post(`/api/notifications/changePushNotificationStatus`, body)

        console.log("🚀 ~ file: pushNotifications.ts:41 ~ changePushNotificationStatus ~ response:", response)
    } catch (error) {
    }
}