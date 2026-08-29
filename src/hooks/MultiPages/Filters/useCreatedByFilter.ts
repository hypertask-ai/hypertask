import { useMemo } from "react";
import { calendarTaskFiltersAtom, currentProjectAtom } from "@/store";
import { useGetAllMembersForAssign } from "@/hooks/MultiPages/useGetMembersForAssignees";
import { IAgent, IUser } from "@/models/model";
import { getActiveFiltersFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { useRecoilValue } from "@/lib/state";
import type { CalendarUserSummary } from "@/lib/calendarSync/contract";
import type { UserSelectionEntry } from "@/components/Modals/UserSelectionModal";

export const useCreatedByFilter = ({
    createdByHandler,
    calendarMembers,
    view,
}: {
    createdByHandler: (param?: IUser | CalendarUserSummary) => Promise<void>;
    calendarMembers?: CalendarUserSummary[];
    view: "Kanban" | "Calendar";
}) => {
    const currentProject = useRecoilValue(currentProjectAtom);
    const calendarTaskFilters = useRecoilValue(calendarTaskFiltersAtom);
    const { data: membersAndOwner } = useGetAllMembersForAssign(
        ["created-by-filter", currentProject?.id ?? -1],
        currentProject?.id!
    );
    const activeFilters = getActiveFiltersFromProject(
        currentProject
    ).addedFilters.find((x) => x.type === "CreatedBy");

    const allUsers = useMemo(() => {
        const uniqueUsersMap = new Map<number, IUser | CalendarUserSummary>();

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

        return Array.from(uniqueUsersMap.values());
    }, [view, calendarMembers, membersAndOwner]);

    const activeFiltersFlatMap = useMemo(() => {
        if (view === "Calendar") {
            return calendarTaskFilters.createdBy;
        }
        return activeFilters?.searchPayload.flatMap((x: { id: number }) => x.id) ?? [];
    }, [view, calendarTaskFilters.createdBy, activeFilters]);

    const onSelectHandler = (
        selectedUsers?: UserSelectionEntry | UserSelectionEntry[],
    ) => {
        const isHuman = (
            entry: UserSelectionEntry,
        ): entry is IUser | CalendarUserSummary => typeof entry.id === "number";
        if (Array.isArray(selectedUsers) && selectedUsers.length > 0 && isHuman(selectedUsers[0])) {
            createdByHandler(selectedUsers[0]);
        } else if (selectedUsers && !Array.isArray(selectedUsers) && isHuman(selectedUsers)) {
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
