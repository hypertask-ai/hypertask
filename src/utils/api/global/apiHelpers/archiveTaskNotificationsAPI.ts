import axios from "axios"
import { realtimeEchoHeaders } from "@/lib/realtime/client"

export const archiveTaskNotification = async (taskId:number,currentUserId:number,) => {
    if (taskId){
        try {
            const response = fetch("/api/notifications/markAsDone", {
                method: "POST",
                headers: { ...realtimeEchoHeaders(), "Content-Type": "application/json" },
                body: JSON.stringify({ taskId, userId: currentUserId }),
            })
            return response;
        } catch (error) {
            console.error("Error getting Assignees and Members:", error);
            throw error;
        }
  
    }
}




