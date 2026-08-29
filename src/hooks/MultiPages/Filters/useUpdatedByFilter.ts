import { useEffect, useMemo, useState } from "react";
import { calendarTaskFiltersAtom, currentProjectAtom } from "@/store";
import { useGetAllMembersForAssign } from "@/hooks/MultiPages/useGetMembersForAssignees";
import { IAgent, IUser } from "@/models/model";
import { getActiveFiltersFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { useRecoilValue } from "@/lib/state";
import { useAgents } from "@/hooks/MultiPages/useAgents";
import type { CalendarUserSummary } from "@/lib/calendarSync/contract";
import type { UserSelectionEntry } from "@/components/Modals/UserSelectionModal";

export const useUpdatedByFilter = ({
    updatedByHandler,
    calendarMembers,
    view,
}: {
    updatedByHandler: (
        param?: IUser | CalendarUserSummary | IAgent,
    ) => Promise<void>;
    calendarMembers?: CalendarUserSummary[];
    view: "Kanban" | "Calendar";
}) => {
    const currentProject = useRecoilValue(currentProjectAtom);
    const calendarTaskFilters = useRecoilValue(calendarTaskFiltersAtom);
    const { data: membersAndOwner } = useGetAllMembersForAssign(
        ["updated-by-filter", currentProject?.id ?? -1],
        currentProject?.id!
    );
    const { allAgents } = useAgents();
    const [allUsers, setAllUsers] = useState<UserSelectionEntry[]>([]);
    const activeFilters = getActiveFiltersFromProject(
        currentProject
    ).addedFilters.find((x) => x.type === "UpdatedBy");

    const userSource = useMemo(() => {
        const uniqueUsersMap = new Map<number, IUser | CalendarUserSummary>();
        const uniqueAgentsMap = new Map<string, IAgent>();

        if (view === "Calendar" && calendarMembers?.length) {
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

        for (const agent of allAgents ?? []) {
            if (agent && !agent.revokedAt && !uniqueAgentsMap.has(agent.id)) {
                uniqueAgentsMap.set(agent.id, agent);
            }
        }

        return [
            ...Array.from(uniqueUsersMap.values()),
            ...Array.from(uniqueAgentsMap.values()),
        ];
    }, [view, calendarMembers, membersAndOwner, allAgents]);


    const activeFiltersFlatMap = useMemo(() => {
        if (view === "Calendar") {
            return [
                ...calendarTaskFilters.updatedBy,
                ...calendarTaskFilters.updatedByAgents,
            ];
        }
        return activeFilters?.searchPayload.flatMap((x: { id: number | string }) => x.id) ?? [];
    }, [view, calendarTaskFilters.updatedBy, calendarTaskFilters.updatedByAgents, activeFilters]);

    useEffect(() => {
        setAllUsers(userSource);
    }, [userSource]);

    const onSelectHandler = (
        selectedUsers?: UserSelectionEntry | UserSelectionEntry[],
    ) => {
        if (Array.isArray(selectedUsers) && selectedUsers.length > 0) {
            updatedByHandler(selectedUsers[0]);
        } else if (selectedUsers && !Array.isArray(selectedUsers)) {
            updatedByHandler(selectedUsers);
        } else {
            updatedByHandler(undefined);
        }
    };
    return {
        onSelectHandler,
        allUsers,
        activeFiltersFlatMap,
    };
};
