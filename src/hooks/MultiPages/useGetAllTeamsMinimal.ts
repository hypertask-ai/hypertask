
import { getAllTeamsForLSidebar } from "@/utils/api/Homepage";
import {
    selectSidebarTeams,
    sidebarTeamsQueryKey,
} from "@/utils/api/Homepage/sidebarTeamsResponse";
import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@/hooks/General/useHydrated";



export const useGetAllTeamsMinimal = (
  currentUserId:number | null,
  initialData?:any,
  options?: { enabled?: boolean },
) => {
    return useQuery({
        queryKey:sidebarTeamsQueryKey(currentUserId),
        queryFn:() => getAllTeamsForLSidebar({userId:currentUserId}),
        select:selectSidebarTeams,
        enabled:
          typeof currentUserId === "number" && (options?.enabled ?? true),
        ...(useHydrated()
          ? {}
          : { queryKey: [...sidebarTeamsQueryKey(currentUserId), "hydrating"], enabled: false }),
        initialData:initialData??[],
        initialDataUpdatedAt: 0,
        refetchOnMount:true,
        staleTime: 60_000,
        refetchOnWindowFocus:false,

})
}
