export type AppShellBootstrapSlice<T = unknown> =
  | { ok: true; data: T; fetchedAt: number }
  | { ok: false };

export type AppShellBootstrapSliceKey =
  | "user"
  | "preferences"
  | "favorites"
  | "projects"
  | "hyperAi"
  | "announcements"
  | "teams"
  | "buildId";

export type AppShellBootstrapPayload = {
  accountId: number;
  slices: Record<AppShellBootstrapSliceKey, AppShellBootstrapSlice>;
};
