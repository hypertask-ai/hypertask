import { useQuery, useQueryClient } from "@tanstack/react-query";

type SetStateAction<T> = T | ((prevState: T) => T);

export default function useQueryState<T>(queryKey: string[], initialData: T) {
  const queryClient = useQueryClient();

  // Initialize the query with the initial data and a queryFn
  useQuery({
    queryKey,
    queryFn: () => initialData, // Provide a queryFn that returns the initial data
    initialData,
    staleTime: Infinity, // Prevent refetching since this is used for state management
    gcTime: Infinity, // Keep data in cache indefinitely
  });

  // Get the current query data
  const getQueryData = (): T => {
    return queryClient.getQueryData(queryKey) ?? initialData;
  };

  // Set the query data with the new payload
  const setState = (payload: SetStateAction<T>): T => {
    const currentData = getQueryData();

    // Determine the new data based on whether payload is a function or a direct value
    const newData = typeof payload === "function" ? (payload as Function)(currentData) : payload;

    // Update the query data
    queryClient.setQueryData(queryKey, newData);

    // Return the updated data synchronously
    return getQueryData();
  };

  return [getQueryData(), setState] as const;
}