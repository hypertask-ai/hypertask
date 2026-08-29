import { getAgentNotifications } from "@/utils/api/Homepage";
import { useQuery } from "@tanstack/react-query";

export const useGetAgentNotifications = (agentId: string) => {
  return useQuery({
    queryKey: ["agent-inbox", agentId],
    queryFn: () => getAgentNotifications(agentId),
    initialData: {
      structuredData: { data: [], tabs: [] },
      notifications: [],
      splitsNoImportant: [],
      showImportantSplit: false,
    },
  });
};
