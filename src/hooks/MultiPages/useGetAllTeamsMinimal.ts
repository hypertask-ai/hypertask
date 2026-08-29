
import { getAllTeamsForLSidebar } from "@/utils/api/Homepage";
import {
    selectSidebarTeams,
    sidebarTeamsQueryKey,
} from "@/utils/api/Homepage/sidebarTeamsResponse";
import { useQuery } from "@tanstack/react-query";



export const useGetAllTeamsMinimal = (
  currentUserId:number | null,
  initialData?:any,
  options?: { enabled?: boolean },
) => {
    return useQuery({
        // Versioned to bypass HTML cached by the broken /api/api deployment.
        queryKey:sidebarTeamsQueryKey(currentUserId),
        queryFn:() => getAllTeamsForLSidebar({userId:currentUserId}),
        // HTPR-5178: the broken /api/api URL returned the catch-all HTML with 200,
        // which was persisted as query data. Keep that old value from crashing the
        // globally mounted sidebar while this request replaces it with real teams.
        select:selectSidebarTeams,
        enabled:
          typeof currentUserId === "number" && (options?.enabled ?? true),
        initialData:initialData??[],
        // The seeded [] is a placeholder, never real data, so date it at the epoch.
        // Without this react-query stamps it as fetched *now*, staleTime below then
        // keeps it fresh, refetchOnMount only refetches stale data, and the request
        // is never made: the board sidebar renders favorites and nothing else, for
        // as long as the empty snapshot keeps being re-seeded and persisted
        // (HTPR-5172). Real data still ages normally, so HTPR-4879's fix stands.
        initialDataUpdatedAt: 0,
        refetchOnMount:true,
        // HTPR-4879: with no staleTime the data is stale the instant it lands, so
        // the second component to mount this hook refetched it a second later.
        // Board create/rename/archive/delete all call refetchQueries on this key,
        // which ignores staleTime, so the sidebar still updates immediately.
        staleTime: 60_000,
        refetchOnWindowFocus:false,

})
}
