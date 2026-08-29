"use client";

import { createContext, useContext } from "react";

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

export const useBoardStartup = () => useContext(BoardStartupContext);
