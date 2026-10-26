import { CommandMode } from "@/models/enums";
import type { CommandGroup } from "@/components/Modals/commands/HTC/HTCTypes";

export function pageCommandGroups(pathname: string | null): CommandGroup[] {
  const commandLists = [
    { key: "gotoPages", name: "Go to Pages", commandMode: CommandMode.Command },
    { key: "newPage", name: "New page", commandMode: CommandMode.Command },
  ];
  if (pathname?.startsWith("/detail/")) commandLists.push({ key: "linkPage", name: "Link page", commandMode: CommandMode.Command });
  if (pathname?.startsWith("/page/")) commandLists.push({ key: "linkPageTicket", name: "Link ticket", commandMode: CommandMode.Command });
  return [{ group: "Pages", commandLists }];
}

export function pageCreationTarget({ pathname, projectId }: { pathname: string | null; projectId?: number }):
  | { kind: "current-surface" }
  | { kind: "navigate"; href: string } {
  if (pathname === "/pages" || pathname?.startsWith("/detail/")) return { kind: "current-surface" };
  if (pathname?.startsWith("/project") && projectId) return { kind: "navigate", href: `/pages?project_id=${projectId}&new=1` };
  return { kind: "navigate", href: "/pages?new=1" };
}
