import { consumeEarlyAppShellBootstrapSlice } from "@/lib/appShellBootstrap/client";
import axios from "axios"

export const getAllProjectsMinimal = async (mode?:"ExtraMinimal") => {
        try {
            if (mode === "ExtraMinimal") {
                const bootstrapped = await consumeEarlyAppShellBootstrapSlice<unknown[]>("projects");
                if (Array.isArray(bootstrapped)) return bootstrapped;
            }
            const AllProjectsMinimal = await axios.get(`/api/projects/getAllMinimal?mode=${mode}`)
            return AllProjectsMinimal.data;
        } catch (error) {
            console.error("Error getting Assignees and Members:", error);
            throw error;
        }
  
}


export const getAllTeamMembers = async (teamId:string) => {
    try {
        const allTeamMembers = await axios.get(`/api/members/getAllTeamMembers?teamId=${teamId}`)
        return allTeamMembers.data;
    } catch (error) {
        console.error("Error getting Assignees and Members:", error);
        throw error;
    }

}







