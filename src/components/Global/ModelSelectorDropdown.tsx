import { useCurrentBoardBilling } from "@/hooks/General/useCurrentBoardBilling";
import { isByokProviderEnabledForSource } from "@/lib/byokSelectedProviderGate";
import {
  aiModelDefinitions,
  aiModelOptions,
  defaultAiModelOption,
  getDefaultAiModelOptionForPlan,
  getAiModelDefinition,
  getAiModelEfforts,
  getAiEffortLabel,
  getAiModelOption,
  getAiModelOptionById,
  getNearestAiModelOption,
  isPremiumAiModelDefinition,
  preferredAiModelOption,
  pickAutoAiModelOption,
  type TAiEffort,
  type TAiModelKey,
  type TAiModelOption,
} from "@/lib/aiModelOptions";
import { AI_PROVIDERS } from "@/lib/aiProviders";
import { useTeamAiProviders } from "@/hooks/useTeamAiProviders";
import { useTeamCustomEndpoint } from "@/hooks/useTeamCustomEndpoint";
import {
  currentProjectAtom,
  selectedSettingsTeamIdAtom,
  type CurrentBoardBilling,
} from "@/store";
import { getSettingsPath } from "@/components/Modals/Settings/settingsNavigation";
import { cn } from "@/utils/undoActions/helperFuncs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { ClassNameValue } from "tailwind-merge";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import { TAiModal } from "@/models/AI_Task_writer_model";
import { isGuestCookieUser } from "@/lib/demo/isGuestClient";
import {
  GUEST_DEFAULT_OPTION_ID,
  isGuestAllowedModelKey,
} from "@/lib/demo/guestModels";

type Submenu = "model" | "effort";
type SubmenuPlacement =
  | "right"
  | "left"
  | "above"
  | "below"
  | "right-up"
  | "left-up";

// Kept in step with the menu's `w-[250px]`: the open handler has to know how
// wide the menu will be before it renders.
const MENU_WIDTH_PX = 250;
const VIEWPORT_GUTTER_PX = 8;

const effortNotes: Record<TAiEffort, string> = {
  light: "fastest",
  standard: "balanced",
  high: "deep reasoning",
};

const AIModelDropDownButton = ({
  optionCallback,
  aiSelected,
  currentOptions,
  className,
  dropDownClassName,
  stackSubmenus = false,
  respectTeamAvailability = true,
  modelTeamId,
  modelBilling,
  effortLabelClassName,
}: {
  aiSelected: TAiModal | undefined;
  optionCallback: (item: TAiModal) => void;
  currentOptions: TAiModal[];
  className?: ClassNameValue;
  dropDownClassName?: ClassNameValue;
  stackSubmenus?: boolean;
  respectTeamAvailability?: boolean;
  modelTeamId?: string | null;
  modelBilling?: CurrentBoardBilling | null;
  // Extra classes for the effort word on the trigger (e.g. `hidden` to drop it
  // in the narrow docked chat rail; effort stays selectable in-menu). HTPR-4548.
  effortLabelClassName?: ClassNameValue;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [submenu, setSubmenu] = useState<Submenu | null>(null);
  const [submenuPlacement, setSubmenuPlacement] =
    useState<SubmenuPlacement>("right");
  const [menuAlign, setMenuAlign] = useState<"left" | "right">("left");
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const boardBilling = useCurrentBoardBilling();
  const billing = modelBilling === undefined ? boardBilling : modelBilling;
  const currentProject = useRecoilValue(currentProjectAtom);
  const setSettingsTeamId = useSetRecoilState(selectedSettingsTeamIdAtom);
  const resolvedTeamId = modelTeamId ?? currentProject?.teamId;
  const settingsTeamId = resolvedTeamId ? String(resolvedTeamId) : null;
  const scopedBilling =
    resolvedTeamId == null || billing?.teamId === String(resolvedTeamId)
      ? billing
      : null;
  const { enabledProviders, isLoading: providerSettingsLoading } =
    useTeamAiProviders(resolvedTeamId);
  const customEndpoint = useTeamCustomEndpoint(resolvedTeamId);
  const enabledProviderSet = useMemo(
    () => new Set(enabledProviders),
    [enabledProviders]
  );
  const router = useRouter();
  // HTPR-4303: anonymous demo guests may only select the cheap Chinese models.
  // Premium models still render (greyed + "Sign up to unlock"), but the picker
  // treats only the allowlisted ones as selectable. Read on mount to avoid an
  // SSR hydration mismatch on the cookie.
  const [isGuest, setIsGuest] = useState(false);
  useEffect(() => setIsGuest(isGuestCookieUser()), []);

  const listedIds = useMemo(
    () => new Set(currentOptions.map((option) => option.id)),
    [currentOptions]
  );
  // Every model key the caller offered (guests show all of these, locking the
  // non-allowlisted ones instead of hiding them).
  const listedModelKeys = useMemo(
    () =>
      new Set(
        aiModelOptions
          .filter((option) => listedIds.has(option.id))
          .map((option) => option.modelKey)
      ),
    [listedIds]
  );
  const availableOptions = useMemo(
    () =>
      aiModelOptions.filter((option) => {
        if (!listedIds.has(option.id)) return false;
        // Guests: allowlist is the only availability gate, ignore team providers
        // and custom endpoints.
        if (isGuest) return isGuestAllowedModelKey(option.modelKey);
        if (option.source === "custom") return customEndpoint.configured;
        if (!respectTeamAvailability) return true;
        const definition = getAiModelDefinition(option.modelKey);
        return Boolean(
          definition &&
            definition.provider !== "custom" &&
            enabledProviderSet.has(definition.provider)
        );
      }),
    [
      customEndpoint.configured,
      enabledProviderSet,
      listedIds,
      respectTeamAvailability,
      isGuest,
    ]
  );
  const planDefaultOption = getDefaultAiModelOptionForPlan(
    scopedBilling?.storePlanId,
    isByokProviderEnabledForSource(
      scopedBilling?.byokProviderFlags,
      preferredAiModelOption.source,
    ),
  );
  const requestedOption =
    getAiModelOptionById(aiSelected?.id) ?? planDefaultOption;
  const fallbackOption =
    (isGuest
      ? availableOptions.find((option) => option.id === GUEST_DEFAULT_OPTION_ID)
      : undefined) ??
    availableOptions.find((option) => option.id === planDefaultOption.id) ??
    pickAutoAiModelOption(availableOptions);
  const selectedOption =
    availableOptions.find((option) => option.id === requestedOption.id) ??
    fallbackOption ??
    defaultAiModelOption;
  const selectedModel = getAiModelDefinition(selectedOption.modelKey);
  const selectedModelLabel =
    selectedOption.source === "custom"
      ? (customEndpoint.modelId ?? selectedModel?.label)
      : selectedModel?.label;
  const selectedEfforts = getAiModelEfforts(
    selectedOption.modelKey,
    availableOptions
  );

  const isByokPlan =
    respectTeamAvailability && scopedBilling?.storePlanId === "BYOK";
  const isProviderEnabled = (source: string) =>
    isByokProviderEnabledForSource(scopedBilling?.byokProviderFlags, source);
  const anyListedModelEnabled =
    !isByokPlan ||
    availableOptions.some(
      (option) =>
        !isPremiumAiModelDefinition(
          getAiModelDefinition(option.modelKey),
        ) || isProviderEnabled(option.source),
    );

  const apiKeysHref =
    respectTeamAvailability && settingsTeamId
      ? getSettingsPath("apiKeys")
      : null;
  const pricingHref =
    respectTeamAvailability && settingsTeamId
      ? getSettingsPath("plans")
      : null;
  const selectSettingsTeam = () => {
    if (settingsTeamId) setSettingsTeamId(settingsTeamId);
    setIsOpen(false);
  };

  useEffect(() => {
    if (
      (respectTeamAvailability && providerSettingsLoading) ||
      customEndpoint.isLoading ||
      requestedOption.id === selectedOption.id ||
      availableOptions.length === 0
    ) {
      return;
    }
    optionCallback(selectedOption);
  }, [
    availableOptions.length,
    optionCallback,
    providerSettingsLoading,
    customEndpoint.isLoading,
    respectTeamAvailability,
    requestedOption.id,
    selectedOption,
  ]);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        setSubmenu(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setIsOpen(false);
      setSubmenu(null);
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [isOpen]);

  const openSubmenu = (nextSubmenu: Submenu) => {
    if (submenu === nextSubmenu) {
      setSubmenu(null);
      return;
    }

    const menuRect = menuRef.current?.getBoundingClientRect();
    if (menuRect) {
      if (window.innerWidth <= 640) {
        setSubmenuPlacement(menuRect.top > 330 ? "above" : "below");
      } else {
        const side =
          window.innerWidth - menuRect.right >= 226 ? "right" : "left";
        // The submenu is anchored to the menu top and grows down (max-h 360px).
        // Near the viewport bottom, anchor it to the menu bottom so it grows up.
        const openUp = window.innerHeight - menuRect.top < 380;
        setSubmenuPlacement(openUp ? `${side}-up` : side);
      }
    }
    setSubmenu(nextSubmenu);
  };

  const selectModel = (modelKey: TAiModelKey) => {
    const nextOption = getNearestAiModelOption(
      modelKey,
      selectedOption.effort,
      availableOptions
    );
    if (!nextOption) return;
    optionCallback(nextOption);
    setSubmenu(null);
  };

  const selectEffort = (effort: TAiEffort) => {
    const nextOption = getAiModelOption(
      selectedOption.modelKey,
      effort,
      availableOptions
    );
    if (!nextOption) return;
    optionCallback(nextOption);
    setSubmenu(null);
  };

  const submenuPositionClass = {
    right: "left-[calc(100%+6px)] top-0",
    left: "right-[calc(100%+6px)] top-0",
    above: "bottom-[calc(100%+6px)] right-0",
    below: "top-[calc(100%+6px)] right-0",
    "right-up": "left-[calc(100%+6px)] bottom-0",
    "left-up": "right-[calc(100%+6px)] bottom-0",
  }[submenuPlacement];

  return (
    <div ref={rootRef} className="relative inline-block min-w-0 max-w-full text-left">
      <button
        type="button"
        aria-expanded={isOpen}
        title={
          isByokPlan && !anyListedModelEnabled
            ? "Add team API keys to enable AI models"
            : undefined
        }
        className={cn(
          "inline-flex w-full min-w-0 items-center rounded-[4px] px-2 py-1 text-dense leading-normal text-white-black outline-none transition-colors hover:bg-hover-active",
          dropDownClassName
        )}
        onClick={() => {
          // A 250px menu pinned to the trigger's left edge runs off the right
          // of a phone whenever the trigger sits past the middle, which is
          // where the task-writer picker lives (HTPR-5100). Pin it to the
          // right edge instead when the left edge would not fit.
          if (!isOpen) {
            const rect = rootRef.current?.getBoundingClientRect();
            if (rect) {
              setMenuAlign(
                rect.left + MENU_WIDTH_PX > window.innerWidth - VIEWPORT_GUTTER_PX
                  ? "right"
                  : "left"
              );
            }
          }
          setIsOpen((open) => !open);
          setSubmenu(null);
        }}
      >
        <span className="truncate font-medium">{selectedModelLabel}</span>
        {selectedOption.effort ? (
          <span
            className={cn(
              "ml-1.5 flex-none text-text-light-gray",
              effortLabelClassName
            )}
          >
            {getAiEffortLabel(selectedOption.modelKey, selectedOption.effort)}
          </span>
        ) : null}
        <ChevronDown size={16}
          className={cn(
            "ml-1 flex-none text-emphasis text-text-light-gray transition-transform",
            isOpen && "rotate-180"
          )}
          strokeWidth={1.75}
        />
      </button>

      {isOpen ? (
        <div
          ref={menuRef}
          className={cn(
            "absolute top-[calc(100%+6px)] z-50 w-[250px] max-w-[calc(100vw-16px)] rounded-[4px] bg-modalBackground p-1.5 text-dense text-white-black shadow-[0_8px_30px_rgba(0,0,0,0.45)]",
            menuAlign === "right" ? "right-0" : "left-0",
            className
          )}
        >
          {isByokPlan && !anyListedModelEnabled ? (
            <div
              className="mb-1 border-b border-border-light-gray-thin px-2 py-2 text-micro leading-snug text-amber-200/95"
              role="status"
            >
              <p className="font-medium text-amber-100/90">
                No API keys are enabled for this team.
              </p>
              {apiKeysHref ? (
                <Link
                  href={apiKeysHref}
                  target="_blank"
                  className="mt-1.5 inline-block font-semibold text-[#8c9aea] hover:underline"
                  onClick={selectSettingsTeam}
                >
                  Add API keys →
                </Link>
              ) : null}
            </div>
          ) : null}

          <MenuRow
            label="Model"
            value={selectedModelLabel ?? "Select model"}
            expanded={submenu === "model"}
            onClick={() => openSubmenu("model")}
          />
          {submenu === "model" ? (
            <div
              className={cn(
                "z-10 max-h-[360px] overflow-y-auto rounded-[4px] bg-modalBackground p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.45)] scrollbar-thin scrollbar-track-transparent scrollbar-thumb-black/20 dark:scrollbar-thumb-[#4F5766]",
                stackSubmenus
                  ? "relative mt-1 w-full"
                  : cn("absolute w-[220px] max-w-[calc(100vw-16px)]", submenuPositionClass)
              )}
            >
              {AI_PROVIDERS.map((provider) => {
                const models = aiModelDefinitions.filter(
                  (model) =>
                    model.provider === provider.key &&
                    (isGuest
                      ? listedModelKeys.has(model.key)
                      : availableOptions.some(
                          (option) => option.modelKey === model.key
                        ))
                );
                if (models.length === 0) return null;
                return (
                  <div key={provider.key}>
                    <div className="px-2.5 pb-1 pt-2 text-micro font-semibold uppercase tracking-[0.08em] text-text-light-gray">
                      {provider.label}
                    </div>
                    {models.map((model) => {
                      const option = availableOptions.find(
                        (candidate) => candidate.modelKey === model.key
                      );
                      const isGuestLocked =
                        isGuest && !isGuestAllowedModelKey(model.key);
                      const hasCustomerKey =
                        !!option && isProviderEnabled(option.source);
                      const isPremiumLocked =
                        !isGuest &&
                        respectTeamAvailability &&
                        isPremiumAiModelDefinition(model) &&
                        (scopedBilling?.storePlanId === "Free" ||
                          (scopedBilling?.storePlanId === "BYOK" &&
                            !hasCustomerKey));
                      const locked = isGuestLocked || isPremiumLocked;
                      return (
                        <SubmenuRow
                          key={model.key}
                          label={model.label}
                          priceTier={model.priceTier}
                          selected={model.key === selectedOption.modelKey}
                          locked={locked}
                          note={
                            isGuestLocked
                              ? "Sign up to unlock"
                              : isPremiumLocked
                                ? "Paid plan or BYOK"
                                : undefined
                          }
                          onClick={() => {
                            if (isGuestLocked) {
                              router.push("/login");
                              return;
                            }
                            if (isPremiumLocked) {
                              if (pricingHref) {
                                selectSettingsTeam();
                                router.push(pricingHref);
                              }
                              return;
                            }
                            selectModel(model.key);
                          }}
                        />
                      );
                    })}
                  </div>
                );
              })}
              {customEndpoint.configured ? (
                <div>
                  <div className="px-2.5 pb-1 pt-2 text-micro font-semibold uppercase tracking-[0.08em] text-text-light-gray">
                    Custom
                  </div>
                  <SubmenuRow
                    label={customEndpoint.modelId ?? "Custom endpoint"}
                    selected={selectedOption.source === "custom"}
                    disabled={isByokPlan && !isProviderEnabled("custom")}
                    onClick={() => selectModel("custom")}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          {selectedEfforts.length > 0 ? (
            <>
              <MenuRow
                label="Effort"
                value={
                  selectedOption.effort
                    ? getAiEffortLabel(
                        selectedOption.modelKey,
                        selectedOption.effort
                      )
                    : "Select effort"
                }
                expanded={submenu === "effort"}
                onClick={() => openSubmenu("effort")}
              />
              {submenu === "effort" ? (
                <div
                  className={cn(
                    "z-10 rounded-[4px] bg-modalBackground p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.45)]",
                    stackSubmenus
                      ? "relative mt-1 w-full"
                      : cn("absolute w-[210px] max-w-[calc(100vw-16px)]", submenuPositionClass)
                  )}
                >
                  {selectedEfforts.map((effort) => (
                    <SubmenuRow
                      key={effort}
                      label={getAiEffortLabel(selectedOption.modelKey, effort)}
                      note={effortNotes[effort]}
                      selected={effort === selectedOption.effort}
                      onClick={() => selectEffort(effort)}
                    />
                  ))}
                </div>
              ) : null}
            </>
          ) : null}

          <div className="mx-2 my-1 h-px bg-border-light-gray-thin" />
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-[4px] px-2.5 py-2 text-left text-text-light-gray transition-colors hover:bg-hoverCardBackground hover:text-white-black disabled:cursor-not-allowed disabled:opacity-45"
            disabled={
              !fallbackOption ||
              (isByokPlan &&
                isPremiumAiModelDefinition(
                  getAiModelDefinition(fallbackOption.modelKey),
                ) &&
                !isProviderEnabled(fallbackOption.source))
            }
            onClick={() => {
              if (fallbackOption) optionCallback(fallbackOption);
              setSubmenu(null);
            }}
          >
            <span>Reset to default</span>
            <RotateCcw size={16} className="text-content" strokeWidth={1.75} />
          </button>

        </div>
      ) : null}
    </div>
  );
};

function MenuRow({
  label,
  value,
  expanded,
  onClick,
}: {
  label: string;
  value: string;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      className="flex w-full items-center justify-between gap-2 rounded-[4px] px-2.5 py-2 text-left transition-colors hover:bg-hoverCardBackground"
      onClick={onClick}
    >
      <span className="flex-none font-semibold">{label}</span>
      <span className="flex min-w-0 items-center gap-1 text-text-light-gray">
        <span className="truncate">{value}</span>
        <ChevronRight size={16} className="flex-none text-emphasis" strokeWidth={1.75} />
      </span>
    </button>
  );
}

function SubmenuRow({
  label,
  note,
  priceTier,
  selected,
  disabled = false,
  locked = false,
  onClick,
}: {
  label: string;
  note?: string;
  priceTier?: 1 | 2 | 3;
  selected: boolean;
  disabled?: boolean;
  locked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-[4px] px-2.5 py-2 text-left transition-colors hover:bg-hoverCardBackground disabled:cursor-not-allowed disabled:opacity-45",
        locked && "cursor-pointer opacity-45"
      )}
      onClick={onClick}
    >
      {/* min-w-0 so a long model name clips instead of widening the row past
          the menu, which is what pushed options off a phone screen. */}
      <span className="min-w-0 truncate">
        {label}
        {note ? (
          <span className="ml-2 font-mono text-micro text-text-light-gray">
            {note}
          </span>
        ) : null}
      </span>
      <span className="flex flex-none items-center gap-2">
        {priceTier ? (
          <span className="font-mono text-micro text-text-light-gray">
            {"$".repeat(priceTier)}
          </span>
        ) : null}
        <Check size={14}
          className={cn(
            "text-micro text-hypertasks-purple",
            selected ? "opacity-100" : "opacity-0"
          )}
          strokeWidth={1.75}
        />
      </span>
    </button>
  );
}

export default AIModelDropDownButton;
