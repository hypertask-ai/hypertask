import { FCMDeviceInfo } from "@/models/model"
import axios from "axios"



// get all notifications for a user 
export const fetchPushNotificationStatus = async (firebaseId:string|undefined|null):Promise<FCMDeviceInfo> => {
    if (firebaseId) {
        try {
            const response = await axios.get(`/api/notifications/getPushNotificationStatus?firebaseId=${firebaseId}`)
            const returnObj: FCMDeviceInfo = response.data
            return returnObj;
        } catch (error) {
            // Handle the error or return a default value
            console.error("Error fetching push notification status:", error);
            throw error; // You can also return a default value or handle the error in a different way
        }
    } else {
        // Return a default value or reject the promise
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