import axios from "axios"

export const getAllReminders = async (userId:number|null):Promise<any | undefined> => {
    if (!userId) return
        try {
            const getMembersOwners = await axios.get(`/api/reminders/getAll?userId=${userId}`)
            return getMembersOwners.data ;
        } catch (error) {
            console.error("Error getting Assignees and Members:", error);
            throw error;
        }
  
}




