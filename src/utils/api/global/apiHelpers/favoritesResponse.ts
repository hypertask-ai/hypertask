import type { IFavorites } from "@/models/model";

/** Favorites list from API/bootstrap must be an array; anything else is empty. */
export const selectFavorites = (data: unknown): IFavorites[] =>
  Array.isArray(data) ? (data as IFavorites[]) : [];
