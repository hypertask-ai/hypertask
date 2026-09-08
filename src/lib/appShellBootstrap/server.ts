import getAllMinimal from "@/utils/controllers/projects/getAllMinimal";
import getAllTeamsSidebarOptimized from "@/utils/controllers/teams/getAllSidebarOptimized";
import getUserById from "@/utils/controllers/users/getById";
import { fetchUserPreferenceController } from "@/utils/controllers/users/fetch_preferences";
import { getFavoritesForUser } from "@/utils/controllers/favorites/getAll";
import { getHyperUser } from "@/utils/controllers/users/getHyper";
import { getUserAnnouncements } from "@/utils/controllers/users/getAnnouncements";
import type {
  AppShellBootstrapPayload,
  AppShellBootstrapSlice,
} from "./types";

const SLICE_TIMEOUT_MS = 800;

const failedSlice = <T,>(): AppShellBootstrapSlice<T> => ({ ok: false });

const resolveSlice = async <T>(
  load: () => Promise<T | null | undefined>,
): Promise<AppShellBootstrapSlice<T>> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const data = await Promise.race([
      load(),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), SLICE_TIMEOUT_MS);
      }),
    ]);
    if (data === null || data === undefined) return failedSlice();
    return { ok: true, data, fetchedAt: Date.now() };
  } catch {
    return failedSlice();
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const getAppShellBootstrap = async (
  accountId: number,
): Promise<AppShellBootstrapPayload> => {
  const [
    user,
    preferences,
    favorites,
    projects,
    hyperAi,
    announcements,
    teams,
  ] = await Promise.all([
    resolveSlice(async () => {
      const result = await getUserById(accountId);
      return result.status === 200 ? result.res : undefined;
    }),
    resolveSlice(async () => {
      const result = await fetchUserPreferenceController(accountId);
      return result.status === 200 ? result.res : undefined;
    }),
    resolveSlice(() => getFavoritesForUser(accountId)),
    resolveSlice(async () => {
      const result = await getAllMinimal(accountId, "ExtraMinimal");
      return result.status === 200 ? result.json : undefined;
    }),
    resolveSlice(() => getHyperUser()),
    resolveSlice(() => getUserAnnouncements(accountId)),
    resolveSlice(async () => {
      const result = await getAllTeamsSidebarOptimized(accountId);
      return result.status === 200 ? result.json : undefined;
    }),
  ]);

  return {
    accountId,
    slices: {
      user,
      preferences,
      favorites,
      projects,
      hyperAi,
      announcements,
      teams,
      buildId: {
        ok: true,
        data: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev",
        fetchedAt: Date.now(),
      },
    },
  };
};
