import { useQuery } from "@tanstack/react-query";

export const useGetSearchCache = (initialData?: any) => {
  const CACHE_KEY = "searchCache";

  return useQuery({
    queryKey: ["Search"],
    queryFn: async () => {
      const cachedData = localStorage.getItem(CACHE_KEY);
      if (cachedData) {
        return JSON.parse(cachedData);
      }
      return (
        initialData ?? {
          history: [],
          results: [],
        }
      );
    },
    initialData: (() => {
      try {
        const cachedData = localStorage.getItem(CACHE_KEY);
        return cachedData
          ? JSON.parse(cachedData)
          : initialData ?? { history: [], results: [] };
      } catch {
        return initialData ?? { history: [], results: [] };
      }
    })(),
    refetchOnWindowFocus: false,
  });
};
