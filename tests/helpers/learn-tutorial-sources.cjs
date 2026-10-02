const fs = require("node:fs");
const path = require("node:path");

module.exports = [
  "learnTutorialDom.ts",
  "learnTutorialRuntime.ts",
  "learnTutorialPersistence.ts",
  "learnTutorialActions.ts",
  "learnTutorialSteps.ts",
  "learnTutorialKeyboardHandlers.ts",
  "learnTutorialKeyboard.ts",
  "learnTutorialObservers.ts",
  "useLearnTutorial.ts",
].map((file) => fs.readFileSync(
  path.join(__dirname, "../../src/hooks/General", file),
  "utf8",
)).join("\n");
