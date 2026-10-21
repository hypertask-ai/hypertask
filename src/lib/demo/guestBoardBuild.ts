import type { IProject } from "@/models/model";

import { isGuestCookieUser } from "./isGuestClient";
import { GUEST_SEED_TASK_TITLES } from "./guestSeedTasks";

export const GUEST_SPOTLIGHT_SEEN_KEY = "ht_guest_chat_spotlight_seen";

export const GUEST_WRITER_SEEN_KEY = "ht_guest_task_writer_seen";

export function shouldShowGuestWriterIntro(): boolean {
  if (typeof window === "undefined") return false;
  if (window.innerWidth < MOBILE_VIEWPORT_MAX_PX) return false;
  if (!isGuestCookieUser()) return false;
  try {
    return window.localStorage.getItem(GUEST_WRITER_SEEN_KEY) !== "true";
  } catch {
    return false;
  }
}

export const GUEST_DEMO_TASK_PROMPT =
  "Draft a task to prepare the kickoff meeting: agenda, invites and a summary doc. High priority, due Friday.";

const MOBILE_VIEWPORT_MAX_PX = 768;

export function isGuestBoardBuild(project: IProject | null): boolean {
  if (typeof window === "undefined") return false;
  if (window.innerWidth < MOBILE_VIEWPORT_MAX_PX) return false;
  const tasks = project?.tasks;
  if (!Array.isArray(tasks)) return false;
  if (tasks.some((task) => !GUEST_SEED_TASK_TITLES.includes(task.title)))
    return false;
  return isGuestCookieUser();
}

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
