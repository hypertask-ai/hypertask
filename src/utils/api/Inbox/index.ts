import type { setNotificationSeen } from "@/lib/api/typedClient";
import axios from "axios"

export const markNotificationSeen = async (notificationId: number | null, write?: typeof setNotificationSeen) => {
    if (!notificationId) return
    try {
        const response = write ? await write({ notificationId, seen: 0 }) : await axios.get(
            `/api/notifications/markAsUnseen?notificationId=${notificationId}&seen=0`
        )
        return response.data
    } catch (error) {
        console.log(error)
    }
}

export const markAsUnseen = async(itemId:number|null, seen?:boolean,mode?:"byTaskId",write?:typeof setNotificationSeen)=>{
    if (!itemId) return
    try {
        if (mode==="byTaskId"){
            const response = await axios.get(`/api/notifications/markAsUnseen?taskId=${itemId}`)
            return response.data

        }
        else{
            const response = write ? await write({ notificationId: itemId, seen: seen ? 1 : 0 }) : await axios.get(`/api/notifications/markAsUnseen?notificationId=${itemId}&seen=${seen?1:0}`)
            return response.data
        }
    } catch (error) {
        console.log(error)       
    }
}