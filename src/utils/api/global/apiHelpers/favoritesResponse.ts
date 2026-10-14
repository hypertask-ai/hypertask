import type { IFavorites } from "@/models/model";

export const selectFavorites = (data: unknown): IFavorites[] =>
  Array.isArray(data) ? (data as IFavorites[]) : [];
