
import { IAnnouncementPosts } from "@/models/Announcements/model";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

export const prefixUseGetAnnouncements = 'In-App Announcements'

export const useGetAnnouncements = (
    userId:number|undefined,
    initialData?:any,
    options?: { enabled?: boolean },
) => {
    return useQuery({
        queryKey:[prefixUseGetAnnouncements, userId], 
        queryFn:() => getUserAnnouncements(userId),
        enabled: options?.enabled ?? true,
        
        initialData:initialData??[],
        // The empty seed is a placeholder, not a fresh server response. Keep it
        // stale so releasing the startup gate always loads announcements.
        initialDataUpdatedAt: 0,
        // HTPR-4879: same fix as the sidebar. Announcements are published by a
        // cron every couple of days, and marking one read writes the cache
        // directly, so nothing here needs second-by-second freshness.
        staleTime: 5 * 60_000,
        refetchOnWindowFocus:false,

})
}



const getUserAnnouncements = async(userId:number|undefined):Promise<IAnnouncementPosts|null|undefined>=>{
    if (!userId) return null
    try {
        const response = await axios.get(`/api/users/announcements/getUserAnnouncements?userId=${userId}`)
        return response.data
    } catch (error) {
        console.log("🚀 ~ getUserAnnouncements ~ error:", error)
    }
}
