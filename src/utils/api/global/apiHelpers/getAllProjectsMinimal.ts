import axios from "axios"



// get all notifications for a user 
export const getAllProjectsMinimal = async (mode?:"ExtraMinimal") => {
        try {
            const AllProjectsMinimal = await axios.get(`/api/projects/getAllMinimal?mode=${mode}`)
            return AllProjectsMinimal.data;
        } catch (error) {
            // Handle the error or return a default value
            console.error("Error getting Assignees and Members:", error);
            throw error; // You can also return a default value or handle the error in a different way
        }
  
}


// get all notifications for a user 
export const getAllTeamMembers = async (teamId:string) => {
    try {
        const allTeamMembers = await axios.get(`/api/members/getAllTeamMembers?teamId=${teamId}`)
        return allTeamMembers.data;
    } catch (error) {
        // Handle the error or return a default value
        console.error("Error getting Assignees and Members:", error);
        throw error; // You can also return a default value or handle the error in a different way
    }

}







