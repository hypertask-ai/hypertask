import { useQuery, useQueryClient } from "@tanstack/react-query";

type SetStateAction<T> = T | ((prevState: T) => T);

export default function useQueryState<T>(queryKey: string[], initialData: T) {
  const queryClient = useQueryClient();

  useQuery({
    queryKey,
    queryFn: () => initialData,
    initialData,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const getQueryData = (): T => {
    return queryClient.getQueryData(queryKey) ?? initialData;
  };

  const setState = (payload: SetStateAction<T>): T => {
    const currentData = getQueryData();

    const newData = typeof payload === "function" ? (payload as Function)(currentData) : payload;

    queryClient.setQueryData(queryKey, newData);

    return getQueryData();
  };

  return [getQueryData(), setState] as const;
}