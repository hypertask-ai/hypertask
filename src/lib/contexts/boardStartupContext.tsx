"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

type BoardStartupContextValue = {
  releaseSecondaryStartup: () => void;
  markBoardUsable: () => void;
  secondaryStartupEnabled: boolean;
};

const defaultValue: BoardStartupContextValue = {
  releaseSecondaryStartup: () => undefined,
  markBoardUsable: () => undefined,
  secondaryStartupEnabled: true,
};

export const BoardStartupContext =
  createContext<BoardStartupContextValue>(defaultValue);

export function BoardStartupProvider({
  value: { releaseSecondaryStartup, markBoardUsable, secondaryStartupEnabled },
  children,
}: {
  value: BoardStartupContextValue;
  children: ReactNode;
}) {
  // HTPR-6853: unrelated shell renders must not broadcast a new startup value.
  const value = useMemo(
    () => ({ releaseSecondaryStartup, markBoardUsable, secondaryStartupEnabled }),
    [releaseSecondaryStartup, markBoardUsable, secondaryStartupEnabled],
  );

  return (
    <BoardStartupContext.Provider value={value}>
      {children}
    </BoardStartupContext.Provider>
  );
}

export const useBoardStartup = () => useContext(BoardStartupContext);
