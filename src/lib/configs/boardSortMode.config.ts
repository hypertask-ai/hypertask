export type BoardSortMode = "teams" | "lastUsed";

export const isBoardSortMode = (value: unknown): value is BoardSortMode =>
  value === "teams" || value === "lastUsed";
