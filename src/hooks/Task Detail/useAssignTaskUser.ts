import { useCallback } from "react";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import globalConstants from "@/lib/constants";
import { IAgent, IUser } from "@/models/model";
import { isAgentOption } from "@/lib/assignees";

type AssigneeIntent = "assign" | "unassign" | "toggle";

export const assigneeIntentForOption = (user: IUser | IAgent): AssigneeIntent =>
  user.assigned ? "unassign" : "assign";

// Shape a picked-people list like the assignee rows this endpoint returns, so a
// caller can repaint the task before the request comes back. Consumers read
// `row.agent ?? row.user`, and an empty list is what clears the panel when the
// last person is removed.
export const toAssigneeRows = (
  list: (IUser | IAgent)[],
  taskId?: number
) =>
  list
    .filter((u) => u.assigned)
    .map((u) => {
      const isAgent = isAgentOption(u);
      return {
        id: `optimistic-${u.id}`,
        taskId,
        agentId: isAgent ? u.id : null,
        agent: isAgent ? u : null,
        userId: isAgent ? null : u.id,
        user: isAgent ? null : u,
      };
    });

export const useAssignTaskUser = () => {
  const queryClient = useQueryClient();

  return useCallback(
    async (
      user: IUser | IAgent,
      taskId: number,
      intent?: AssigneeIntent
    ) => {
      let agentId: string | undefined;
      let userId: number;
      if (isAgentOption(user)) {
        agentId = user.id;
        userId = (user as IAgent).userId;
      } else {
        userId = user.id;
      }

      const response = await axios.post("/api/assignees/assign", {
        userId,
        taskId,
        agentId,
        intent,
      });
      queryClient.refetchQueries({
        queryKey: [globalConstants.CommentsTQPrefixKey, taskId],
      });
      queryClient.refetchQueries({
        queryKey: ["followersFor:", taskId],
      });
      return response.data.body;
    },
    [queryClient]
  );
};
