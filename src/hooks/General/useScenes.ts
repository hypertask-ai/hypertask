import { tutorialUsers } from "@/lib/constants/InteractiveOnboarding/constants";
import { ITutorialScene } from "@/models/InteractiveOnboarding/model";

import { useMemo } from "react";

interface IScene {
  sceneState: { [x: string]: any };
  isApple: boolean;
}

export const useScene = ({ sceneState, isApple }: IScene) => {
  const scenes: { [key in string]: ITutorialScene } = useMemo(
    () => ({
      0: {
        title: "Welcome to the Practice Board 👋",
        subtitle: [
          {
            type: "text",
            content:
              "Here you will learn the basics of operating Hypertask using keyboard only.",
          },
        ],
        hint: [
          {
            type: "text",
            content: "Hit",
          },
          {
            type: "key",
            content: "Enter",
            active: sceneState.scene0,
            index: 0,
          },
          {
            type: "text",
            content: "to continue.",
          },
        ],
      },
      1: {
        title: "Keyboard shortcuts are the fastest way to use Hypertask 🔥",
        subtitle: [
          {
            type: "text",
            content:
              "After the tutorial you can always just switch to using mouse, but we recommend learning keyboard shortcuts to go twice as fast.",
          },
        ],
        hint: [
          {
            type: "text",
            content: "Hit",
          },
          {
            type: "key",
            content: "Enter",
            active: sceneState.scene1,
            index: 0,
          },
          {
            type: "text",
            content: "to continue.",
          },
        ],
      },
      2: {
        title: "This is how you navigate the board ⌨️",
        subtitle: [
          {
            type: "text",
            content: "Use",
          },
          {
            type: "key",
            content: "J",
          },
          {
            type: "text",
            content: "and",
          },
          {
            type: "key",
            content: "K",
          },
          {
            type: "text",
            content: "to move focus up and down a column.",
          },
        ],
        hint: [
          {
            type: "key",
            content: "J",
            active: sceneState.scene2.jCount >= 1,
            index: 0,
          },
          {
            type: "key",
            content: "J",
            active: sceneState.scene2.jCount >= 2,
            index: 1,
          },
          {
            type: "key",
            content: "J",
            active: sceneState.scene2.jCount === 3,
            index: 2,
          },
          {
            type: "text",
            content: "then",
          },
          {
            type: "key",
            content: "K",
            active: sceneState.scene2.kCount >= 1,
            index: 3,
          },
          {
            type: "key",
            content: "K",
            active: sceneState.scene2.kCount === 2,
            index: 4,
          },
        ],
      },
      3: {
        title: "Now cycle between columns",
        subtitle: [
          {
            type: "text",
            content: "Use",
          },
          {
            type: "key",
            content: "Tab",
          },
          {
            type: "text",
            content: "and",
          },
          {
            type: "key",
            content: "SHIFT",
          },
          {
            type: "text",
            content: "+",
          },
          {
            type: "key",
            content: "Tab",
          },
          {
            type: "text",
            content: "to move between columns",
          },
        ],
        hint: [
          {
            type: "key",
            content: "TAB",
            active: sceneState.scene3.tabCount >= 1,
            index: 0,
          },
          {
            type: "key",
            content: "TAB",
            active: sceneState.scene3.tabCount >= 2,
            index: 1,
          },
          {
            type: "text",
            content: "then",
          },
          {
            type: "key",
            content: "SHIFT",
            active: sceneState.scene3.shiftPressed,
            index: 2,
          },
          {
            type: "text",
            content: "+",
          },
          {
            type: "key",
            content: "TAB",
            active: sceneState.scene3.tabCount === 3,
            index: 3,
          },
        ],
      },
      4: {
        title: "Great! Let's open up a task ✅",
        subtitle: [
          {
            type: "text",
            content: "Just hit",
          },
          {
            type: "key",
            content: "Enter",
          },
        ],
        hint: [
          {
            type: "key",
            content: "ENTER",
            active: sceneState.scene4,
            index: 0,
          },
        ],
      },
      5: {
        title: "Let's comment on this task 💬",
        subtitle: [
          {
            type: "text",
            content: "Press",
          },
          {
            type: "key",
            content: "Ctrl",
          },
          {
            type: "text",
            content: "+",
          },
          {
            type: "key",
            content: "M",
          },
        ],
        hint: [
          {
            type: "key",
            content: "CTRL",
            active: sceneState.scene5.ctrlPressed,
            index: 0,
          },
          {
            type: "text",
            content: "+",
          },
          {
            type: "key",
            content: "M",
            active: sceneState.scene5.mPressed,
            index: 1,
          },
        ],
      },
      6: {
        title: "Type your comment and send it off 📨",
        subtitle: [
          {
            type: "text",
            content: "To save a comment, press",
          },
          {
            type: "key",
            content: isApple ? "Cmd" : "Ctrl",
          },
          {
            type: "text",
            content: "+",
          },
          {
            type: "key",
            content: "Enter",
          },
        ],
        hint: [
          {
            type: "key",
            content: isApple ? "CMD" : "CTRL",
            active: sceneState.scene6.ctrlPressed,
            index: 0,
          },
          {
            type: "text",
            content: "+",
          },
          {
            type: "key",
            content: "ENTER",
            active: sceneState.scene6.enterPressed,
            index: 1,
          },
        ],
      },
      7: {
        title: "Let's assign someone to this task 🙆‍♀️",
        subtitle: [
          {
            type: "text",
            content: "Press",
          },
          {
            type: "key",
            content: "A",
          },
          {
            type: "text",
            content: "to open up the 'Assignees' function.",
          },
        ],
        hint: [
          {
            type: "key",
            content: "A",
            active: sceneState.scene7,
            index: 0,
          },
        ],
      },
      8: {
        title: `Now let's assign user ${tutorialUsers[1].name} to this task 🙋`,
        subtitle: [
          {
            type: "text",
            content: "Just hit",
          },
          {
            type: "key",
            content: "Enter",
          },
        ],
        hint: [
          {
            type: "key",
            content: "ENTER",
            active: sceneState.scene8,
            index: 0,
          },
        ],
      },
      9: {
        title: "We need to set a priority for this task ⬆️",
        subtitle: [
          {
            type: "text",
            content: "Press",
          },
          {
            type: "key",
            content: "P",
          },
          {
            type: "text",
            content: "to open up the 'Priority' function.",
          },
        ],
        hint: [
          {
            type: "key",
            content: "P",
            active: sceneState.scene9,
            index: 0,
          },
        ],
      },
      10: {
        title: "Let's set the priority to 'Urgent'!",
        subtitle: [
          {
            type: "text",
            content: "Use the",
          },
          {
            type: "key",
            content: "Up Arrow",
          },
          {
            type: "text",
            content: "and",
          },
          {
            type: "key",
            content: "Down Arrow",
          },
          {
            type: "text",
            content: "to select 'Urgent', and then hit",
          },
          {
            type: "key",
            content: "Enter",
          },
        ],
        hint: [
          {
            type: "key",
            content: "ENTER",
            active: sceneState.scene10,
            index: 0,
          },
        ],
      },
      11: {
        title: "Amazing! ESC will always take you one step back 🔙",
        subtitle: [
          {
            type: "text",
            content: "Let's go back to the board. Press",
          },
          {
            type: "key",
            content: "Esc",
          },
        ],
        hint: [
          {
            type: "key",
            content: "ESC",
            active: sceneState.scene11,
            index: 0,
          },
        ],
      },
      12: {
        title: "Let's check our notifications in inbox 📥",
        subtitle: [
          {
            type: "text",
            content: "Press",
          },
          {
            type: "key",
            content: "G",
          },
          {
            type: "text",
            content: "then",
          },
          {
            type: "key",
            content: "I",
          },
          {
            type: "text",
            content: "to open up the inbox.",
          },
        ],
        hint: [
          {
            type: "key",
            content: "G",
            active: sceneState.scene12.gPressed,
            index: 0,
          },
          {
            type: "text",
            content: "then",
          },
          {
            type: "key",
            content: "I",
            active: sceneState.scene12.iPressed,
            index: 1,
          },
        ],
      },
      13: {
        title: "Navigating and archiving notifications.",
        subtitle: [
          {
            type: "text",
            content: "Use",
          },
          {
            type: "key",
            content: "J",
          },
          {
            type: "text",
            content: "and",
          },
          {
            type: "key",
            content: "K",
          },
          {
            type: "text",
            content: "to move focus up and down notifications, and",
          },
          {
            type: "key",
            content: "E",
          },
          {
            type: "text",
            content: "to archive a notification.",
          },
        ],
        hint: [
          {
            type: "key",
            content: "J",
            active: sceneState.scene13.jCount >= 1,
            index: 0,
          },
          {
            type: "key",
            content: "J",
            active: sceneState.scene13.jCount === 2,
            index: 1,
          },
          {
            type: "key",
            content: "K",
            active: sceneState.scene13.kCount >= 1,
            index: 2,
          },
          {
            type: "key",
            content: "K",
            active: sceneState.scene13.kCount === 2,
            index: 3,
          },
          {
            type: "text",
            content: "then",
          },
          {
            type: "key",
            content: "E",
            active: sceneState.scene13.eCount >= 1,
            index: 4,
          },
          {
            type: "key",
            content: "E",
            active: sceneState.scene13.eCount === 2,
            index: 5,
          },
        ],
      },
      14: {
        title: "Great only 2 notifications are left. Let's check them 👀",
        subtitle: [
          {
            type: "text",
            content: "Hit",
          },
          {
            type: "key",
            content: "Enter",
          },
          {
            type: "text",
            content: "to open up the notification.",
          },
        ],
        hint: [
          {
            type: "key",
            content: "ENTER",
            active: sceneState.scene14,
            index: 0,
          },
        ],
      },
      15: {
        title: "Let's archive the notification from the inbox 🚮",
        subtitle: [
          {
            type: "text",
            content: "Press",
          },
          {
            type: "key",
            content: "E",
          },
          {
            type: "text",
            content: "to archive it directly from the task page.",
          },
        ],
        hint: [
          {
            type: "key",
            content: "E",
            active: sceneState.scene15,
            index: 0,
          },
        ],
      },
      16: {
        title: "You can also set reminders for inbox elements!",
        subtitle: [
          {
            type: "text",
            content: "Press",
          },
          {
            type: "key",
            content: "H",
          },
          {
            type: "text",
            content: "to open the 'Remind me' function.",
          },
        ],
        hint: [
          {
            type: "key",
            content: "H",
            active: sceneState.scene16,
            index: 0,
          },
        ],
      },
      17: {
        title: "Type in 'tomorrow' to set a new reminder!",
        subtitle: [
          {
            type: "text",
            content: "When done, just hit",
          },
          {
            type: "key",
            content: "ENTER",
          },
        ],
        hint: [
          {
            type: "key",
            content: "ENTER",
            active: sceneState.scene17,
            index: 0,
          },
        ],
      },
      18: {
        title: "Amazing! You now have 0 notifications 🚀",
        subtitle: [
          {
            type: "text",
            content: "Let's go back to the board by pressing",
          },
          {
            type: "key",
            content: "Esc",
          },
        ],
        hint: [
          {
            type: "key",
            content: "ESC",
            active: sceneState.scene18,
            index: 0,
          },
        ],
      },
      19: {
        title: "Let's switch to another board 📚",
        subtitle: [
          {
            type: "text",
            content: "Press",
          },
          {
            type: "key",
            content: isApple ? "Cmd" : "Ctrl",
          },
          {
            type: "text",
            content: "+",
          },
          {
            type: "key",
            content: "B",
          },
          {
            type: "text",
            content: "to switch to another board.",
          },
        ],
        hint: [
          {
            type: "key",
            content: isApple ? "CMD" : "CTRL",
            active: sceneState.scene19.cmdCtrlPressed,
            index: 0,
          },
          {
            type: "text",
            content: "+",
          },
          {
            type: "key",
            content: "B",
            active: sceneState.scene19.bPressed,
            index: 1,
          },
        ],
      },
      20: {
        title: "Let's use the search field to change the board.",
        subtitle: [
          {
            type: "text",
            content: "Type 'Product Backlog' and then hit",
          },
          {
            type: "key",
            content: "Enter",
          },
        ],
        hint: [
          {
            type: "key",
            content: "Enter",
            active: sceneState.scene20,
            index: 0,
          },
        ],
      },
      21: {
        title: "Great! Now let's access the Command Center 👑",
        subtitle: [
          {
            type: "text",
            content:
              "This opens up the Hypertask Command Center which holds all the commands accessible via natural language.",
          },
        ],
        hint: [
          {
            type: "key",
            content: isApple ? "CMD" : "CTRL",
            active: sceneState.scene21.cmdCtrlPressed,
            index: 0,
          },
          {
            type: "text",
            content: "+",
          },
          {
            type: "key",
            content: "K",
            active: sceneState.scene21.kPressed,
            index: 1,
          },
        ],
      },
      22: {
        title: "We need to add a new column. Type 'Add board column' ➕",
        subtitle: [
          {
            type: "text",
            content: "This will open up the 'Add board column' function. Hit",
          },
          {
            type: "key",
            content: "Enter",
          },
          {
            type: "text",
            content: "when you are done.",
          },
        ],
        hint: [
          {
            type: "key",
            content: "ENTER",
            active: sceneState.scene22,
            index: 0,
          },
        ],
      },
      23: {
        title: "Let's name the column 'Done' ☑️",
        subtitle: [
          {
            type: "text",
            content: "After typing 'Done' hit",
          },
          {
            type: "key",
            content: "Enter",
          },
        ],
        hint: [
          {
            type: "key",
            content: "ENTER",
            active: sceneState.scene23,
            index: 0,
          },
        ],
      },
      24: {
        title: "Now let's move a task to 'Done' column 👉",
        subtitle: [
          {
            type: "text",
            content: "Press",
          },
          {
            type: "key",
            content: "M",
          },
          {
            type: "text",
            content: "to open up 'Move task' function.",
          },
        ],
        hint: [
          {
            type: "key",
            content: "M",
            active: sceneState.scene24,
            index: 0,
          },
        ],
      },
      25: {
        title: "Type 'Done' in the input field!",
        subtitle: [
          {
            type: "text",
            content: "Hit",
          },
          {
            type: "key",
            content: "Enter",
          },
          {
            type: "text",
            content: "when you finished typing.",
          },
        ],
        hint: [
          {
            type: "key",
            content: "ENTER",
            active: sceneState.scene25,
            index: 0,
          },
        ],
      },
      26: {
        title: "You can move tasks with your keyboard too.",
        subtitle: [
          {
            type: "text",
            content: "You can use",
          },
          {
            type: "key",
            content: "Shift+H/L",
          },
          {
            type: "text",
            content: "to move task left and right.",
          },
        ],
        hint: [
          {
            type: "key",
            content: "SHIFT",
            active: sceneState.scene26.shiftPressed,
            index: 0,
          },
          {
            type: "text",
            content: "+",
          },
          {
            type: "key",
            content: "L",
            active: sceneState.scene26.lPressed,
            index: 1,
          },
        ],
      },
      27: {
        title: "You can also move tasks within the same column.",
        subtitle: [
          {
            type: "text",
            content: "Use",
          },
          {
            type: "key",
            content: "Shift+J",
          },
          {
            type: "text",
            content: "and",
          },
          {
            type: "key",
            content: "Shift+K",
          },
          {
            type: "text",
            content: "to move tasks up and down.",
          },
        ],
        hint: [
          {
            type: "key",
            content: "SHIFT",
            active: sceneState.scene27.shiftPressed,
            index: 0,
          },
          {
            type: "text",
            content: "+",
          },
          {
            type: "key",
            content: "J",
            active: sceneState.scene27.jPressed,
            index: 1,
          },
          // {
          //   type: "text",
          //   content: ",",
          // },
          // {
          //   type: "key",
          //   content: "SHIFT",
          //   active: sceneState.scene27.shiftPressed,
          //   index: 0,
          // },
          // {
          //   type: "text",
          //   content: "+",
          // },
          // {
          //   type: "key",
          //   content: "J",
          //   active: sceneState.scene27.jPressed,
          //   index: 1,
          // },
          // {
          //   type: "text",
          //   content: ", then",
          // },
          // {
          //   type: "key",
          //   content: "SHIFT",
          //   active: sceneState.scene27.shiftPressed,
          //   index: 0,
          // },
          // {
          //   type: "text",
          //   content: "+",
          // },
          // {
          //   type: "key",
          //   content: "K",
          //   active: sceneState.scene27.jPressed,
          //   index: 1,
          // },
        ],
      },
      28: {
        title: "Excellent! Let's up open the focused task ✅",
        subtitle: [
          {
            type: "text",
            content: "Just hit",
          },
          {
            type: "key",
            content: "Enter",
          },
        ],
        hint: [
          {
            type: "key",
            content: "ENTER",
            active: sceneState.scene28,
            index: 0,
          },
        ],
      },
      29: {
        title: "Let's write a description using Hypertask' AI Task Writer 💬",
        subtitle: [
          {
            type: "text",
            content: "Press",
          },
          {
            type: "key",
            content: "Ctrl",
          },
          {
            type: "text",
            content: "+",
          },
          {
            type: "key",
            content: "D",
          },
          {
            type: "text",
            content: "to focus on task description.",
          },
        ],
        hint: [
          {
            type: "key",
            content: "CTRL",
            active: sceneState.scene29.ctrlPressed,
            index: 0,
          },
          {
            type: "text",
            content: "+",
          },
          {
            type: "key",
            content: "D",
            active: sceneState.scene29.dPressed,
            index: 1,
          },
        ],
      },
      30: {
        title: "Now let's open up the AI Task Writer!",
        subtitle: [
          {
            type: "text",
            content: "Press",
          },
          {
            type: "key",
            content: isApple ? "Cmd" : "Ctrl",
          },
          {
            type: "text",
            content: "+",
          },
          {
            type: "key",
            content: "J",
          },
        ],
        hint: [
          {
            type: "key",
            content: isApple ? "CMD" : "CTRL",
            active: sceneState.scene30.ctrlPressed,
            index: 0,
          },
          {
            type: "text",
            content: "+",
          },
          {
            type: "key",
            content: "J",
            active: sceneState.scene30.jPressed,
            index: 1,
          },
        ],
      },
      31: {
        title: "Write a prompt in the AI Task Writer.",
        subtitle: [
          {
            type: "text",
            content: "Hit",
          },
          {
            type: "key",
            content: "Enter",
          },
          {
            type: "text",
            content:
              "to get a response from our AI models. Once you get a response hit",
          },
          {
            type: "key",
            content: "Accept",
          },
          {
            type: "text",
            content: "or",
          },
          {
            type: "key",
            content: "Accept description and task title.",
          },
        ],
        hint: [],
      },
      32: {
        title: "Alright you're almost there ⭐️",
        subtitle: [
          {
            type: "text",
            content: "Press",
          },
          {
            type: "key",
            content: "Esc",
          },
          {
            type: "text",
            content: "to continue.",
          },
        ],
        hint: [
          {
            type: "key",
            content: "ESC",
            active: sceneState.scene32,
            index: 0,
          },
        ],
      },
      33: {
        title: "",
        subtitle: [],
        hint: [],
      },
    }),
    [sceneState, isApple]
  );

  return { scenes };
};
