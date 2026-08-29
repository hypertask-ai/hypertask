
import { fetchPushNotificationStatus } from "@/utils/api/global/pushNotifications";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

export const prefixKeyUseGetPushStatus = "push-notification-status"
export const useGetPushNotificationStatus = (fcmToken:string|undefined|null, initialData?:any) => {
    return useQuery({
        queryKey:[prefixKeyUseGetPushStatus,fcmToken?"found":"not-found"], 
        queryFn:() => fetchPushNotificationStatus(fcmToken),
        // Only run the query when we have a valid token
        enabled: !!fcmToken,
        initialData:initialData??[]

})
}
