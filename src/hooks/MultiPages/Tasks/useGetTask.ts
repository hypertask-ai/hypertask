
import { useQuery } from "@tanstack/react-query";
import axios from "axios";


export const fetchSingleTask = async(taskId:number|null)=>{
    if (!taskId) return
    const res = await axios.get("/api/tasks/single?id="+taskId);
    return res.data
}
export const useGetSingleTask = (taskId:number|null, initialData?:any) => {
    return useQuery({
        queryKey:["task-",taskId], 
        queryFn:() => fetchSingleTask(taskId),
        
        initialData:initialData??[]

})
}
