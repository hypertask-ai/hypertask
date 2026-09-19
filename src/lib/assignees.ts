import type { IAgent, IUser } from "@/models/model";

type AssigneeRow = {
  id: number | string;
  userId?: number | null;
  user?: IUser | null;
  agentId?: string | null;
  agent?: IAgent | null;
  displayName?: string;
  photoURL?: string;
};

export const isAgentAssigneeRow = (assignee: AssigneeRow) =>
  assignee.agentId != null || assignee.agent != null;

export const assigneePublicName = (assignee: AssigneeRow) =>
  assignee.agent?.displayName ??
  assignee.user?.displayName ??
  assignee.displayName ??
  "";

export const commentActorName = (comment?: {
  agent?: { displayName?: string | null } | null;
  agentDisplayName?: string | null;
  creator?: { displayName?: string | null } | null;
} | null) =>
  comment?.agent?.displayName ??
  comment?.agentDisplayName ??
  comment?.creator?.displayName ??
  "";

export const isAgentOption = (
  assignee: IUser | IAgent,
): assignee is IAgent => typeof assignee.id === "string";

export const preserveHiddenAssignedOptions = (
  visibleOptions: (IUser | IAgent)[],
  assignedOptions: (IUser | IAgent)[],
  includePeople: boolean,
  includeAgents: boolean,
) => [
  ...assignedOptions
    .filter((assignee) =>
      isAgentOption(assignee) ? !includeAgents : !includePeople,
    )
    .map((assignee) => ({ ...assignee, assigned: true })),
  ...visibleOptions,
];

export const splitAssignees = (assignees?: readonly AssigneeRow[]) => {
  const humanAssignees: IUser[] = [];
  const agentAssignees: IAgent[] = [];

  for (const assignee of assignees ?? []) {
    if (isAgentAssigneeRow(assignee)) {
      agentAssignees.push(
        assignee.agent ??
          ({
            id: assignee.agentId,
            displayName: assignee.displayName,
            photoURL: assignee.photoURL,
          } as IAgent),
      );
      continue;
    }

    humanAssignees.push(
      assignee.user ??
        ({
          id: assignee.userId ?? assignee.id,
          displayName: assignee.displayName,
          photoURL: assignee.photoURL,
        } as IUser),
    );
  }

  return { humanAssignees, agentAssignees };
};
