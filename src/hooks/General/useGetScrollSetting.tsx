import { getScrollSetting } from "@/utils/api/Task Detail";
import { ScrollSetting } from "@prisma/client";
import { useQuery } from "@tanstack/react-query";

export const useGetScrollSetting = (queryKey: any, initialData?: any) => {
  return useQuery({
    queryKey: queryKey,
    queryFn: () => getScrollSetting(),
    initialData: initialData ?? { setting: "None" as ScrollSetting },
    refetchOnWindowFocus: false,
  });
};
