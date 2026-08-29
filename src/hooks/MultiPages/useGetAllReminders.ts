
import globalAPIHandlers from "@/utils/api/global";
import { useQuery } from "@tanstack/react-query";



export const useGetAllReminders = (userId:number, initialData?:any) => {
    return useQuery({
        queryKey:["reminders"], 
        queryFn:() => globalAPIHandlers.getAllReminders(userId),
        initialData:initialData??[]

})
}
