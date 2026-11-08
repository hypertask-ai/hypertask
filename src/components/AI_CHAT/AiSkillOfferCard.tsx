"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7779_SKILL_OFFERS_FLAG } from "@/lib/flags/definitions/htpr-7779-skill-offers";
import type { SkillOfferCard as SkillOfferCardData } from "@/lib/ai/skillOffers/contract";
import { actOnSkillOffer, fetchSkillOffer, skillOfferDraftMessage } from "@/lib/ai/skillOffers/client";
import { useAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import SettingsCard from "@/components/Modals/Settings/SettingsCard";
import { settingsActionButtonClass } from "@/components/Modals/Settings/SettingsBillingRow";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import { cn } from "@/utils/undoActions/helperFuncs";

export function AiSkillOfferCard({ id }: { id: string }) {
  const enabled = useFlag(HTPR_7779_SKILL_OFFERS_FLAG);
  const user = useRecoilValue(currentUserAtom);
  const queryClient = useQueryClient();
  const { handleSendMessage } = useAiChatContext();
  const [busy, setBusy] = useState(false);
  const processing = useRef(false);
  const [error, setError] = useState<string>();
  const queryKey = ["ai-skill-offer", user?.id, id];
  const query = useQuery<SkillOfferCardData>({
    queryKey,
    enabled: enabled && !!user?.id,
    queryFn: () => fetchSkillOffer(id),
    retry: false,
  });
  const offer = query.data;

  const act = async (action: "draft" | "dismiss" | "save") => {
    if (processing.current) return;
    processing.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const updated = await actOnSkillOffer(id, action);
      queryClient.setQueryData(queryKey, updated);
      if (action === "draft") await handleSendMessage(skillOfferDraftMessage(updated.rule));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not update skill suggestion");
    } finally {
      processing.current = false;
      setBusy(false);
    }
  };

  if (!enabled) return null;
  const buttonClass = cn(settingsActionButtonClass, MOBILE_TARGET, "text-text-light-gray");
  const primaryClass = cn(buttonClass, "bg-shadcn-primary text-primary-foreground hover:bg-shadcn-primary disabled:text-primary-foreground disabled:opacity-50");

  return (
    <div className="rounded-[4px] bg-modalBackground p-3" aria-busy={busy}>
      <SettingsCard title="Skill suggestion">
        {offer ? (
          <>
            <p className="break-words">
              You gave this instruction {offer.occurrences} times across {offer.sessionCount} chats on this board.
            </p>
            <p className="break-words font-medium">{offer.rule}</p>
            {offer.quotes[0] && (
              <p className="break-words text-text-light-gray">You wrote: “{offer.quotes[0]}”</p>
            )}
            <p className="break-words text-text-light-gray">
              {offer.kind === "skill"
                ? "It reads as a multi-step procedure, so it fits a skill. Nothing is saved until you approve the draft."
                : "It reads as a one-line preference, so it fits a board memory rule."}
            </p>
            {offer.status === "pending" && (
              <div className="flex justify-end gap-2">
                <button type="button" className={buttonClass} disabled={busy} onClick={() => void act("dismiss")}>
                  Not now
                </button>
                {offer.kind === "skill" ? (
                  <button type="button" className={primaryClass} disabled={busy} onClick={() => void act("draft")}>
                    Draft it
                  </button>
                ) : (
                  <button type="button" className={primaryClass} disabled={busy} onClick={() => void act("save")}>
                    Save board rule
                  </button>
                )}
              </div>
            )}
            {offer.status === "drafted" && <p role="status">Drafting in chat. Nothing is saved until you approve it.</p>}
            {offer.status === "saved" && <p role="status">Saved to board memory.</p>}
            {offer.status === "dismissed" && <p role="status">Not now. This will not be suggested again.</p>}
          </>
        ) : (
          <p className="text-text-light-gray">{query.isPending ? "Loading suggestion…" : query.error?.message}</p>
        )}
        {error && <p role="alert" className="text-meta text-text-light-gray">{error}</p>}
      </SettingsCard>
    </div>
  );
}
