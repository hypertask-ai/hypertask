import { useQuery } from "@tanstack/react-query";
import { useStarAndPin } from "../Task Detail/useStarAndPin";

export const useGetStarredContent = (userId: number, initialData?: any) => {
  const { getAllStarred } = useStarAndPin();
  return useQuery({
    queryKey: ["Saved starred for [userId]:", userId],
    queryFn: () => getAllStarred(),
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    gcTime: 60 * 1000 * 60,
    initialData: initialData ?? [],
  });
};
