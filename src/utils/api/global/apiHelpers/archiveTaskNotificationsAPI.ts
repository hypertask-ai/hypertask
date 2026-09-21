import axios from "axios"
import { realtimeEchoHeaders } from "@/lib/realtime/client"



// get all notifications for a user
export const archiveTaskNotification = async (taskId:number,currentUserId:number,) => {
    if (taskId){
        try {
            const response = fetch(`/api/notifications/markAsDone?&taskId=${taskId}&userId=${currentUserId}`, {
                method: "GET",
                headers: realtimeEchoHeaders()
            })
            return response;
        } catch (error) {
            // Handle the error or return a default value
            console.error("Error getting Assignees and Members:", error);
            throw error; // You can also return a default value or handle the error in a different way
        }
  
    }
}




