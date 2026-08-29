import { useGetAllMembersForAssign } from "@/hooks/MultiPages/useGetMembersForAssignees";
import { IUser } from "@/models/model";
import { currentProjectAtom } from "@/store";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRecoilValue } from "@/lib/state";
import { getActiveFiltersFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { KeyCodes } from "@/lib/constants/keyboard-handler";

export type BlockedByPersonOption = Pick<
  IUser,
  "id" | "displayName" | "photoURL"
>;

interface IProps {
  closeHandler: (user?: BlockedByPersonOption) => Promise<void>;
}

export const useBlockedByPersonFilter = ({ closeHandler }: IProps) => {
  const [keyword, setKeyword] = useState("");
  const currentProject = useRecoilValue(currentProjectAtom);
  const { data: membersAndOwner } = useGetAllMembersForAssign(
    ["blocked-by-person-filter", currentProject?.id],
    currentProject?.id!
  );
  const [filteredPeople, setFilteredPeople] = useState<
    BlockedByPersonOption[]
  >([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const activeFilter = getActiveFiltersFromProject(
    currentProject
  ).addedFilters.find((filter) => filter.type === "BlockedByPerson");

  const activeFilters =
    (activeFilter?.searchPayload as BlockedByPersonOption[] | undefined) ?? [];

  const people = useMemo<BlockedByPersonOption[]>(() => {
    const uniqueUsers = new Map<number, BlockedByPersonOption>();
    const owner = membersAndOwner?.owner as IUser | undefined;
    if (owner) {
      uniqueUsers.set(owner.id, {
        id: owner.id,
        displayName: owner.displayName,
        photoURL: owner.photoURL,
      });
    }
    for (const member of membersAndOwner?.members ?? []) {
      if (member.user) {
        uniqueUsers.set(member.user.id, {
          id: member.user.id,
          displayName: member.user.displayName,
          photoURL: member.user.photoURL,
        });
      }
    }
    return [{ id: 0, displayName: "Anyone" }, ...uniqueUsers.values()];
  }, [membersAndOwner]);

  const handleCommandSelect = (index: number) => {
    setSelectedIndex(index);
    document
      .getElementById(`blocked-by-person-filter-option-${index}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const filterData = (value: string) => {
    setFilteredPeople(
      people.filter((user) =>
        value
          ? user.displayName?.toLowerCase().includes(value.toLowerCase())
          : true
      )
    );
  };

  const onKeyChange = (event: any) => {
    setKeyword(event.target.value);
    filterData(event.target.value);
    handleCommandSelect(0);
  };

  const enterHandler = useCallback(
    (index: number) => closeHandler(filteredPeople[index]),
    [closeHandler, filteredPeople]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.keyCode === KeyCodes.ARROW_UP && selectedIndex > 0) {
        handleCommandSelect(selectedIndex - 1);
      }
      if (
        event.keyCode === KeyCodes.ARROW_DOWN &&
        selectedIndex < filteredPeople.length - 1
      ) {
        handleCommandSelect(selectedIndex + 1);
      }
      if (event.keyCode === KeyCodes.ENTER) {
        event.preventDefault();
        enterHandler(selectedIndex);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enterHandler, filteredPeople, selectedIndex]);

  useEffect(() => {
    setFilteredPeople(
      keyword
        ? people.filter((user) =>
            user.displayName?.toLowerCase().includes(keyword.toLowerCase())
          )
        : people
    );
  }, [keyword, people]);

  return {
    keyword,
    onKeyChange,
    selectedIndex,
    setSelectedIndex,
    filteredPeople,
    enterHandler,
    activeFilters,
  };
};
