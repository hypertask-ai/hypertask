import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@/hooks/General/useHydrated";

export const useGetSearchCache = (initialData?: any) => {
  const CACHE_KEY = "searchCache";
  const hydrated = useHydrated();
  const fallback = initialData ?? { history: [], results: [] };

  const query = useQuery({
    queryKey: ["Search"],
    queryFn: async () => {
      try {
        const cachedData = localStorage.getItem(CACHE_KEY);
        return cachedData ? JSON.parse(cachedData) : fallback;
      } catch {
        return fallback;
      }
    },
    initialData: fallback,
    enabled: hydrated,
    refetchOnWindowFocus: false,
  });

  // Restored query data can also differ from the server's search history.
  return { ...query, data: hydrated ? query.data : fallback };
};
