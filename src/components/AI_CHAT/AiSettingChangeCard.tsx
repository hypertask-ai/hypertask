"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRecoilValue } from "@/lib/state";
import { currentProjectAtom, currentUserAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7622_AI_SETTINGS_FLAG } from "@/lib/flags/definitions/htpr-7622-ai-settings";
import { settingsScopeFromPath, type SettingProposalCard } from "@/lib/ai/settings/catalog";
import { actOnSettingProposalCard, fetchSettingProposal, settingValueLabel } from "@/lib/ai/settings/client";
import SettingsCard from "@/components/Modals/Settings/SettingsCard";
import { settingsActionButtonClass } from "@/components/Modals/Settings/SettingsBillingRow";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import { USER_PREFERENCES_QUERY_KEY } from "@/hooks/General/useGetUserPreferences";
import { cn } from "@/utils/undoActions/helperFuncs";

export function AiSettingChangeCard({ id }: { id: string }) {
  const enabled = useFlag(HTPR_7622_AI_SETTINGS_FLAG);
  const project = useRecoilValue(currentProjectAtom);
  const user = useRecoilValue(currentUserAtom);
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const processing = useRef(false);
  const [error, setError] = useState<string>();
  const queryKey = ["ai-setting-proposal", user?.id, id];
  const query = useQuery<SettingProposalCard>({
    queryKey,
    enabled: enabled && !!user?.id,
    queryFn: () => fetchSettingProposal(id),
    retry: false,
  });
  const proposal = query.data;

  const act = async (action: "apply" | "cancel" | "undo") => {
    if (processing.current) return;
    const scope = settingsScopeFromPath(pathname, project?.id);
    if (!scope && action !== "cancel") { setError("Open the original Settings page to review this change."); return; }
    processing.current = true;
    setBusy(true);
    setError(undefined);
    try {
      queryClient.setQueryData(queryKey, await actOnSettingProposalCard(id, action, scope));
      if (action !== "cancel") {
        await Promise.allSettled([
          queryClient.invalidateQueries({ queryKey: ["assign", project?.id] }),
          queryClient.invalidateQueries({ queryKey: ["projectsAll"] }),
          queryClient.invalidateQueries({ queryKey: USER_PREFERENCES_QUERY_KEY }),
        ]);
        window.dispatchEvent(new Event("hypertask:settings-changed"));
        router.refresh();
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not change setting");
    } finally {
      processing.current = false;
      setBusy(false);
    }
  };

  if (!enabled) return null;
  const buttonClass = cn(settingsActionButtonClass, MOBILE_TARGET, "text-text-light-gray");
  return (
    <div className="rounded-[5px] bg-modalBackground p-3" aria-busy={busy}>
      <SettingsCard title="Setting change">
        {proposal ? <>
          <p className="break-words font-medium">{proposal.label}</p>
          {proposal.accessChange && <p className="text-meta text-text-light-gray">Access change — requires the board owner’s confirmation</p>}
          <p className="break-words text-text-light-gray">From {settingValueLabel(proposal.before)} to {settingValueLabel(proposal.after)}</p>
          <button type="button" className={buttonClass} onClick={() => router.push(proposal.path)}>Open setting</button>
          {proposal.status === "pending" && <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass} disabled={busy} onClick={() => void act("cancel")}>Cancel</button>
            <button type="button" className={cn(buttonClass, "bg-shadcn-primary text-primary-foreground hover:bg-shadcn-primary disabled:text-primary-foreground disabled:opacity-50")} disabled={busy} onClick={() => void act("apply")}>Apply</button>
          </div>}
          {proposal.status === "applied" && <div className="flex items-center justify-between gap-2">
            <span role="status">Done</span>
            <button type="button" className={buttonClass} disabled={busy} onClick={() => void act("undo")}>Undo</button>
          </div>}
          {proposal.status === "cancelled" && <p role="status">Cancelled — nothing changed</p>}
          {proposal.status === "undone" && <p role="status">Undone</p>}
        </> : <p className="text-text-light-gray">{query.isPending ? "Loading setting change…" : query.error?.message}</p>}
        {error && <p role="alert" className="text-meta text-text-light-gray">{error}</p>}
      </SettingsCard>
    </div>
  );
}
