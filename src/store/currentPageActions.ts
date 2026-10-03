import { atom } from "@/lib/state";

export const currentPageActionsAtom = atom<{
  publicId: string;
  version: number;
  onDelete: () => Promise<void>;
} | null>({
  key: "currentPageActionsAtom",
  default: null,
});
