import { useMemo } from "react";
import { useAgents } from "@/hooks/MultiPages/useAgents";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7865_AGENT_CREATOR_FILTER_FLAG } from "@/lib/flags/definitions/htpr-7865-agent-creator-filter";
import { calendarTaskFiltersAtom, currentProjectAtom } from "@/store";
import { useGetAllMembersForAssign } from "@/hooks/MultiPages/useGetMembersForAssignees";
import { IAgent, IUser } from "@/models/model";
import { getActiveFiltersFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { useRecoilValue } from "@/lib/state";
import type { CalendarUserSummary } from "@/lib/calendarSync/contract";
import { useMyTasksFilterController } from "@/lib/myTasksFilterContext";
import type { UserSelectionEntry } from "@/components/Modals/UserSelectionModal";

export const useCreatedByFilter = ({
    createdByHandler,
    calendarMembers,
    view,
}: {
    createdByHandler: (param?: IUser | CalendarUserSummary | IAgent) => Promise<void>;
    calendarMembers?: CalendarUserSummary[];
    view: "Kanban" | "Calendar" | "MyTasks";
}) => {
    const agentCreatorFilterEnabled = useFlag(HTPR_7865_AGENT_CREATOR_FILTER_FLAG);
    const currentProject = useRecoilValue(currentProjectAtom);
    const { allAgents } = useAgents({
        projectId: view === "Kanban" && agentCreatorFilterEnabled ? currentProject?.id : null,
        teamId: view === "Kanban" && agentCreatorFilterEnabled ? currentProject?.teamId : null,
    });
    const calendarTaskFilters = useRecoilValue(calendarTaskFiltersAtom);
    const myTasksFilters = useMyTasksFilterController();
    const { data: membersAndOwner } = useGetAllMembersForAssign(
        ["created-by-filter", currentProject?.id ?? -1],
        currentProject?.id!
    );
    const activeFilters = getActiveFiltersFromProject(
        currentProject
    ).addedFilters.find((x) => x.type === "CreatedBy");

    const allUsers = useMemo(() => {
        const uniqueUsersMap = new Map<number, IUser | CalendarUserSummary>();

        if ((view === "Calendar" || view === "MyTasks") && calendarMembers?.length) {
            for (const user of calendarMembers) {
                if (user) uniqueUsersMap.set(user.id, user);
            }
        } else if (view === "Kanban" && membersAndOwner) {
            const members: IUser[] =
                membersAndOwner.members?.map(({ user }: { user: IUser }) => user) || [];
            const owner = membersAndOwner.owner;
            for (const user of members) {
                if (user) uniqueUsersMap.set(user.id, user);
            }
            if (owner) uniqueUsersMap.set(owner.id, owner);
        }

        const agents = view === "Kanban" && agentCreatorFilterEnabled
            ? (allAgents ?? []).filter(agent => !agent.revokedAt)
            : [];
        return [...uniqueUsersMap.values(), ...agents];
    }, [view, calendarMembers, membersAndOwner, allAgents, agentCreatorFilterEnabled]);

    const activeFiltersFlatMap = useMemo(() => {
        if (view === "Calendar") {
            return calendarTaskFilters.createdBy;
        }
        if (view === "MyTasks") {
            return myTasksFilters?.activeFilters.addedFilters.find((x) => x.type === "CreatedBy")?.searchPayload.flatMap((x: { id: number | string }) => x.id) ?? [];
        }
        return activeFilters?.searchPayload.flatMap((x: { id: number | string }) => x.id) ?? [];
    }, [view, calendarTaskFilters.createdBy, activeFilters, myTasksFilters?.activeFilters]);

    const onSelectHandler = (
        selectedUsers?: UserSelectionEntry | UserSelectionEntry[],
    ) => {
        if (Array.isArray(selectedUsers) && selectedUsers.length > 0) {
            createdByHandler(selectedUsers[0]);
        } else if (selectedUsers && !Array.isArray(selectedUsers)) {
            createdByHandler(selectedUsers);
        } else {
            createdByHandler(undefined);
        }
    };
    return {
        onSelectHandler,
        allUsers,
        activeFiltersFlatMap,
    };
};
