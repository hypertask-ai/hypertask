import { useQuery } from "@tanstack/react-query";
import { useStarAndPin } from "../Task Detail/useStarAndPin";

export const useGetPinnedContent = (userId: number, initialData?: any) => {
  const { getAllPinned } = useStarAndPin();
  return useQuery({
    queryKey: ["Saved pinned for [userId]:", userId],
    queryFn: () => getAllPinned(),
    refetchOnWindowFocus: true,
    initialData: initialData ?? [],
  });
};
