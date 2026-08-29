
import globalAPIHandlers from "@/utils/api/global";
import { useQuery } from "@tanstack/react-query";

export const favoritesQueryKey = (userSettingId:string|null) =>
  ["getAllFavorites", userSettingId] as const;


export const useGetAllFavorites = (
  userSettingId:string|null,
  initialData?:any,
  options?: { enabled?: boolean },
) => {
    return useQuery({
        queryKey:favoritesQueryKey(userSettingId),
        queryFn:() => globalAPIHandlers.getAllFavorites(userSettingId),
        enabled: options?.enabled ?? true,
        initialData:initialData??[],
        initialDataUpdatedAt: 0,
        staleTime: 60_000,
        refetchOnWindowFocus: false,

})
}
