
import { fetchPushNotificationStatus } from "@/utils/api/global/pushNotifications";
import { useQuery } from "@tanstack/react-query";



export const useGetPushNotification = (queryKey:any, firebaseId:string, initialData?:any) => {
    return useQuery({
        queryKey:[queryKey], 
        queryFn:() => fetchPushNotificationStatus(firebaseId),
        initialData:initialData??[]

})
}
