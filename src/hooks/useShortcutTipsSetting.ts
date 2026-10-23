import { useRecoilState } from "@/lib/state";
import { shortcutTipsEnabledAtom, showQuickTipsAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7267_SHORTCUT_TIPS_SETTING_FLAG } from "@/lib/flags/keys";

export function useShortcutTipsSetting() {
  const ownSetting = useFlag(HTPR_7267_SHORTCUT_TIPS_SETTING_FLAG);
  const [quickTipsBarShown, setQuickTipsBarShown] = useRecoilState(showQuickTipsAtom);
  const [shortcutTipsEnabled, setShortcutTipsEnabled] = useRecoilState(shortcutTipsEnabledAtom);
  const turnOffAllTips = () => {
    setShortcutTipsEnabled(false);
    setQuickTipsBarShown(false);
  };
  return {
    tipsEnabled: ownSetting ? shortcutTipsEnabled : quickTipsBarShown,
    turnOffAllTips,
  };
}
