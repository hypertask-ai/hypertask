import type { LearnTutorialState } from "@/lib/tutorial/learnTutorialState";

export const learnTutorialReleasedHints = {
  arrowleft: "h",
  arrowdown: "j",
  arrowup: "k",
  arrowright: "l",
} as Record<string, string>;

export const getLearnTutorialBoardMove = (tutorialState: LearnTutorialState) => {
  const expectedBoardMove =
    tutorialState.scene === "moveAcross"
      ? tutorialState.verifiedBoardMoves.includes("right")
        ? {
          direction: "left" as const,
          keys: ["h", "arrowleft"],
          pressed: "h",
        }
        : {
          direction: "right" as const,
          keys: ["l", "arrowright"],
          pressed: "l",
        }
      : tutorialState.scene === "reorder"
        ? tutorialState.verifiedBoardMoves.includes("down")
          ? {
            direction: "up" as const,
            keys: ["k", "arrowup"],
            pressed: "k",
          }
          : {
            direction: "down" as const,
            keys: ["j", "arrowdown"],
            pressed: "j",
          }
        : null;

  return expectedBoardMove;
};
