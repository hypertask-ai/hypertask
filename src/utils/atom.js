import { atom } from "@/lib/state";

export const KeyPressed = atom({
  key: "keyPressed",
  default: false,
});

export const Tasks = atom({
  key: "todos",
  default: null
})