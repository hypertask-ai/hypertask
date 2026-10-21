import { ISection } from "@/models/model";
import axios from "axios"

export const getMembersOwnersForAssignees = async (projectId:number) => {
        try {
            const getMembersOwners = await axios.get(`/api/members/getAllForAssignees?projectId=${projectId}`)
            return getMembersOwners.data;
        } catch (error) {
            console.error("Error getting Assignees and Members:", error);
            throw error;
        }
  
}




