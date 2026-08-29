import { useGetAllFavorites } from "@/hooks/MultiPages/useGetAllFavorites";
import { deriveCurrentBoardBilling } from "@/lib/deriveCurrentBoardBilling";
import { IFavorites } from "@/models/model";
import {
  currentBoardBillingAtom,
  currentProjectAtom,
  currentUserAtom,
} from "@/store";
import { useSearchParams } from "next/navigation";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useRecoilState, useSetRecoilState } from "@/lib/state";

const useGlobalProvider = (secondaryStartupEnabled = true) => {
  const [_currentProject] = useRecoilState(currentProjectAtom);
  const setCurrentBoardBilling = useSetRecoilState(currentBoardBillingAtom);
  const [currentProjectIndex, setCurrentProjectIndex] = useState<number>();
  const [currentUser, ___] = useRecoilState(currentUserAtom);
  const { data: favoritesTQ } = useGetAllFavorites(
    currentUser?.UserSettingId ?? null,
    undefined,
    { enabled: secondaryStartupEnabled },
  );
  const [favorites, setFavorites] = useState<IFavorites[]>([]);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (favorites && pathname?.startsWith("/project")) {
      const currId = searchParams?.get("id");
      const currIndex = favorites.findIndex(
        (project: { id: { toString: () => string } }) =>
          project.id.toString() === currId?.toString()
      );
      setCurrentProjectIndex(currIndex);
    }
  }, [favorites, pathname, searchParams]);

  // ------- on favorites update
  useEffect(() => {
    setFavorites(favoritesTQ);
  }, [favoritesTQ]);

  useEffect(() => {
    setCurrentBoardBilling(deriveCurrentBoardBilling(_currentProject));
  }, [_currentProject, setCurrentBoardBilling]);

  return {
    setCurrentProjectIndex,
    currentProjectIndex,
    favorites,
    currentUser,
    _currentProject,
  };
};

export default useGlobalProvider;
