import { logger as htLogger } from "#logger";
import { ISection } from "@/models/model";
import axios from "axios"



// get all notifications for a user 
export const getMembersOwnersForAssignees = async (projectId:number) => {
        try {
            const getMembersOwners = await axios.get(`/api/members/getAllForAssignees?projectId=${projectId}`)
            return getMembersOwners.data;
        } catch (error) {
            // Handle the error or return a default value
            htLogger.error("Error getting Assignees and Members:", error);
            throw error; // You can also return a default value or handle the error in a different way
        }
  
}




