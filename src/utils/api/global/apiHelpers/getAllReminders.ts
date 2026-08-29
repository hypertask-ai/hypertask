// import { IPriority } from "@/models/model";
import axios from "axios"



// get all notifications for a user 
export const getAllReminders = async (userId:number|null):Promise<any | undefined> => {
    if (!userId) return
        try {
            const getMembersOwners = await axios.get(`/api/reminders/getAll?userId=${userId}`)
            return getMembersOwners.data ;
        } catch (error) {
            // Handle the error or return a default value
            console.error("Error getting Assignees and Members:", error);
            throw error; // You can also return a default value or handle the error in a different way
        }
  
}




