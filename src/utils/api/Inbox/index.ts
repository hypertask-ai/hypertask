import { setNotificationSeen } from "@/lib/api/typedClient";
import axios from "axios"

export const markNotificationSeen = async (notificationId: number | null) => {
    if (!notificationId) return
    try {
        const response = await setNotificationSeen({ notificationId, seen: 0 })
        return response.data
    } catch (error) {
        console.log(error)
    }
}

export const markAsUnseen = async(itemId:number|null, seen?:boolean,mode?:"byTaskId")=>{
    if (!itemId) return
    try {
        if (mode==="byTaskId"){
            const response = await axios.get(`/api/notifications/markAsUnseen?taskId=${itemId}`)
            return response.data

        }
        else{
            const response = await setNotificationSeen({ notificationId: itemId, seen: seen ? 1 : 0 })
            return response.data
        }
    } catch (error) {
        console.log(error)       
    }
}