import { useQuery } from "@tanstack/react-query";
import { IProject, IUser } from "@/models/model";
import { getAllProjects } from "@/utils/api/Homepage";

export const MOBILE_BOARD_SWITCHER_QUERY_KEY = (accountId: number) =>
  ["mobileBoardSwitcherProjects", accountId] as const;

/**
 * Fetches the authoritative accessible-board list without registering another
 * observer or query function on LandingPage's route-owned projectsAll cache.
 */
export const useGetAllAccessibleBoardList = (
  user: IUser | null | undefined,
  options?: { enabled?: boolean },
) =>
  useQuery<IProject[]>({
    queryKey: MOBILE_BOARD_SWITCHER_QUERY_KEY(user?.id ?? 0),
    queryFn: async ({ signal }) => {
      if (!user?.id) return [];
      const projects = await getAllProjects(user, null, { signal });
      return projects.updatedProjects;
    },
    enabled: (options?.enabled ?? true) && Boolean(user?.id),
    staleTime: 30_000,
    // Opening the sheet is an explicit authorization intent. Always refresh so
    // a previously accessible board cannot remain visible for the stale window.
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
