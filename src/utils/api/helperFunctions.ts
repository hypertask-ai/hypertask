import axios from "axios";

export const copyMeDontImportMe = async(body:any)=>{
    return axios.post ("/api/test/testEndpoint", body)
}

export const addLastActivityAt = async(teamId?:string, userId?:number) => {

        const response = await axios.post("/api/activity/addLastActiveAt", {teamId, userId})
        return response;
    
}