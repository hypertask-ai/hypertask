import axios from "axios";

export const copyMeDontImportMe = async(body:any)=>{
    return axios.post ("/api/test/testEndpoint", body)
}

// =================== RUN MIGRATION WITH THIS
export const executeTeamStructureMigration = async()=>{
    const response = axios.post("/api/account_team_migration?userId=4")
    return response;
}

export const addLastActivityAt = async(teamId?:string, userId?:number) => {

        const response = await axios.post("/api/activity/addLastActiveAt", {teamId, userId})
        return response;
    
}