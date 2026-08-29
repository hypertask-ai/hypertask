import type { IProject } from "@/models/model";

import { isGuestCookieUser } from "./isGuestClient";
import { GUEST_SEED_TASK_TITLES } from "./guestSeedTasks";

/** One-time flag: the guest onboarding spotlight has fired in this browser. */
export const GUEST_SPOTLIGHT_SEEN_KEY = "ht_guest_chat_spotlight_seen";

/** One-time flag: the guest has been shown the AI task writer. */
export const GUEST_WRITER_SEEN_KEY = "ht_guest_task_writer_seen";

/**
 * The guest's first create-task modal opens with the AI task writer already
 * active and a demo prompt typed in (HTPR-4937 rework: no auto-opened modal,
 * the guest opens it themselves and meets the writer inside).
 */
export function shouldShowGuestWriterIntro(): boolean {
  if (typeof window === "undefined") return false;
  if (window.innerWidth < MOBILE_VIEWPORT_MAX_PX) return false;
  if (!isGuestCookieUser()) return false;
  try {
    return window.localStorage.getItem(GUEST_WRITER_SEEN_KEY) !== "true";
  } catch {
    // Storage blocked: skip rather than replay the intro on every opening.
    return false;
  }
}

/**
 * Prompt the writer opens with for a guest, so the demo shows a real request
 * rather than an empty box. It is typed in, not sent: the guest presses send
 * themselves, which is the loop they need to feel (and keeps the demo AI key
 * off the hook for a request nobody asked for).
 */
export const GUEST_DEMO_TASK_PROMPT =
  "Draft a task to prepare the kickoff meeting: agenda, invites and a summary doc. High priority, due Friday.";

const MOBILE_VIEWPORT_MAX_PX = 768;

/**
 * A desktop guest sitting on their freshly provisioned, still-empty board.
 * While this is true the AI chat builds the board instead of chatting about
 * nothing (HTPR-4882). `tasks` is only an array once the board payload has
 * hydrated, so an unhydrated board reads as "not empty" and leaves chat alone.
 */
export function isGuestBoardBuild(project: IProject | null): boolean {
  if (typeof window === "undefined") return false;
  if (window.innerWidth < MOBILE_VIEWPORT_MAX_PX) return false;
  const tasks = project?.tasks;
  if (!Array.isArray(tasks)) return false;
  // The skeleton board ships with four selling-point seeds; a board holding
  // only those is still "empty" as far as the build offer goes.
  if (tasks.some((task) => !GUEST_SEED_TASK_TITLES.includes(task.title)))
    return false;
  return isGuestCookieUser();
}

/**
 * Regenerate the guest's single demo board from a one-line purpose. Shared by
 * the chat welcome screen and the Ctrl+K board assistant so both stay on the
 * same endpoint contract.
 */
export async function generateGuestBoard(purpose: string): Promise<string> {
  const response = await fetch("/api/demo/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ purpose }),
  });
  const data = (await response.json()) as { boardUrl?: string; error?: string };
  if (!response.ok || !data.boardUrl) {
    throw new Error(data.error || "Could not create your board");
  }
  return data.boardUrl;
}
