import globalAPIHandlers from "@/utils/api/global";
import { selectFavorites } from "@/utils/api/global/apiHelpers/favoritesResponse";
import { useQuery } from "@tanstack/react-query";

export const favoritesQueryKey = (userSettingId: string | null) =>
  ["getAllFavorites", userSettingId] as const;

export const useGetAllFavorites = (
  userSettingId: string | null,
  options?: { enabled?: boolean },
) => {
  return useQuery({
    queryKey: favoritesQueryKey(userSettingId),
    queryFn: () => globalAPIHandlers.getAllFavorites(userSettingId),
    // HTPR-6401: callers used to pass currentUser.id as initialData, which
    // seeded the shared cache with a number and crashed findIndex on /project.
    select: selectFavorites,
    enabled: options?.enabled ?? true,
    initialData: [],
    initialDataUpdatedAt: 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
};
